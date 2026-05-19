/**
 * STT — Whisper.cpp speech-to-text wrapper.
 * Spawns whisper.cpp CLI as a child process for transcription.
 * Supports streaming partial results where the native binary allows.
 */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createWriteStream, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
const DEFAULT_WHISPER_CONFIG = {
    language: "en",
    threads: 2,
    maxChunkSeconds: 10,
    sampleRate: 16_000,
    tempDir: join(tmpdir(), "aimc-whisper"),
};
// ─── Whisper STT ─────────────────────────────────────
export class WhisperSTT extends EventEmitter {
    config;
    process = null;
    buffer = [];
    totalBytes = 0;
    processing = false;
    available = false;
    constructor(config) {
        super();
        this.config = { ...DEFAULT_WHISPER_CONFIG, ...config };
        mkdirSync(this.config.tempDir, { recursive: true });
        this.available = existsSync(this.config.whisperPath) && existsSync(this.config.modelPath);
    }
    // ─── Availability ──────────────────────────────────
    /** Whether whisper.cpp binary + model are accessible. */
    isAvailable() {
        return this.available;
    }
    /**
     * Verify the whisper binary works by running `--version` or equivalent.
     * Returns true if whisper is functional.
     */
    async probe() {
        if (!this.available)
            return false;
        try {
            const result = await this.execWhisper(["--version"]);
            this.available = result.includes("whisper");
            return this.available;
        }
        catch {
            this.available = false;
            return false;
        }
    }
    // ─── Feed audio ────────────────────────────────────
    /**
     * Feed raw PCM audio data (16-bit signed, 16kHz mono).
     * Audio is buffered and transcribed when sufficient data is accumulated
     * or when flush() is called.
     */
    feed(pcmBuffer) {
        this.buffer.push(pcmBuffer);
        this.totalBytes += pcmBuffer.length;
        const maxBytes = this.config.sampleRate * 2 * this.config.maxChunkSeconds;
        if (this.totalBytes >= maxBytes) {
            this.transcribeAccumulated().catch(() => { });
        }
    }
    // ─── Flush ─────────────────────────────────────────
    /**
     * Transcribe all accumulated audio and return the final result.
     * Called when speech ends (VAD speech_end).
     */
    async flush() {
        if (this.buffer.length === 0 || !this.available)
            return null;
        return this.transcribeAccumulated();
    }
    // ─── Cancel ────────────────────────────────────────
    /**
     * Cancel any in-progress transcription.
     */
    cancel() {
        if (this.process) {
            this.process.kill("SIGTERM");
            this.process = null;
        }
        this.processing = false;
    }
    // ─── Reset ─────────────────────────────────────────
    /** Discard buffered audio without transcribing. */
    reset() {
        this.cancel();
        this.buffer = [];
        this.totalBytes = 0;
        this.processing = false;
    }
    // ─── Internals ─────────────────────────────────────
    async transcribeAccumulated() {
        if (this.buffer.length === 0 || this.processing || !this.available) {
            return null;
        }
        this.processing = true;
        const combined = Buffer.concat(this.buffer);
        this.buffer = [];
        this.totalBytes = 0;
        try {
            const wavPath = this.writeWAV(combined);
            const result = await this.runWhisper(wavPath);
            this.cleanup(wavPath);
            const whisperResult = {
                text: result.trim(),
                partial: false,
                timestamp: Date.now(),
                language: this.config.language || "en",
            };
            this.emit("transcript", whisperResult);
            this.processing = false;
            return whisperResult;
        }
        catch (err) {
            this.processing = false;
            this.emit("error", err);
            return null;
        }
    }
    writeWAV(pcmData) {
        const path = join(this.config.tempDir, `${randomUUID()}.wav`);
        const sampleRate = this.config.sampleRate;
        const numChannels = 1;
        const bitsPerSample = 16;
        const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
        const blockAlign = numChannels * (bitsPerSample / 8);
        const dataSize = pcmData.length;
        const header = Buffer.alloc(44);
        // RIFF header
        header.write("RIFF", 0);
        header.writeUInt32LE(36 + dataSize, 4);
        header.write("WAVE", 8);
        // fmt chunk
        header.write("fmt ", 12);
        header.writeUInt32LE(16, 16); // chunk size
        header.writeUInt16LE(1, 20); // PCM format
        header.writeUInt16LE(numChannels, 22);
        header.writeUInt32LE(sampleRate, 24);
        header.writeUInt32LE(byteRate, 28);
        header.writeUInt16LE(blockAlign, 32);
        header.writeUInt16LE(bitsPerSample, 34);
        // data chunk
        header.write("data", 36);
        header.writeUInt32LE(dataSize, 40);
        const fd = createWriteStream(path);
        fd.write(header);
        fd.write(pcmData);
        fd.end();
        return path;
    }
    async runWhisper(wavPath) {
        const args = [
            "-m", this.config.modelPath,
            "-f", wavPath,
            "-t", String(this.config.threads),
            "--no-timestamps",
            "--no-prints",
        ];
        if (this.config.language && this.config.language !== "auto") {
            args.push("-l", this.config.language);
        }
        return this.execWhisper(args);
    }
    execWhisper(args) {
        return new Promise((resolve, reject) => {
            const child = spawn(this.config.whisperPath, args, {
                stdio: ["pipe", "pipe", "pipe"],
            });
            let stdout = "";
            let stderr = "";
            child.stdout?.on("data", (data) => {
                stdout += data.toString();
            });
            child.stderr?.on("data", (data) => {
                stderr += data.toString();
            });
            child.on("close", (code) => {
                if (code === 0 || code === null) {
                    // whisper.cpp outputs transcription to stdout
                    // Strip ANSI and leading/trailing whitespace
                    const cleaned = stdout
                        .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "")
                        .replace(/^whisper_.*\n/gm, "")
                        .trim();
                    resolve(cleaned || stderr.trim());
                }
                else {
                    reject(new Error(`whisper.cpp exited ${code}: ${stderr.trim()}`));
                }
            });
            child.on("error", (err) => {
                reject(new Error(`whisper.cpp failed to start: ${err.message}`));
            });
        });
    }
    cleanup(wavPath) {
        try {
            if (existsSync(wavPath))
                unlinkSync(wavPath);
        }
        catch {
            // temp file cleanup is best-effort
        }
    }
}
//# sourceMappingURL=stt-whisper.js.map
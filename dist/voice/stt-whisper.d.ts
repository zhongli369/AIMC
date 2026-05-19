import { EventEmitter } from "node:events";
export interface WhisperConfig {
    /** Path to whisper.cpp main executable */
    whisperPath: string;
    /** Path to the ggml model file (tiny.bin, base.bin, small.bin) */
    modelPath: string;
    /** Language code for transcription (auto-detect if empty) */
    language?: string;
    /** Number of threads for inference */
    threads: number;
    /** Max audio duration in seconds per chunk */
    maxChunkSeconds: number;
    /** Sample rate expected by the model */
    sampleRate: number;
    /** Temp directory for audio files */
    tempDir: string;
}
export interface WhisperResult {
    /** Full transcribed text */
    text: string;
    /** Whether this is a partial (incomplete) result */
    partial: boolean;
    /** Timestamp of result */
    timestamp: number;
    /** Language detected */
    language?: string;
    /** Confidence score (0–1) if available */
    confidence?: number;
}
export declare class WhisperSTT extends EventEmitter {
    private config;
    private process;
    private buffer;
    private totalBytes;
    private processing;
    private available;
    constructor(config: WhisperConfig);
    /** Whether whisper.cpp binary + model are accessible. */
    isAvailable(): boolean;
    /**
     * Verify the whisper binary works by running `--version` or equivalent.
     * Returns true if whisper is functional.
     */
    probe(): Promise<boolean>;
    /**
     * Feed raw PCM audio data (16-bit signed, 16kHz mono).
     * Audio is buffered and transcribed when sufficient data is accumulated
     * or when flush() is called.
     */
    feed(pcmBuffer: Buffer): void;
    /**
     * Transcribe all accumulated audio and return the final result.
     * Called when speech ends (VAD speech_end).
     */
    flush(): Promise<WhisperResult | null>;
    /**
     * Cancel any in-progress transcription.
     */
    cancel(): void;
    /** Discard buffered audio without transcribing. */
    reset(): void;
    private transcribeAccumulated;
    private writeWAV;
    private runWhisper;
    private execWhisper;
    private cleanup;
}
export type { EventEmitter } from "node:events";
//# sourceMappingURL=stt-whisper.d.ts.map
/**
 * VAD — Voice Activity Detection via energy-based RMS analysis.
 * Emits speech_start / speech_end events with minimal CPU overhead.
 */
import { EventEmitter } from "node:events";
const DEFAULT_VAD_CONFIG = {
    threshold: 0.02,
    voiceDurationMs: 150,
    silenceDurationMs: 600,
    maxUtteranceMs: 15_000,
    sampleRate: 16_000,
    debounceMs: 400,
};
/**
 * Energy-based Voice Activity Detector.
 * Processes raw Float32 audio samples and emits speech boundaries.
 */
export class VAD extends EventEmitter {
    config;
    state = "silent";
    voiceSamples = 0;
    silenceSamples = 0;
    utteranceSamples = 0;
    cooldownUntil = 0;
    currentEnergy = 0;
    constructor(config) {
        super();
        this.config = { ...DEFAULT_VAD_CONFIG, ...config };
    }
    // ─── Push audio samples ────────────────────────────
    /**
     * Feed a chunk of mono Float32 PCM audio to the detector.
     * Fires speech_start / speech_end events on state transitions.
     */
    process(samples, sampleRate) {
        const sr = sampleRate || this.config.sampleRate;
        const rms = this.computeRMS(samples);
        this.currentEnergy = rms;
        const isVoice = rms > this.config.threshold;
        const now = Date.now();
        // Cooldown after a recent utterance
        if (this.state === "cooldown") {
            if (now < this.cooldownUntil)
                return this.state;
            this.state = "silent";
            this.silenceSamples = 0;
        }
        switch (this.state) {
            case "silent":
                if (isVoice) {
                    this.voiceSamples += samples.length;
                    if (this.samplesToMs(this.voiceSamples, sr) >= this.config.voiceDurationMs) {
                        this.state = "voice";
                        this.utteranceSamples = this.voiceSamples;
                        this.voiceSamples = 0;
                        this.emitEvent("speech_start", now);
                    }
                }
                else {
                    this.voiceSamples = Math.max(0, this.voiceSamples - samples.length);
                }
                break;
            case "voice":
                this.utteranceSamples += samples.length;
                // Auto-cutoff for max utterance
                if (this.samplesToMs(this.utteranceSamples, sr) >= this.config.maxUtteranceMs) {
                    this.forceEnd(now);
                    return this.state;
                }
                if (isVoice) {
                    this.silenceSamples = 0;
                }
                else {
                    this.silenceSamples += samples.length;
                    if (this.samplesToMs(this.silenceSamples, sr) >= this.config.silenceDurationMs) {
                        this.forceEnd(now);
                    }
                }
                break;
        }
        return this.state;
    }
    // ─── Force end (for explicit interruption) ─────────
    /** Force-end the current utterance. */
    forceEnd(now = Date.now()) {
        if (this.state === "voice") {
            this.emitEvent("speech_end", now);
        }
        this.state = "cooldown";
        this.cooldownUntil = Date.now() + this.config.debounceMs;
        this.voiceSamples = 0;
        this.silenceSamples = 0;
        this.utteranceSamples = 0;
    }
    // ─── State ─────────────────────────────────────────
    getState() {
        return this.state;
    }
    getEnergy() {
        return this.currentEnergy;
    }
    isSpeaking() {
        return this.state === "voice";
    }
    // ─── Reset ─────────────────────────────────────────
    reset() {
        this.state = "silent";
        this.voiceSamples = 0;
        this.silenceSamples = 0;
        this.utteranceSamples = 0;
        this.currentEnergy = 0;
    }
    // ─── Config ────────────────────────────────────────
    updateConfig(patch) {
        Object.assign(this.config, patch);
    }
    getConfig() {
        return this.config;
    }
    // ─── Internals ─────────────────────────────────────
    computeRMS(samples) {
        if (samples.length === 0)
            return 0;
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
            sum += samples[i] * samples[i];
        }
        return Math.sqrt(sum / samples.length);
    }
    samplesToMs(count, sr) {
        return (count / sr) * 1000;
    }
    emitEvent(type, timestamp) {
        const event = { type, timestamp, energy: this.currentEnergy };
        this.emit(type, event);
        this.emit("state_change", event);
    }
}
//# sourceMappingURL=vad.js.map
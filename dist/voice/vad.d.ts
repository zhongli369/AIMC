/**
 * VAD — Voice Activity Detection via energy-based RMS analysis.
 * Emits speech_start / speech_end events with minimal CPU overhead.
 */
import { EventEmitter } from "node:events";
export interface VADConfig {
    /** RMS threshold above which audio is considered "voice" (0–1) */
    threshold: number;
    /** Min ms of continuous voice before triggering speech_start */
    voiceDurationMs: number;
    /** Min ms of silence before triggering speech_end */
    silenceDurationMs: number;
    /** Max ms of a single utterance before auto-cutoff */
    maxUtteranceMs: number;
    /** Sample rate of incoming audio */
    sampleRate: number;
    /** Debounce ms between speech_end and next speech_start */
    debounceMs: number;
}
export type VADState = "silent" | "voice" | "cooldown";
export interface VADEvent {
    type: "speech_start" | "speech_end";
    timestamp: number;
    /** RMS energy level at trigger */
    energy: number;
}
/**
 * Energy-based Voice Activity Detector.
 * Processes raw Float32 audio samples and emits speech boundaries.
 */
export declare class VAD extends EventEmitter {
    private config;
    private state;
    private voiceSamples;
    private silenceSamples;
    private utteranceSamples;
    private cooldownUntil;
    private currentEnergy;
    constructor(config?: Partial<VADConfig>);
    /**
     * Feed a chunk of mono Float32 PCM audio to the detector.
     * Fires speech_start / speech_end events on state transitions.
     */
    process(samples: Float32Array, sampleRate?: number): VADState;
    /** Force-end the current utterance. */
    forceEnd(now?: number): void;
    getState(): VADState;
    getEnergy(): number;
    isSpeaking(): boolean;
    reset(): void;
    updateConfig(patch: Partial<VADConfig>): void;
    getConfig(): Readonly<VADConfig>;
    private computeRMS;
    private samplesToMs;
    private emitEvent;
}
export type { EventEmitter } from "node:events";
//# sourceMappingURL=vad.d.ts.map
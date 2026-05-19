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

const DEFAULT_VAD_CONFIG: VADConfig = {
  threshold: 0.02,
  voiceDurationMs: 150,
  silenceDurationMs: 600,
  maxUtteranceMs: 15_000,
  sampleRate: 16_000,
  debounceMs: 400,
};

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
export class VAD extends EventEmitter {
  private config: VADConfig;
  private state: VADState = "silent";
  private voiceSamples = 0;
  private silenceSamples = 0;
  private utteranceSamples = 0;
  private cooldownUntil = 0;
  private currentEnergy = 0;

  constructor(config?: Partial<VADConfig>) {
    super();
    this.config = { ...DEFAULT_VAD_CONFIG, ...config };
  }

  // ─── Push audio samples ────────────────────────────

  /**
   * Feed a chunk of mono Float32 PCM audio to the detector.
   * Fires speech_start / speech_end events on state transitions.
   */
  process(samples: Float32Array, sampleRate?: number): VADState {
    const sr = sampleRate || this.config.sampleRate;
    const rms = this.computeRMS(samples);
    this.currentEnergy = rms;

    const isVoice = rms > this.config.threshold;
    const now = Date.now();

    // Cooldown after a recent utterance
    if (this.state === "cooldown") {
      if (now < this.cooldownUntil) return this.state;
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
        } else {
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
        } else {
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
  forceEnd(now: number = Date.now()): void {
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

  getState(): VADState {
    return this.state;
  }

  getEnergy(): number {
    return this.currentEnergy;
  }

  isSpeaking(): boolean {
    return this.state === "voice";
  }

  // ─── Reset ─────────────────────────────────────────

  reset(): void {
    this.state = "silent";
    this.voiceSamples = 0;
    this.silenceSamples = 0;
    this.utteranceSamples = 0;
    this.currentEnergy = 0;
  }

  // ─── Config ────────────────────────────────────────

  updateConfig(patch: Partial<VADConfig>): void {
    Object.assign(this.config, patch);
  }

  getConfig(): Readonly<VADConfig> {
    return this.config;
  }

  // ─── Internals ─────────────────────────────────────

  private computeRMS(samples: Float32Array): number {
    if (samples.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
  }

  private samplesToMs(count: number, sr: number): number {
    return (count / sr) * 1000;
  }

  private emitEvent(type: VADEvent["type"], timestamp: number): void {
    const event: VADEvent = { type, timestamp, energy: this.currentEnergy };
    this.emit(type, event);
    this.emit("state_change", event);
  }
}

// ─── Re-export types ───────────────────────────────

export type { EventEmitter } from "node:events";

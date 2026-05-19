/**
 * VoiceOrchestrator — full-duplex voice pipeline coordinator.
 *
 * Cycle: mic → VAD → Whisper STT → AgentCore → Edge TTS → speaker
 *
 * Connects ONLY through AgentCore → RuntimeCore. No direct Minecraft access.
 * Supports interruption, fallback, and latency optimization.
 */
import { EventEmitter } from "node:events";
import { VAD, type VADConfig } from "./vad.js";
import { WhisperSTT, type WhisperConfig } from "./stt-whisper.js";
import { EdgeTTS, type TTSAudioChunk } from "./tts-edge.js";
export type VoiceState = "idle" | "listening" | "transcribing" | "thinking" | "speaking" | "error";
export interface VoiceOrchestratorConfig {
    /** Enable voice input (mic) */
    voiceInput: boolean;
    /** Enable voice output (TTS) */
    voiceOutput: boolean;
    /** Push-to-talk mode (VAD bypass) */
    pushToTalk: boolean;
    /** Auto-listen after TTS completes */
    autoListen: boolean;
    /** Max thinking time before fallback (ms) */
    thinkTimeoutMs: number;
    /** Min interval between utterances (ms) */
    debounceMs: number;
    /** VAD configuration */
    vad: Partial<VADConfig>;
}
export interface VoiceOrchestratorEvents {
    state_change: (state: VoiceState) => void;
    /** Raw microphone audio (Float32 PCM) */
    mic_audio: (samples: Float32Array) => void;
    /** TTS audio chunk ready for playback */
    tts_audio: (chunk: TTSAudioChunk) => void;
    /** Final transcript from STT */
    transcript: (text: string) => void;
    /** AI speech text (before TTS) */
    ai_speech: (text: string) => void;
    /** Interrupt occurred — current speech stopped */
    interrupted: (reason: string) => void;
    /** Error in any component */
    error: (err: Error, component: string) => void;
    /** Full cycle timing breakdown */
    latency: (timing: VoiceLatency) => void;
}
export interface VoiceLatency {
    sttMs: number;
    llmMs: number;
    ttsMs: number;
    totalMs: number;
}
export declare class VoiceOrchestrator extends EventEmitter {
    private config;
    private state;
    private vad;
    private stt;
    private tts;
    private micBuffer;
    private rawPcmBuffer;
    private lastUtteranceTime;
    private thinkTimer;
    private active;
    constructor(config?: Partial<VoiceOrchestratorConfig>);
    /** Initialize STT engine (call after whisper binary is configured). */
    initSTT(whisperConfig: WhisperConfig): void;
    /** Activate voice pipeline — begin listening. */
    start(): Promise<void>;
    /** Deactivate voice pipeline. */
    stop(): void;
    /** Full cleanup — call before replacing this instance. */
    destroy(): void;
    /**
     * Feed microphone audio samples (mono Float32, 16kHz).
     * Called by the audio capture layer for each audio frame.
     */
    feedMicAudio(samples: Float32Array): void;
    /** Begin capturing (push-to-talk press). */
    pushToTalkStart(): void;
    /** End capturing (push-to-talk release). */
    pushToTalkEnd(): void;
    /**
     * Emergency interrupt — stop TTS, clear pipeline.
     * Called by SafetyGuard or high-priority events.
     */
    interrupt(reason: string): void;
    getState(): VoiceState;
    isActive(): boolean;
    getSTT(): WhisperSTT | null;
    getTTS(): EdgeTTS;
    getVAD(): VAD;
    setPushToTalk(enabled: boolean): void;
    setVoiceOutput(enabled: boolean): void;
    updateConfig(patch: Partial<VoiceOrchestratorConfig>): void;
    getConfig(): Readonly<VoiceOrchestratorConfig>;
    private startCapture;
    private endCapture;
    private transcribe;
    private think;
    private speakResponse;
    private bindVADEvents;
    private bindSTTEvents;
    private bindTTSEvents;
    private transition;
    private float32ToPCM16;
    private clearBuffers;
    private handleError;
    private latestLatency;
}
export type { EventEmitter } from "node:events";
//# sourceMappingURL=voice-orchestrator.d.ts.map
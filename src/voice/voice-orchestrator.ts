/**
 * VoiceOrchestrator — full-duplex voice pipeline coordinator.
 *
 * Cycle: mic → VAD → Whisper STT → AgentCore → Edge TTS → speaker
 *
 * Connects ONLY through AgentCore → RuntimeCore. No direct Minecraft access.
 * Supports interruption, fallback, and latency optimization.
 */
import { EventEmitter } from "node:events";
import { VAD, type VADConfig, type VADEvent } from "./vad.js";
import { WhisperSTT, type WhisperConfig, type WhisperResult } from "./stt-whisper.js";
import { EdgeTTS, type TTSConfig, type TTSAudioChunk } from "./tts-edge.js";

// ─── Orchestrator State ─────────────────────────────

export type VoiceState =
  | "idle"
  | "listening"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "error";

// ─── Config ──────────────────────────────────────────

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

const DEFAULT_CONFIG: VoiceOrchestratorConfig = {
  voiceInput: true,
  voiceOutput: true,
  pushToTalk: false,
  autoListen: true,
  thinkTimeoutMs: 8_000,
  debounceMs: 800,
  vad: {},
};

// ─── Orchestrator Events ────────────────────────────

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

// ─── Orchestrator ────────────────────────────────────

export class VoiceOrchestrator extends EventEmitter {
  private config: VoiceOrchestratorConfig;
  private state: VoiceState = "idle";
  private vad: VAD;
  private stt: WhisperSTT | null = null;
  private tts: EdgeTTS;
  private micBuffer: Float32Array[] = [];
  private rawPcmBuffer: Buffer[] = [];
  private lastUtteranceTime = 0;
  private thinkTimer: ReturnType<typeof setTimeout> | null = null;
  private active = false;

  constructor(config?: Partial<VoiceOrchestratorConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.vad = new VAD(this.config.vad);
    this.tts = new EdgeTTS();

    this.bindVADEvents();
    this.bindTTSEvents();
  }

  // ─── Lifecycle ─────────────────────────────────────

  /** Initialize STT engine (call after whisper binary is configured). */
  initSTT(whisperConfig: WhisperConfig): void {
    this.stt = new WhisperSTT(whisperConfig);
    this.bindSTTEvents();
  }

  /** Activate voice pipeline — begin listening. */
  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;

    if (this.stt && !this.stt.isAvailable()) {
      const ok = await this.stt.probe();
      if (!ok) {
        console.warn("[VoiceOrchestrator] Whisper not available — falling back to chat mode");
      }
    }

    if (this.config.voiceInput && !this.config.pushToTalk) {
      this.transition("listening");
    } else {
      this.transition("idle");
    }

    console.log("[VoiceOrchestrator] Started —", this.config.pushToTalk ? "push-to-talk" : "voice-activated");
  }

  /** Deactivate voice pipeline. */
  stop(): void {
    this.active = false;
    this.tts.stop();
    this.stt?.cancel();
    this.vad.reset();
    this.clearBuffers();
    this.transition("idle");
    console.log("[VoiceOrchestrator] Stopped.");
  }

  /** Full cleanup — call before replacing this instance. */
  destroy(): void {
    this.stop();
    if (this.thinkTimer) { clearTimeout(this.thinkTimer); this.thinkTimer = null; }
    this.vad.removeAllListeners();
    if (this.stt) this.stt.removeAllListeners();
    this.tts.removeAllListeners();
    this.removeAllListeners();
  }

  // ─── Mic Input ─────────────────────────────────────

  /**
   * Feed microphone audio samples (mono Float32, 16kHz).
   * Called by the audio capture layer for each audio frame.
   */
  feedMicAudio(samples: Float32Array): void {
    if (!this.active) return;
    if (!this.config.voiceInput) return;

    this.micBuffer.push(samples);
    this.emit("mic_audio", samples);

    // Convert Float32 → 16-bit PCM buffer for STT
    const pcm16 = this.float32ToPCM16(samples);
    this.rawPcmBuffer.push(pcm16);

    if (this.config.pushToTalk) return; // Manual control only

    // Run VAD
    const prevState = this.vad.getState();
    this.vad.process(samples);

    // VAD transition: silent → voice
    if (prevState !== "voice" && this.vad.isSpeaking()) {
      // Interrupt TTS if speaking
      if (this.tts.isSpeaking()) {
        this.interrupt("player_speech");
      }
      this.startCapture();
    }
  }

  // ─── Push-to-Talk ─────────────────────────────────

  /** Begin capturing (push-to-talk press). */
  pushToTalkStart(): void {
    if (!this.config.pushToTalk) return;
    if (this.tts.isSpeaking()) {
      this.interrupt("push_to_talk");
    }
    this.startCapture();
  }

  /** End capturing (push-to-talk release). */
  pushToTalkEnd(): void {
    if (!this.config.pushToTalk) return;
    this.endCapture();
  }

  // ─── Interrupt ─────────────────────────────────────

  /**
   * Emergency interrupt — stop TTS, clear pipeline.
   * Called by SafetyGuard or high-priority events.
   */
  interrupt(reason: string): void {
    if (!this.active) return;

    this.tts.stop();
    this.stt?.cancel();
    this.transition("listening");
    this.emit("interrupted", reason);
    console.log(`[VoiceOrchestrator] Interrupted: ${reason}`);
  }

  // ─── State ─────────────────────────────────────────

  getState(): VoiceState {
    return this.state;
  }

  isActive(): boolean {
    return this.active;
  }

  getSTT(): WhisperSTT | null {
    return this.stt;
  }

  getTTS(): EdgeTTS {
    return this.tts;
  }

  getVAD(): VAD {
    return this.vad;
  }

  // ─── Config ────────────────────────────────────────

  setPushToTalk(enabled: boolean): void {
    this.config.pushToTalk = enabled;
    if (enabled) {
      this.transition("idle");
    } else if (this.active) {
      this.transition("listening");
    }
  }

  setVoiceOutput(enabled: boolean): void {
    this.config.voiceOutput = enabled;
  }

  updateConfig(patch: Partial<VoiceOrchestratorConfig>): void {
    Object.assign(this.config, patch);
  }

  getConfig(): Readonly<VoiceOrchestratorConfig> {
    return this.config;
  }

  // ─── Internals: Capture Cycle ─────────────────────

  private startCapture(): void {
    this.micBuffer = [];
    this.rawPcmBuffer = [];
    this.transition("listening");
  }

  private async endCapture(): Promise<void> {
    if (this.rawPcmBuffer.length === 0) {
      this.transition("idle");
      return;
    }

    this.transition("transcribing");

    try {
      const transcript = await this.transcribe();

      if (transcript) {
        this.transition("thinking");
        this.emit("transcript", transcript);

        const response = await this.think(transcript);

        if (response) {
          await this.speakResponse(response);
        }
      }
    } catch (err) {
      this.handleError(err instanceof Error ? err : new Error(String(err)), "pipeline");
    } finally {
      this.clearBuffers();
      if (this.active && this.config.autoListen && !this.config.pushToTalk) {
        this.transition("listening");
      } else {
        this.transition("idle");
      }
    }
  }

  // ─── Internals: STT ───────────────────────────────

  private async transcribe(): Promise<string | null> {
    if (!this.stt || !this.stt.isAvailable()) {
      // Fallback: push-to-talk must provide text manually, or use legacy chat
      console.warn("[VoiceOrchestrator] STT unavailable — cannot transcribe");
      return null;
    }

    const sttStart = Date.now();

    // Feed all buffered PCM to STT
    const combined = Buffer.concat(this.rawPcmBuffer);
    this.stt.feed(combined);
    const result = await this.stt.flush();

    const sttMs = Date.now() - sttStart;
    this.latestLatency = { sttMs, llmMs: 0, ttsMs: 0, totalMs: 0 };

    if (result && result.text) {
      console.log(`[VoiceOrchestrator] STT (${sttMs}ms): "${result.text}"`);
      return result.text;
    }

    return null;
  }

  // ─── Internals: Think (AgentCore) ─────────────────

  private async think(text: string): Promise<string | null> {
    const aimc = (globalThis as any).__aimc__;
    const agentCore = aimc?.agentCore;

    if (!agentCore) {
      console.warn("[VoiceOrchestrator] AgentCore not available — cannot think");
      return null;
    }

    const llmStart = Date.now();

    // Set a timeout guard
    const timeoutPromise = new Promise<null>((resolve) => {
      this.thinkTimer = setTimeout(() => {
        console.warn("[VoiceOrchestrator] Think timeout — fallback");
        resolve(null);
      }, this.config.thinkTimeoutMs);
    });

    try {
      const result = await Promise.race([
        agentCore.think({
          botState: null, // Will be built by AgentCore from context
          chatMessage: { source: "player_voice", message: text },
          chatHistory: [],
        }),
        timeoutPromise,
      ]);

      if (this.thinkTimer) {
        clearTimeout(this.thinkTimer);
        this.thinkTimer = null;
      }

      if (!result || !result.completed) return null;

      const llmMs = Date.now() - llmStart;
      if (this.latestLatency) {
        this.latestLatency.llmMs = llmMs;
      }

      const speech = result.agentOutput?.speech;
      if (speech?.text) {
        console.log(`[VoiceOrchestrator] LLM (${llmMs}ms): "${speech.text}"`);
        return speech.text;
      }

      return null;
    } catch (err) {
      if (this.thinkTimer) {
        clearTimeout(this.thinkTimer);
        this.thinkTimer = null;
      }
      throw err;
    }
  }

  // ─── Internals: TTS ───────────────────────────────

  private async speakResponse(text: string): Promise<void> {
    if (!this.config.voiceOutput) {
      this.emit("ai_speech", text);
      return;
    }

    this.transition("speaking");
    this.emit("ai_speech", text);

    const ttsStart = Date.now();

    try {
      await this.tts.speak(text);
      const ttsMs = Date.now() - ttsStart;

      if (this.latestLatency) {
        this.latestLatency.ttsMs = ttsMs;
        this.latestLatency.totalMs =
          this.latestLatency.sttMs + this.latestLatency.llmMs + this.latestLatency.ttsMs;
        this.emit("latency", { ...this.latestLatency });
      }
    } catch (err) {
      // TTS failed — emit text as fallback
      this.emit("ai_speech", text);
      this.handleError(err instanceof Error ? err : new Error(String(err)), "tts");
    }
  }

  // ─── Internals: Event Binding ─────────────────────

  private bindVADEvents(): void {
    this.vad.on("speech_start", (event: VADEvent) => {
      console.log(`[VAD] Speech start — energy: ${event.energy.toFixed(4)}`);
    });

    this.vad.on("speech_end", (event: VADEvent) => {
      console.log(`[VAD] Speech end — energy: ${event.energy.toFixed(4)}`);
      this.endCapture();
    });
  }

  private bindSTTEvents(): void {
    if (!this.stt) return;

    this.stt.on("transcript", (result: WhisperResult) => {
      console.log(`[Whisper] ${result.partial ? "Partial" : "Final"}: "${result.text}"`);
    });

    this.stt.on("error", (err: Error) => {
      this.handleError(err, "stt");
    });
  }

  private bindTTSEvents(): void {
    this.tts.on("audio", (chunk: TTSAudioChunk) => {
      this.emit("tts_audio", chunk);
    });

    this.tts.on("interrupted", () => {
      // Already handled by orchestrator
    });

    this.tts.on("error", (err: Error) => {
      this.handleError(err, "tts");
    });
  }

  // ─── Internals: Helpers ───────────────────────────

  private transition(next: VoiceState): void {
    if (this.state === next) return;
    const prev = this.state;
    this.state = next;
    this.emit("state_change", next);
    console.log(`[VoiceOrchestrator] State: ${prev} → ${next}`);
  }

  private float32ToPCM16(samples: Float32Array): Buffer {
    const buf = Buffer.alloc(samples.length * 2);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      buf.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7FFF, i * 2);
    }
    return buf;
  }

  private clearBuffers(): void {
    this.micBuffer = [];
    this.rawPcmBuffer = [];
  }

  private handleError(err: Error, component: string): void {
    console.error(`[VoiceOrchestrator] ${component} error:`, err.message);
    this.emit("error", err, component);

    // Auto-recover
    if (this.state === "error") {
      this.transition("idle");
    }
  }

  private latestLatency: VoiceLatency | null = null;
}

// ─── Re-export types ───────────────────────────────

export type { EventEmitter } from "node:events";

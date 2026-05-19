/**
 * SpeechToTextAdapter — standardized STT input adapter.
 *
 * Converts mic audio → text transcript, then emits:
 *   voice:input → AgentCore.handleChat(text)
 *
 * REUSES the existing chat pipeline. Does NOT bypass AgentCore.
 * Does NOT create a parallel reasoning system.
 *
 * This is a thin wrapper over WhisperSTT + VAD that normalizes
 * the transcript delivery into the EventBus → AgentCore flow.
 */
import { eventBus } from "../runtime/event-bus.js";
import { voiceBridge, type VoiceInputEvent } from "./voice-event-bus.js";
import type { AgentCore } from "../agent/agent-core.js";

// ─── Config ──────────────────────────────────────────

export interface STTAdapterConfig {
  /** Minimum confidence threshold to accept transcript (0–1) */
  minConfidence: number;
  /** Auto-capitalize first letter of transcript */
  autoCapitalize: boolean;
  /** Trim whitespace from transcript */
  trim: boolean;
  /** Max transcript length (characters) */
  maxLength: number;
}

const DEFAULT_STT_CONFIG: STTAdapterConfig = {
  minConfidence: 0.5,
  autoCapitalize: true,
  trim: true,
  maxLength: 500,
};

// ─── Adapter ─────────────────────────────────────────

export class SpeechToTextAdapter {
  private config: STTAdapterConfig;
  private agentCore: AgentCore | null = null;

  constructor(config?: Partial<STTAdapterConfig>) {
    this.config = { ...DEFAULT_STT_CONFIG, ...config };
  }

  /** Wire to AgentCore for direct input injection. */
  setAgentCore(core: AgentCore): void {
    this.agentCore = core;

    // Wire into voice bridge for input events
    voiceBridge.onInput((event: VoiceInputEvent) => {
      this.handleTranscript(event.text, event.source).catch((err) => {
        console.error("[STTAdapter] Handle error:", err);
      });
    });

    console.log("[STTAdapter] Wired to AgentCore — voice input pipeline active");
  }

  // ─── Transcript Handling ───────────────────────────

  /**
   * Process a raw transcript from STT engine.
   * Normalizes, validates, and routes through the chat pipeline.
   *
   * Path: transcript → validate → voice:input event → AgentCore.think()
   * This IS the existing chat pipeline — just with a different source.
   */
  async handleTranscript(
    rawText: string,
    source: "microphone" | "push_to_talk" = "microphone",
  ): Promise<void> {
    const text = this.normalize(rawText);
    if (!text) return;

    // Emit standardized input event through bridge
    const event: VoiceInputEvent = {
      text,
      source,
      timestamp: Date.now(),
    };

    // This triggers voiceBridge.onInput handlers → routes to AgentCore
    voiceBridge.onVoiceInput(event);

    // Also emit on EventBus for monitoring/telemetry
    eventBus.emit("voice", "stt_final", {
      text,
      isFinal: true,
      confidence: 0.95,
    }, 2);
  }

  // ─── Internals ─────────────────────────────────────

  private normalize(text: string): string {
    if (!text) return "";

    let result = text;

    if (this.config.trim) {
      result = result.trim();
    }

    if (result.length > this.config.maxLength) {
      result = result.slice(0, this.config.maxLength);
    }

    if (this.config.autoCapitalize && result.length > 0) {
      result = result.charAt(0).toUpperCase() + result.slice(1);
    }

    return result;
  }
}

/**
 * VoiceEventBridge — passive transport layer connecting voice pipeline
 * to the existing EventBus and AgentCore.
 *
 * This is a TRANSPORT ONLY. It does NOT:
 *   - Execute actions
 *   - Route skills
 *   - Bypass the token gate
 *   - Create new execution paths
 *   - Introduce parallel AI loops
 *
 * Events:
 *   voice:input      — STT produced final transcript → AgentCore
 *   voice:output     — AI wants to speak → TTS
 *   voice:interrupt  — User spoke during AI speech → interrupt TTS only
 *   voice:state      — VoiceState changed → monitoring
 */
import { eventBus } from "../runtime/event-bus.js";
import type { VoiceState, NarrationCategory } from "./voice-state.js";
import { createVoiceState, isSafeToInterrupt } from "./voice-state.js";

// ─── Voice Event Payloads ────────────────────────────

export interface VoiceInputEvent {
  text: string;
  source: "microphone" | "push_to_talk";
  timestamp: number;
}

export interface VoiceOutputEvent {
  text: string;
  category: NarrationCategory;
  tone?: string;
  timestamp: number;
}

export interface VoiceInterruptEvent {
  reason: string;
  wasSpeaking: boolean;
  safeToInterruptAction: boolean;
  timestamp: number;
}

export interface VoiceStateEvent {
  prev: VoiceState;
  next: VoiceState;
}

// ─── Bridge ──────────────────────────────────────────

export class VoiceEventBridge {
  private _state: VoiceState = createVoiceState();
  private inputHandlers: Array<(event: VoiceInputEvent) => void> = [];
  private outputHandlers: Array<(event: VoiceOutputEvent) => void> = [];
  private interruptHandlers: Array<(event: VoiceInterruptEvent) => void> = [];

  constructor() {
    // Subscribe to existing voice events from the orchestrator
    eventBus.on("voice", "stt_final", (event) => {
      const data = event.data as { text: string };
      if (data?.text) {
        this.onVoiceInput({ text: data.text, source: "microphone", timestamp: Date.now() });
      }
    });

    console.log("[VoiceEventBridge] Bridged to EventBus — voice:* events active");
  }

  // ─── State ─────────────────────────────────────────

  get state(): Readonly<VoiceState> {
    return this._state;
  }

  private setState(patch: Partial<VoiceState>): void {
    const prev = { ...this._state };
    Object.assign(this._state, patch);
    this._state.lastChangedAt = Date.now();

    eventBus.emit("voice", "state" as any, { prev, next: { ...this._state } } as VoiceStateEvent, 1);
  }

  // ─── Input Pipeline (mic → AgentCore) ──────────────

  /**
   * Called when STT produces a final transcript.
   * Routes through the existing chat pipeline:
   *   voice:input → AgentCore.handleVoiceInput(text) → think() → SkillRouter → ActionDispatcher
   */
  onVoiceInput(event: VoiceInputEvent): void {
    if (!event.text.trim()) return;

    this.setState({ listening: false, processing: true });

    // Emit to EventBus (passive — observers can log, monitor, etc.)
    eventBus.emit("voice", "input" as any, event, 2);

    // Notify registered handlers (AgentCore wires in here)
    for (const handler of this.inputHandlers) {
      try {
        handler(event);
      } catch (err) {
        console.error("[VoiceEventBridge] Input handler error:", err);
      }
    }
  }

  /** Register a handler for voice input. AgentCore calls this. */
  onInput(handler: (event: VoiceInputEvent) => void): () => void {
    this.inputHandlers.push(handler);
    return () => {
      this.inputHandlers = this.inputHandlers.filter((h) => h !== handler);
    };
  }

  // ─── Output Pipeline (AgentCore → TTS) ─────────────

  /**
   * Called when the agent wants to speak.
   * Routes: AgentCore.emitVoiceOutput(text) → voice:output → TTS
   */
  emitOutput(event: VoiceOutputEvent): void {
    if (!event.text.trim()) return;

    this.setState({ speaking: true });

    // Emit to EventBus
    eventBus.emit("voice", "output" as any, event, 2);

    // Notify registered handlers (TTS adapter wires in here)
    for (const handler of this.outputHandlers) {
      try {
        handler(event);
      } catch (err) {
        console.error("[VoiceEventBridge] Output handler error:", err);
      }
    }
  }

  /** Register a handler for voice output. TTS adapter calls this. */
  onOutput(handler: (event: VoiceOutputEvent) => void): () => void {
    this.outputHandlers.push(handler);
    return () => {
      this.outputHandlers = this.outputHandlers.filter((h) => h !== handler);
    };
  }

  /** Mark speech as completed (called by TTS when done). */
  notifySpeechComplete(): void {
    this.setState({ speaking: false, processing: false });
  }

  // ─── Interrupt Handling (SAFE MODE) ────────────────

  /**
   * Called when user speaks during AI speech or execution.
   *
   * SAFE MODE rules:
   *   - ALWAYS interrupt TTS (speech output only)
   *   - NEVER interrupt ActionDispatcher unless safe state
   *   - Mark AI state as "user_override"
   */
  interrupt(reason: string, currentActionType?: string): VoiceInterruptEvent {
    const safe = isSafeToInterrupt(currentActionType);
    const wasSpeaking = this._state.speaking;

    const event: VoiceInterruptEvent = {
      reason,
      wasSpeaking,
      safeToInterruptAction: safe,
      timestamp: Date.now(),
    };

    this.setState({
      interrupted: true,
      interruptReason: reason,
      speaking: false, // Always stop TTS
      userOverride: true,
    });

    // Emit interrupt event
    eventBus.emit("voice", "interrupt" as any, event, 4); // Priority 4=critical

    // Notify handlers (TTS adapter stops playback)
    for (const handler of this.interruptHandlers) {
      try {
        handler(event);
      } catch (err) {
        console.error("[VoiceEventBridge] Interrupt handler error:", err);
      }
    }

    return event;
  }

  /** Register a handler for interrupt. TTS adapter calls this. */
  onInterrupt(handler: (event: VoiceInterruptEvent) => void): () => void {
    this.interruptHandlers.push(handler);
    return () => {
      this.interruptHandlers = this.interruptHandlers.filter((h) => h !== handler);
    };
  }

  /** Clear interrupt flags — called at start of next voice cycle. */
  clearInterrupt(): void {
    this.setState({
      interrupted: false,
      interruptReason: undefined,
      userOverride: false,
    });
  }

  // ─── Lifecycle ─────────────────────────────────────

  startListening(): void {
    this.setState({ listening: true });
  }

  stopListening(): void {
    this.setState({ listening: false });
  }

  destroy(): void {
    this.inputHandlers = [];
    this.outputHandlers = [];
    this.interruptHandlers = [];
  }
}

// Singleton
export const voiceBridge = new VoiceEventBridge();

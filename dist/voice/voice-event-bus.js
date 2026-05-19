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
import { createVoiceState, isSafeToInterrupt } from "./voice-state.js";
// ─── Bridge ──────────────────────────────────────────
export class VoiceEventBridge {
    _state = createVoiceState();
    inputHandlers = [];
    outputHandlers = [];
    interruptHandlers = [];
    constructor() {
        // Subscribe to existing voice events from the orchestrator
        eventBus.on("voice", "stt_final", (event) => {
            const data = event.data;
            if (data?.text) {
                this.onVoiceInput({ text: data.text, source: "microphone", timestamp: Date.now() });
            }
        });
        console.log("[VoiceEventBridge] Bridged to EventBus — voice:* events active");
    }
    // ─── State ─────────────────────────────────────────
    get state() {
        return this._state;
    }
    setState(patch) {
        const prev = { ...this._state };
        Object.assign(this._state, patch);
        this._state.lastChangedAt = Date.now();
        eventBus.emit("voice", "state", { prev, next: { ...this._state } }, 1);
    }
    // ─── Input Pipeline (mic → AgentCore) ──────────────
    /**
     * Called when STT produces a final transcript.
     * Routes through the existing chat pipeline:
     *   voice:input → AgentCore.handleVoiceInput(text) → think() → SkillRouter → ActionDispatcher
     */
    onVoiceInput(event) {
        if (!event.text.trim())
            return;
        this.setState({ listening: false, processing: true });
        // Emit to EventBus (passive — observers can log, monitor, etc.)
        eventBus.emit("voice", "input", event, 2);
        // Notify registered handlers (AgentCore wires in here)
        for (const handler of this.inputHandlers) {
            try {
                handler(event);
            }
            catch (err) {
                console.error("[VoiceEventBridge] Input handler error:", err);
            }
        }
    }
    /** Register a handler for voice input. AgentCore calls this. */
    onInput(handler) {
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
    emitOutput(event) {
        if (!event.text.trim())
            return;
        this.setState({ speaking: true });
        // Emit to EventBus
        eventBus.emit("voice", "output", event, 2);
        // Notify registered handlers (TTS adapter wires in here)
        for (const handler of this.outputHandlers) {
            try {
                handler(event);
            }
            catch (err) {
                console.error("[VoiceEventBridge] Output handler error:", err);
            }
        }
    }
    /** Register a handler for voice output. TTS adapter calls this. */
    onOutput(handler) {
        this.outputHandlers.push(handler);
        return () => {
            this.outputHandlers = this.outputHandlers.filter((h) => h !== handler);
        };
    }
    /** Mark speech as completed (called by TTS when done). */
    notifySpeechComplete() {
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
    interrupt(reason, currentActionType) {
        const safe = isSafeToInterrupt(currentActionType);
        const wasSpeaking = this._state.speaking;
        const event = {
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
        eventBus.emit("voice", "interrupt", event, 4); // Priority 4=critical
        // Notify handlers (TTS adapter stops playback)
        for (const handler of this.interruptHandlers) {
            try {
                handler(event);
            }
            catch (err) {
                console.error("[VoiceEventBridge] Interrupt handler error:", err);
            }
        }
        return event;
    }
    /** Register a handler for interrupt. TTS adapter calls this. */
    onInterrupt(handler) {
        this.interruptHandlers.push(handler);
        return () => {
            this.interruptHandlers = this.interruptHandlers.filter((h) => h !== handler);
        };
    }
    /** Clear interrupt flags — called at start of next voice cycle. */
    clearInterrupt() {
        this.setState({
            interrupted: false,
            interruptReason: undefined,
            userOverride: false,
        });
    }
    // ─── Lifecycle ─────────────────────────────────────
    startListening() {
        this.setState({ listening: true });
    }
    stopListening() {
        this.setState({ listening: false });
    }
    destroy() {
        this.inputHandlers = [];
        this.outputHandlers = [];
        this.interruptHandlers = [];
    }
}
// Singleton
export const voiceBridge = new VoiceEventBridge();
//# sourceMappingURL=voice-event-bus.js.map
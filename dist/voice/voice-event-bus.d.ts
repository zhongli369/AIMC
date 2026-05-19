import type { VoiceState, NarrationCategory } from "./voice-state.js";
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
export declare class VoiceEventBridge {
    private _state;
    private inputHandlers;
    private outputHandlers;
    private interruptHandlers;
    constructor();
    get state(): Readonly<VoiceState>;
    private setState;
    /**
     * Called when STT produces a final transcript.
     * Routes through the existing chat pipeline:
     *   voice:input → AgentCore.handleVoiceInput(text) → think() → SkillRouter → ActionDispatcher
     */
    onVoiceInput(event: VoiceInputEvent): void;
    /** Register a handler for voice input. AgentCore calls this. */
    onInput(handler: (event: VoiceInputEvent) => void): () => void;
    /**
     * Called when the agent wants to speak.
     * Routes: AgentCore.emitVoiceOutput(text) → voice:output → TTS
     */
    emitOutput(event: VoiceOutputEvent): void;
    /** Register a handler for voice output. TTS adapter calls this. */
    onOutput(handler: (event: VoiceOutputEvent) => void): () => void;
    /** Mark speech as completed (called by TTS when done). */
    notifySpeechComplete(): void;
    /**
     * Called when user speaks during AI speech or execution.
     *
     * SAFE MODE rules:
     *   - ALWAYS interrupt TTS (speech output only)
     *   - NEVER interrupt ActionDispatcher unless safe state
     *   - Mark AI state as "user_override"
     */
    interrupt(reason: string, currentActionType?: string): VoiceInterruptEvent;
    /** Register a handler for interrupt. TTS adapter calls this. */
    onInterrupt(handler: (event: VoiceInterruptEvent) => void): () => void;
    /** Clear interrupt flags — called at start of next voice cycle. */
    clearInterrupt(): void;
    startListening(): void;
    stopListening(): void;
    destroy(): void;
}
export declare const voiceBridge: VoiceEventBridge;
//# sourceMappingURL=voice-event-bus.d.ts.map
/**
 * VoiceState — lightweight voice pipeline state.
 *
 * MUST NOT interfere with bot state (BotState) or execution pipeline.
 * This is a read-only sidecar that the voice layer watches.
 */
export interface VoiceState {
    /** TTS is actively producing audio output */
    speaking: boolean;
    /** Microphone is capturing (VAD detected speech or push-to-talk active) */
    listening: boolean;
    /** User speech interrupted AI speech or action narration */
    interrupted: boolean;
    /** Interruption reason (if interrupted) */
    interruptReason?: string;
    /** Whether the agent is currently processing a voice request */
    processing: boolean;
    /** User override flag — set when user interrupts; cleared on next cycle */
    userOverride: boolean;
    /** Timestamp of last state change */
    lastChangedAt: number;
}
export declare function createVoiceState(): VoiceState;
/** Execution-safe check: is it safe to interrupt the current action? */
export declare function isSafeToInterrupt(actionType?: string): boolean;
/** TTS narration categories — what the bot is narrating */
export type NarrationCategory = "chat_response" | "skill_start" | "skill_complete" | "skill_failed" | "fallback_activated" | "critical_alert" | "idle_thought" | "proactive_action";
//# sourceMappingURL=voice-state.d.ts.map
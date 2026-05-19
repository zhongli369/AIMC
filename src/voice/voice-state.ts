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

export function createVoiceState(): VoiceState {
  return {
    speaking: false,
    listening: false,
    interrupted: false,
    processing: false,
    userOverride: false,
    lastChangedAt: Date.now(),
  };
}

/** Execution-safe check: is it safe to interrupt the current action? */
export function isSafeToInterrupt(actionType?: string): boolean {
  // NEVER interrupt while the bot is in a dangerous position
  const unsafeActions = [
    "dig_down",
    "attack_entity",
    "flee",
    "mine_block",
    "place_block",
  ];
  if (actionType && unsafeActions.includes(actionType)) return false;
  return true;
}

/** TTS narration categories — what the bot is narrating */
export type NarrationCategory =
  | "chat_response"
  | "skill_start"
  | "skill_complete"
  | "skill_failed"
  | "fallback_activated"
  | "critical_alert"
  | "idle_thought"
  | "proactive_action";

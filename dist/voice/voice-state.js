/**
 * VoiceState — lightweight voice pipeline state.
 *
 * MUST NOT interfere with bot state (BotState) or execution pipeline.
 * This is a read-only sidecar that the voice layer watches.
 */
export function createVoiceState() {
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
export function isSafeToInterrupt(actionType) {
    // NEVER interrupt while the bot is in a dangerous position
    const unsafeActions = [
        "dig_down",
        "attack_entity",
        "flee",
        "mine_block",
        "place_block",
    ];
    if (actionType && unsafeActions.includes(actionType))
        return false;
    return true;
}
//# sourceMappingURL=voice-state.js.map
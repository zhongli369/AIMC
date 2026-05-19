/**
 * VoicePressureModel — soft control layer that maps voice tone/intent
 * to execution timing modifiers.
 *
 * This is a READ-ONLY influence layer. It does NOT:
 *   - Execute actions
 *   - Route skills
 *   - Bypass the token gate
 *   - Modify the execution chain
 *
 * It ONLY supplies timing/weighting hints that SkillRouter and
 * TaskPlanner may optionally consume.
 */
// ─── Factory ──────────────────────────────────────────
const NEUTRAL_SOURCE = {
    keywords: [],
    repetitionCount: 0,
    punctuationIntensity: 0,
    interruptCount: 0,
};
export function createNeutralSignal() {
    return {
        level: "normal",
        intensity: 0,
        confidence: 1.0,
        source: { ...NEUTRAL_SOURCE },
        timestamp: Date.now(),
    };
}
/**
 * Compute timing modifiers from a pressure signal.
 * Returns multipliers that SkillRouter and TaskPlanner consume.
 *
 * @param signal — voice pressure signal from VAD/STT analyzer
 * @param sensitivity — configurable multiplier (1.0 = default, >1 = more sensitive, <1 = dampened)
 */
export function computeTimingModifiers(signal, sensitivity = 1.0) {
    const { level, intensity } = signal;
    // Apply sensitivity: scale the effective intensity
    const effectiveIntensity = Math.min(1.0, intensity * sensitivity);
    switch (level) {
        case "critical":
            return {
                retryDelayMultiplier: Math.max(0.3, 1.0 - effectiveIntensity * 0.7),
                timeoutMultiplier: Math.max(0.4, 1.0 - effectiveIntensity * 0.6),
                fallbackSpeedMultiplier: Math.max(0.25, 1.0 - effectiveIntensity * 0.75),
                extraRetries: Math.round(effectiveIntensity * 2),
            };
        case "urgent":
            return {
                retryDelayMultiplier: Math.max(0.5, 1.0 - effectiveIntensity * 0.5),
                timeoutMultiplier: Math.max(0.6, 1.0 - effectiveIntensity * 0.4),
                fallbackSpeedMultiplier: Math.max(0.5, 1.0 - effectiveIntensity * 0.5),
                extraRetries: Math.round(effectiveIntensity * 1),
            };
        case "calm":
            return {
                retryDelayMultiplier: 1.0 + effectiveIntensity * 0.3,
                timeoutMultiplier: 1.0 + effectiveIntensity * 0.3,
                fallbackSpeedMultiplier: 1.0 + effectiveIntensity * 0.2,
                extraRetries: 0,
            };
        case "normal":
        default:
            return {
                retryDelayMultiplier: 1.0,
                timeoutMultiplier: 1.0,
                fallbackSpeedMultiplier: 1.0,
                extraRetries: 0,
            };
    }
}
/**
 * Compute skill priority bias from pressure signal.
 * Under critical/urgent pressure: survival > combat > movement > gathering > building.
 */
export function computeSkillBias(signal) {
    const { level, intensity } = signal;
    if (level === "critical") {
        return {
            survival: 1.0 + intensity * 0.8,
            combat: 1.0 + intensity * 0.6,
            gathering: 1.0 - intensity * 0.3,
            movement: 1.0 + intensity * 0.2,
            building: 1.0 - intensity * 0.5,
        };
    }
    if (level === "urgent") {
        return {
            survival: 1.0 + intensity * 0.4,
            combat: 1.0 + intensity * 0.3,
            gathering: 1.0 - intensity * 0.1,
            movement: 1.0 + intensity * 0.1,
            building: 1.0 - intensity * 0.2,
        };
    }
    // Calm/normal: no bias
    return {
        survival: 1.0,
        combat: 1.0,
        gathering: 1.0,
        movement: 1.0,
        building: 1.0,
    };
}
/**
 * Apply timing modifiers to a base retry config.
 * Returns the adjusted values without mutating the input.
 */
export function applyRetryModifiers(baseDelayMs, maxDelayMs, maxRetries, modifiers) {
    return {
        baseDelayMs: Math.round(baseDelayMs * modifiers.retryDelayMultiplier),
        maxDelayMs: Math.round(maxDelayMs * modifiers.retryDelayMultiplier),
        maxRetries: maxRetries + modifiers.extraRetries,
    };
}
/**
 * Apply timing modifiers to a step timeout.
 */
export function applyTimeoutModifier(baseTimeoutMs, modifiers) {
    return Math.round(baseTimeoutMs * modifiers.timeoutMultiplier);
}
//# sourceMappingURL=voice-pressure.js.map
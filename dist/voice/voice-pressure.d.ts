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
export type VoicePressureLevel = "calm" | "normal" | "urgent" | "critical";
export interface VoicePressureSignal {
    /** Pressure level derived from voice analysis */
    level: VoicePressureLevel;
    /** Intensity 0–1 (how strongly the pressure applies) */
    intensity: number;
    /** Confidence in the classification 0–1 */
    confidence: number;
    /** What triggered this pressure (keywords, repetition, interruption) */
    source: VoicePressureSource;
    /** Timestamp of analysis */
    timestamp: number;
}
export interface VoicePressureSource {
    /** Matched urgency keywords */
    keywords: string[];
    /** How many times the user repeated the same command */
    repetitionCount: number;
    /** Punctuation intensity (0–1) */
    punctuationIntensity: number;
    /** Number of voice interrupts in recent window */
    interruptCount: number;
}
/**
 * Timing multipliers derived from voice pressure.
 * Applied by SkillRouter and TaskPlanner as soft modifiers.
 *
 * All multipliers default to 1.0 (no change).
 * < 1.0 = faster (urgent), > 1.0 = slower (calm).
 */
export interface VoiceTimingModifiers {
    /** Retry delay multiplier (< 1.0 = retry faster) */
    retryDelayMultiplier: number;
    /** Step timeout multiplier (< 1.0 = tighter deadline) */
    timeoutMultiplier: number;
    /** Fallback speed multiplier (< 1.0 = trigger fallback sooner) */
    fallbackSpeedMultiplier: number;
    /** How many extra retries to allow (> 0 = more retries) */
    extraRetries: number;
}
/**
 * Skill category priority bias from voice pressure.
 * Higher value = prefer this category when under pressure.
 */
export interface VoiceSkillBias {
    survival: number;
    combat: number;
    gathering: number;
    movement: number;
    building: number;
}
export declare function createNeutralSignal(): VoicePressureSignal;
/**
 * Compute timing modifiers from a pressure signal.
 * Returns multipliers that SkillRouter and TaskPlanner consume.
 *
 * @param signal — voice pressure signal from VAD/STT analyzer
 * @param sensitivity — configurable multiplier (1.0 = default, >1 = more sensitive, <1 = dampened)
 */
export declare function computeTimingModifiers(signal: VoicePressureSignal, sensitivity?: number): VoiceTimingModifiers;
/**
 * Compute skill priority bias from pressure signal.
 * Under critical/urgent pressure: survival > combat > movement > gathering > building.
 */
export declare function computeSkillBias(signal: VoicePressureSignal): VoiceSkillBias;
/**
 * Apply timing modifiers to a base retry config.
 * Returns the adjusted values without mutating the input.
 */
export declare function applyRetryModifiers(baseDelayMs: number, maxDelayMs: number, maxRetries: number, modifiers: VoiceTimingModifiers): {
    baseDelayMs: number;
    maxDelayMs: number;
    maxRetries: number;
};
/**
 * Apply timing modifiers to a step timeout.
 */
export declare function applyTimeoutModifier(baseTimeoutMs: number, modifiers: VoiceTimingModifiers): number;
//# sourceMappingURL=voice-pressure.d.ts.map
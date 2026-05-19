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

// ─── Pressure Level ──────────────────────────────────

export type VoicePressureLevel = "calm" | "normal" | "urgent" | "critical";

// ─── Pressure Signal ──────────────────────────────────

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

// ─── Timing Modifiers ─────────────────────────────────

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

// ─── Skill Priority Bias ──────────────────────────────

/**
 * Skill category priority bias from voice pressure.
 * Higher value = prefer this category when under pressure.
 */
export interface VoiceSkillBias {
  survival: number;   // defend_player, gather_food
  combat: number;     // attack_target
  gathering: number;  // mine_resource, collect_items
  movement: number;   // follow_player, explore_area
  building: number;   // build_shelter
}

// ─── Factory ──────────────────────────────────────────

const NEUTRAL_SOURCE: VoicePressureSource = {
  keywords: [],
  repetitionCount: 0,
  punctuationIntensity: 0,
  interruptCount: 0,
};

export function createNeutralSignal(): VoicePressureSignal {
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
export function computeTimingModifiers(
  signal: VoicePressureSignal,
  sensitivity: number = 1.0,
): VoiceTimingModifiers {
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
export function computeSkillBias(
  signal: VoicePressureSignal,
): VoiceSkillBias {
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
export function applyRetryModifiers(
  baseDelayMs: number,
  maxDelayMs: number,
  maxRetries: number,
  modifiers: VoiceTimingModifiers,
): { baseDelayMs: number; maxDelayMs: number; maxRetries: number } {
  return {
    baseDelayMs: Math.round(baseDelayMs * modifiers.retryDelayMultiplier),
    maxDelayMs: Math.round(maxDelayMs * modifiers.retryDelayMultiplier),
    maxRetries: maxRetries + modifiers.extraRetries,
  };
}

/**
 * Apply timing modifiers to a step timeout.
 */
export function applyTimeoutModifier(
  baseTimeoutMs: number,
  modifiers: VoiceTimingModifiers,
): number {
  return Math.round(baseTimeoutMs * modifiers.timeoutMultiplier);
}

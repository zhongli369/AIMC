/**
 * PersonalityEngine — trait-based decision influence layer.
 *
 * Integrates personality profile + emotion state to modulate:
 *   - Action preference weights
 *   - Risk tolerance thresholds
 *   - Speech tone selection
 *   - Proactive behavior probability
 */
import type { PersonalityProfile, PersonalityDimensions, SpeechTone } from "./personality-profile.js";
import type { EmotionEngine } from "./emotion-engine.js";
export interface ActionPreference {
    /** Action type */
    actionType: string;
    /** Weight multiplier (1.0 = neutral, >1 preferred, <1 avoided) */
    weight: number;
}
export interface DecisionContext {
    /** Current health % (0–100) */
    healthPercent: number;
    /** Nearby hostile entities count */
    nearbyHostiles: number;
    /** Player within 32 blocks */
    playerNearby: boolean;
    /** Time since last action (ms) */
    idleTimeMs: number;
    /** Memory of recent failures for this action type */
    recentFailures: number;
}
export declare class PersonalityEngine {
    private profile;
    private emotion;
    constructor(profile: PersonalityProfile, emotion: EmotionEngine);
    getProfile(): PersonalityProfile;
    updateProfile(profile: PersonalityProfile): void;
    getTraits(): PersonalityDimensions;
    /**
     * Compute how much the personality prefers a given action type.
     * Returns weight multiplier (0.5–2.0 range).
     */
    getActionWeight(actionType: string): number;
    /**
     * Compute risk tolerance threshold (0–1).
     * Higher = more willing to take risks.
     */
    getRiskTolerance(context: DecisionContext): number;
    /**
     * Select the appropriate speech tone based on personality + emotion.
     */
    getSpeechTone(): SpeechTone;
    /**
     * Should the agent perform a proactive action right now?
     * Probability modulated by personality + emotion + context.
     */
    shouldActProactively(context: DecisionContext): boolean;
    /**
     * Rank a set of candidate actions by personality preference.
     * Returns sorted actions with weights.
     */
    rankActions(actionTypes: string[]): ActionPreference[];
    /**
     * Generate personality-driven behavior hints for the LLM system prompt.
     * These are injected as behavioral guidance, not commands.
     */
    getBehaviorHints(context: DecisionContext): string[];
}
//# sourceMappingURL=personality-engine.d.ts.map
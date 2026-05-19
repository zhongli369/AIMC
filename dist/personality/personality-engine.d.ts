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
import type { CompanionRole } from "../role/role-identity.js";
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
     * Compute personality preference weight for a given skill.
     * Maps skill categories to personality dimensions.
     */
    getSkillWeight(skillName: string): number;
    /**
     * Rank skills by personality preference.
     * Returns sorted skill names with weights.
     */
    rankSkills(skillNames: string[]): Array<{
        skillName: string;
        weight: number;
    }>;
    /**
     * Voice tone for TTS output based on bot activity state.
     *
     * Maps state → speech tone. Affects ONLY voice output, NOT decisions.
     * Decision-making continues to use getBehaviorHints() and trait-based weights.
     *
     * Tone categories:
     *   focused  — mining, building, crafting (concentrated attention)
     *   alert    — combat, hostiles nearby (urgent, concise)
     *   calm     — idle, following player, observing
     *   cautious — fallback activated, low health, recent failures
     *   curious  — exploring new area, finding resources
     *   friendly  — chatting, social interaction
     */
    getVoiceTone(activityContext: {
        currentSkill?: string;
        skillFailed?: boolean;
        fallbackActive?: boolean;
        healthLow?: boolean;
        hostilesNearby?: boolean;
        isExploring?: boolean;
        isChatting?: boolean;
        isIdle?: boolean;
    }): "focused" | "alert" | "calm" | "cautious" | "curious" | "friendly";
    /**
     * Get SSML prosody hints for Edge TTS based on voice tone.
     * Returns rate and pitch modifiers that match the emotional tone.
     *
     * Output ONLY — does not affect decision-making.
     */
    getVoiceProsody(tone: ReturnType<typeof this.getVoiceTone>): {
        rate: number;
        pitch: string;
    };
    /**
     * Get role-based voice profile for narration style (Phase 4-D).
     *
     * Maps companion role → voice characteristics.
     * Affects NARRATION ONLY — not decision-making, not execution.
     *
     * Role mappings:
     *   fighter  → direct, decisive, faster pacing
     *   miner    → practical, task-focused, neutral pacing
     *   scout    → curious, observant, slightly faster pacing
     *   support  → calm, reassuring, slightly slower pacing
     *   balanced → versatile, adaptable, neutral pacing
     */
    getRoleVoiceProfile(role: CompanionRole): {
        voiceStyle: "direct" | "calm" | "curious" | "practical" | "versatile";
        confidenceStyle: "decisive" | "reassuring" | "observant" | "task-focused" | "adaptable";
        narrationPacing: number;
        label: string;
    };
    /**
     * Adjust voice tone selection based on companion role (Phase 4-D).
     *
     * Role acts as an overlay on the base personality+emotion tone:
     *   - fighter overrides cautious/calm → alert (if danger) or focused
     *   - support always prefers calm/reassuring unless combat
     *   - scout prefers curious unless danger
     *   - miner prefers focused/practical
     *   - balanced uses personality default (no override)
     */
    applyRoleToVoiceTone(baseTone: ReturnType<typeof this.getVoiceTone>, role: CompanionRole): "focused" | "alert" | "calm" | "cautious" | "curious" | "friendly";
    /**
     * Get interaction warmth modifier based on relationship familiarity (Phase 4-E).
     *
     * Scales the companion's interaction style:
     *   Low familiarity (0–25)  → more formal, explanatory, respectful distance
     *   Medium (25–60)          → friendly, supportive, growing trust
     *   High (60–85)            → close, natural references, proactive support
     *   Very high (85–100)      → familial, shorthand communication, high initiative
     *
     * Returns modifiers for: formality, explanation level, initiative, phrasing style
     */
    getInteractionWarmth(familiarityLevel: number, trustLevel: number): {
        formality: number;
        explanationLevel: number;
        initiativeComfort: number;
        phrasingStyle: "respectful" | "friendly" | "casual" | "intimate";
        /** How much to reference shared history in speech */
        callbackFrequency: number;
    };
    /**
     * Generate familiarity-aware speech guidance (Phase 4-E).
     *
     * Returns short behavioral guidance strings for LLM context.
     * These affect TONE and PHRASING only — NOT decisions.
     */
    getFamiliarityHints(familiarityLevel: number, trustLevel: number): string[];
    /**
     * Compute trust-aware speech confidence (Phase 4-E).
     *
     * High trust → companion phrases suggestions more confidently.
     * Low trust → companion is more tentative, explains reasoning.
     */
    getTrustSpeechConfidence(trustLevel: number): number;
    /**
     * Get companion tone drift based on long-term familiarity (Phase 4-E).
     *
     * Over long periods, the companion's base personality traits
     * slightly shift to reflect the relationship:
     *   - sociability increases with familiarity
     *   - cautiousness decreases with trust
     *   - helpfulness increases with affinity
     *
     * Returns MODIFIERS only — does not change stored profile.
     */
    getLongTermToneDrift(params: {
        familiarityLevel: number;
        trustLevel: number;
        emotionalAffinity: number;
    }): {
        sociabilityDrift: number;
        cautiousnessDrift: number;
        helpfulnessDrift: number;
        humorDrift: number;
    };
    /**
     * Get familiarity-based initiative confidence (Phase 4-F).
     *
     * Low trust: asks before major support actions, stays conservative.
     * High trust: proactively guards, auto-assists, tighter formation.
     *
     * Affects INITIATIVE CONFIDENCE ONLY — NOT execution permissions.
     */
    getCooperativeInitiative(params: {
        familiarityLevel: number;
        trustLevel: number;
        teamworkScore: number;
    }): {
        /** 0–1, how confidently the companion acts without being asked */
        initiativeConfidence: number;
        /** Whether companion should ask before major actions */
        askBeforeMajorAction: boolean;
        /** How likely companion is to auto-assist mining */
        autoAssistMining: boolean;
        /** How likely companion is to auto-guard */
        autoGuardEnabled: boolean;
        /** How tightly to maintain formation (0 = loose, 1 = tight) */
        formationTightness: number;
    };
    /**
     * Trust-aware proactive behavior hints (Phase 4-F).
     *
     * Returns behavioral guidance that adjusts how the companion
     * expresses support intentions. These affect SPEECH AND TONE ONLY.
     */
    getCooperativeHints(params: {
        familiarityLevel: number;
        trustLevel: number;
        teamworkScore: number;
    }): string[];
    /**
     * Generate personality-driven behavior hints for the LLM system prompt.
     * These are injected as behavioral guidance, not commands.
     */
    getBehaviorHints(context: DecisionContext): string[];
}
//# sourceMappingURL=personality-engine.d.ts.map
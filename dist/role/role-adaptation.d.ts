/**
 * RoleAdaptationEngine — long-term behavior pattern analysis.
 *
 * Observes skill execution patterns over time and slowly adjusts
 * companion role identity. Prevents rapid role switching.
 *
 * This is ANALYSIS ONLY. It does NOT:
 *   - Execute actions
 *   - Call bot.*() directly
 *   - Create new execution paths
 *   - Bypass SkillRouter
 *
 * Output: role switch recommendations consumed by AgentCore → SkillRouter.
 */
import type { CompanionRole, CompanionIdentity } from "./role-identity.js";
export interface AdaptationConfig {
    /** Minimum ms between role switches */
    minSwitchIntervalMs: number;
    /** Confidence must exceed current by this margin to switch */
    switchThreshold: number;
    /** EMA smoothing factor for confidence updates (0–1, lower = slower) */
    confidenceSmoothing: number;
    /** Max confidence cap */
    maxConfidence: number;
    /** Observation threshold before trait is considered "dominant" */
    traitThreshold: number;
    /** Max observation window (older observations decay) */
    observationWindowMs: number;
}
export declare class RoleAdaptationEngine {
    private identity;
    private config;
    /** Per-skill observation counts with timestamps */
    private skillObservations;
    /** Implicit confidence scores for each role (derived from observations) */
    private implicitConfidence;
    constructor(identity?: CompanionIdentity, config?: Partial<AdaptationConfig>);
    /**
     * Record a skill execution observation.
     * Call after each skill execution completes (success or failure).
     */
    observe(skillName: string, success: boolean): void;
    /**
     * Evaluate whether role should change based on accumulated evidence.
     * Returns recommendation — caller decides whether to apply.
     */
    evaluate(): {
        shouldSwitch: boolean;
        recommendedRole: CompanionRole;
        confidence: number;
        currentConfidence: number;
        reason: string;
    };
    /**
     * Apply a role switch. Updates identity history and resets transient state.
     */
    switchRole(role: CompanionRole, reason: string): void;
    getIdentity(): Readonly<CompanionIdentity>;
    /** Replace identity entirely (e.g., after loading from disk). */
    setIdentity(identity: CompanionIdentity): void;
    /**
     * Get role-influenced skill weights.
     * Merges role profile weights with adaptation-derived biases.
     */
    getSkillWeights(): Record<string, number>;
    private updateTraits;
    private updateImplicitConfidence;
}
//# sourceMappingURL=role-adaptation.d.ts.map
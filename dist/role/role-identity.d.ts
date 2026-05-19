/**
 * RoleIdentity — persistent companion role specialization model.
 *
 * Defines 5 companion roles, their behavioral profiles, and
 * the CompanionIdentity that persists across play sessions.
 *
 * This is a DATA MODEL only. It does NOT:
 *   - Execute actions
 *   - Bypass the execution chain
 *   - Create autonomous behavior
 *   - Access Mineflayer
 */
export type CompanionRole = "miner" | "fighter" | "scout" | "support" | "balanced";
export declare const ALL_ROLES: CompanionRole[];
export interface RoleProfile {
    role: CompanionRole;
    /** Human-readable label */
    label: string;
    /** Natural-language description */
    description: string;
    /** Preferred skills (higher weight = more likely selected) */
    preferredSkills: string[];
    /** Avoided skills (lower weight) */
    avoidedSkills: string[];
    /** Base skill weight multipliers (1.0 = neutral) */
    skillWeights: Record<string, number>;
    /** How many extra retries for preferred skills */
    retryBias: number;
    /** How strongly the role biases exploration (0–1) */
    explorationBias: number;
    /** How strongly the role biases support behavior (0–1) */
    supportBias: number;
    /** How strongly the role biases combat engagement (0–1) */
    combatBias: number;
    /** Voice/narration style descriptor */
    voiceStyle: "direct" | "calm" | "curious" | "practical" | "versatile";
    /** Narration pacing modifier (< 1 = faster, > 1 = slower) */
    narrationPacing: number;
    /** Confidence wording style */
    confidenceStyle: "decisive" | "reassuring" | "observant" | "task-focused" | "adaptable";
}
export declare const ROLE_PROFILES: Record<CompanionRole, RoleProfile>;
export interface CompanionIdentity {
    /** Current active role */
    currentRole: CompanionRole;
    /** Confidence in current role (0–1). Stablizes over time. */
    confidence: number;
    /** Role history with timestamps */
    roleHistory: RoleHistoryEntry[];
    /** Most dominant behavior patterns (by observation count) */
    dominantTraits: BehaviorTrait[];
    /** When the identity was created */
    createdAt: number;
    /** When the identity was last updated */
    updatedAt: number;
}
export interface RoleHistoryEntry {
    role: CompanionRole;
    confidence: number;
    reason: string;
    timestamp: number;
}
export interface BehaviorTrait {
    trait: string;
    observationCount: number;
    lastObservedAt: number;
}
export declare function createIdentity(initialRole?: CompanionRole): CompanionIdentity;
export declare function getRoleProfile(role: CompanionRole): RoleProfile;
/**
 * Get the default skill weight for a given skill under a given role.
 * Returns 1.0 if not explicitly defined.
 */
export declare function getRoleSkillWeight(role: CompanionRole, skillName: string): number;
//# sourceMappingURL=role-identity.d.ts.map
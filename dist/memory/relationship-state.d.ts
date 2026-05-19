/**
 * RelationshipState — long-term companion relationship model (Phase 4-E).
 *
 * Tracks familiarity, trust, and teamwork metrics across sessions.
 * This is SOCIAL CONTINUITY ONLY — NOT a second memory system.
 *
 * MUST NOT:
 *   - Execute actions
 *   - Create autonomous planning
 *   - Bypass execution chain
 *   - Access Mineflayer directly
 *
 * All state flows through normal AgentCore → SkillRouter pipeline.
 */
export interface RelationshipState {
    /** 0–100: how familiar the companion is with this player */
    familiarityLevel: number;
    /** 0–100: how much the companion trusts the player */
    trustLevel: number;
    /** 0–100: how well they work together */
    teamworkScore: number;
    /** Unix ms of last session */
    lastSeenAt: number;
    /** Number of distinct sessions played together */
    sessionsTogether: number;
    /** Total ms played together */
    totalPlayTimeMs: number;
    /** Times companion rescued player from danger */
    rescueCount: number;
    /** Shared combat victories */
    sharedVictories: number;
    /** Times both died in same encounter */
    sharedDeaths: number;
    /** Most frequent shared activities */
    favoriteActivities: {
        activity: string;
        count: number;
    }[];
    /** Last N shared memory summaries */
    recentMemories: string[];
    /** Emotional affinity (-1.0 dislike → 1.0 very close) */
    emotionalAffinity: number;
    /** How the companion interacts with this player */
    interactionStyle: "formal" | "friendly" | "close" | "familial";
    /** First session timestamp */
    firstSessionAt: number;
    /** Raw activity counter (internal) */
    activitiesCount: Record<string, number>;
    /** Schema version for persistence */
    schemaVersion: number;
}
/** Lightweight summary safe for LLM prompt injection. */
export interface RelationshipSnapshot {
    /** 0–100 familiarity */
    familiarity: number;
    /** 0–100 trust */
    trust: number;
    /** 0–100 teamwork */
    teamwork: number;
    /** -1 to 1 emotional affinity */
    affinity: number;
    /** Interaction style label */
    style: string;
    /** 1-sentence relationship summary */
    summary: string;
    /** LLM-safe prompt line (bounded token size) */
    promptSafe: string;
    /** Generated at timestamp */
    generatedAt: number;
}
export declare function createRelationshipState(): RelationshipState;
export interface RelationshipConfig {
    /** Decay rate per hour of absence (0–1) */
    decayRatePerHour: number;
    /** Max recent memories to retain */
    maxRecentMemories: number;
    /** Familiarity threshold for interaction style upgrades */
    friendlyThreshold: number;
    closeThreshold: number;
    familialThreshold: number;
    /** Trust change damping (lower = slower change) */
    trustDamping: number;
    /** Affinity change damping */
    affinityDamping: number;
    /** Max trust/familiarity cap */
    maxLevel: number;
}
export declare class RelationshipEngine {
    private state;
    private config;
    constructor(state?: RelationshipState, config?: Partial<RelationshipConfig>);
    getState(): Readonly<RelationshipState>;
    /** Generate a lightweight snapshot safe for LLM context injection. */
    getSnapshot(): RelationshipSnapshot;
    increaseTrust(amount: number, reason: string): void;
    decreaseTrust(amount: number, reason: string): void;
    increaseFamiliarity(amount: number): void;
    /** Apply decay based on time since last seen. */
    applyAbsenceDecay(absenceMs: number): void;
    registerVictory(type: string, playerInvolved: boolean): void;
    registerFailure(type: string, playerInvolved: boolean): void;
    registerRescue(playerWasRescued: boolean): void;
    registerSessionStart(): void;
    registerSessionEnd(sessionDurationMs: number): void;
    registerDiscovery(description: string): void;
    registerBuild(description: string): void;
    trackActivity(activity: string): void;
    addRecentMemory(summary: string): void;
    /**
     * Get companionship warmth factor (0–1).
     * Influences narration tone, proactive behavior confidence, voice style.
     */
    getWarmthFactor(): number;
    /**
     * Get initiative confidence (0–1).
     * How confident the companion is to act proactively.
     * High familiarity + high trust = more initiative.
     */
    getInitiativeConfidence(): number;
    private updateInteractionStyle;
    /** Replace state entirely (for loading from persistence). */
    setState(state: RelationshipState): void;
}
//# sourceMappingURL=relationship-state.d.ts.map
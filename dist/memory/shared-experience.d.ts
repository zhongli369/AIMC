/**
 * SharedExperienceTimeline — meaningful moments memory (Phase 4-E).
 *
 * Stores ONLY significant shared experiences between companion and player.
 * NOT a replacement for SQLiteMemoryStore — this is SOCIAL HISTORY only.
 *
 * Categories: combat, mining, exploration, rescue, building, funny, failure, milestone
 *
 * MUST NOT:
 *   - Store raw chat spam
 *   - Execute actions
 *   - Create autonomous behavior
 */
export type ExperienceCategory = "combat" | "mining" | "exploration" | "rescue" | "building" | "funny" | "failure" | "milestone";
export interface SharedExperience {
    id: string;
    timestamp: number;
    category: ExperienceCategory;
    /** 1–2 sentence summary */
    summary: string;
    /** 1–10 emotional significance */
    emotionalWeight: number;
    /** Players involved */
    involvedPlayers: string[];
    /** Searchable tags */
    tags: string[];
    /** Optional location */
    location?: {
        x: number;
        y: number;
        z: number;
        dimension: string;
    };
    /** How many times referenced in callbacks/context */
    timesReferenced: number;
    /** Whether this memory is pinned (never auto-pruned) */
    pinned: boolean;
}
export interface ExperienceConfig {
    /** Max total memories before pruning */
    maxMemories: number;
    /** Min emotional weight to auto-pin */
    autoPinThreshold: number;
    /** Max age before low-weight memories are pruned (ms) */
    lowWeightMaxAgeMs: number;
    /** Keep at least N memories per category */
    minPerCategory: number;
    /** Max memories returned in a single query */
    maxQueryResults: number;
}
export declare class SharedExperienceTimeline {
    private memories;
    private config;
    constructor(memories?: SharedExperience[], config?: Partial<ExperienceConfig>);
    addMemory(exp: Omit<SharedExperience, "id" | "timesReferenced" | "pinned">): SharedExperience;
    /** Get memories relevant to a given context (keyword match on summary/tags). */
    getRelevantMemories(context: {
        keywords?: string[];
        category?: ExperienceCategory;
        limit?: number;
    }): SharedExperience[];
    /** Get all memories in a category. */
    getByCategory(category: ExperienceCategory, limit?: number): SharedExperience[];
    /** Get recent memories across all categories. */
    getRecent(limit?: number): SharedExperience[];
    /** Get milestone memories only. */
    getMilestones(): SharedExperience[];
    /**
     * Generate a concise natural-language summary of recent history.
     * Safe for LLM context injection. Bounded token size.
     */
    summarizeRecentHistory(maxCount?: number): string;
    /**
     * Generate a category-focused summary.
     */
    summarizeByCategory(category: ExperienceCategory, maxCount?: number): string;
    getStats(): {
        totalMemories: number;
        byCategory: Record<string, number>;
        oldestTimestamp: number;
        newestTimestamp: number;
        pinnedCount: number;
    };
    /**
     * Remove low-value memories to stay within limit.
     * Keeps: pinned, high emotional weight, recent, category minimums.
     */
    prune(keepCount?: number): number;
    /** Get raw memories array (for persistence). */
    getAll(): Readonly<SharedExperience[]>;
    /** Replace all memories (for loading from persistence). */
    setAll(memories: SharedExperience[]): void;
    private formatTimeAgo;
}
//# sourceMappingURL=shared-experience.d.ts.map
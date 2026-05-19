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

import { randomUUID } from "node:crypto";

// ─── Categories ────────────────────────────────────────

export type ExperienceCategory =
  | "combat"
  | "mining"
  | "exploration"
  | "rescue"
  | "building"
  | "funny"
  | "failure"
  | "milestone";

// ─── Shared Experience ─────────────────────────────────

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
  location?: { x: number; y: number; z: number; dimension: string };
  /** How many times referenced in callbacks/context */
  timesReferenced: number;
  /** Whether this memory is pinned (never auto-pruned) */
  pinned: boolean;
}

// ─── Config ────────────────────────────────────────────

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

const DEFAULT_EXPERIENCE_CONFIG: ExperienceConfig = {
  maxMemories: 200,
  autoPinThreshold: 8,
  lowWeightMaxAgeMs: 7 * 24 * 3600_000, // 7 days
  minPerCategory: 3,
  maxQueryResults: 10,
};

// ─── Timeline ──────────────────────────────────────────

export class SharedExperienceTimeline {
  private memories: SharedExperience[] = [];
  private config: ExperienceConfig;

  constructor(memories?: SharedExperience[], config?: Partial<ExperienceConfig>) {
    this.memories = memories ?? [];
    this.config = { ...DEFAULT_EXPERIENCE_CONFIG, ...config };
    // Sort by timestamp descending
    this.memories.sort((a, b) => b.timestamp - a.timestamp);
  }

  // ─── Add ───────────────────────────────────────────

  addMemory(exp: Omit<SharedExperience, "id" | "timesReferenced" | "pinned">): SharedExperience {
    const memory: SharedExperience = {
      ...exp,
      id: randomUUID(),
      timesReferenced: 0,
      pinned: exp.emotionalWeight >= this.config.autoPinThreshold,
    };

    this.memories.unshift(memory);

    // Auto-prune if over limit
    if (this.memories.length > this.config.maxMemories) {
      this.prune();
    }

    return memory;
  }

  // ─── Query ─────────────────────────────────────────

  /** Get memories relevant to a given context (keyword match on summary/tags). */
  getRelevantMemories(
    context: { keywords?: string[]; category?: ExperienceCategory; limit?: number },
  ): SharedExperience[] {
    let candidates = this.memories;

    if (context.category) {
      candidates = candidates.filter((m) => m.category === context.category);
    }

    if (context.keywords && context.keywords.length > 0) {
      const scored = candidates.map((m) => {
        let score = 0;
        const lower = m.summary.toLowerCase();
        for (const kw of context.keywords!) {
          if (lower.includes(kw.toLowerCase())) score += 1;
          if (m.tags.some((t) => t.toLowerCase().includes(kw.toLowerCase()))) score += 1.5;
        }
        return { memory: m, score };
      });

      scored.sort((a, b) => b.score - a.score);
      candidates = scored.filter((s) => s.score > 0).map((s) => s.memory);
    }

    const limit = context.limit ?? this.config.maxQueryResults;
    const result = candidates.slice(0, limit);

    // Track references
    for (const m of result) {
      m.timesReferenced++;
    }

    return result;
  }

  /** Get all memories in a category. */
  getByCategory(category: ExperienceCategory, limit?: number): SharedExperience[] {
    const matches = this.memories.filter((m) => m.category === category);
    return matches.slice(0, limit ?? this.config.maxQueryResults);
  }

  /** Get recent memories across all categories. */
  getRecent(limit: number = 10): SharedExperience[] {
    return this.memories.slice(0, limit);
  }

  /** Get milestone memories only. */
  getMilestones(): SharedExperience[] {
    return this.memories.filter((m) => m.category === "milestone" || m.pinned);
  }

  // ─── Summarize ─────────────────────────────────────

  /**
   * Generate a concise natural-language summary of recent history.
   * Safe for LLM context injection. Bounded token size.
   */
  summarizeRecentHistory(maxCount: number = 5): string {
    const recent = this.memories.slice(0, maxCount);
    if (recent.length === 0) return "";

    const summaries = recent.map((m) => {
      const timeAgo = this.formatTimeAgo(m.timestamp);
      return `[${timeAgo}] ${m.summary}`;
    });

    return summaries.join("\n");
  }

  /**
   * Generate a category-focused summary.
   */
  summarizeByCategory(category: ExperienceCategory, maxCount: number = 3): string {
    const matches = this.getByCategory(category, maxCount);
    if (matches.length === 0) return "";
    return matches.map((m) => m.summary).join("; ");
  }

  // ─── Stats ─────────────────────────────────────────

  getStats(): {
    totalMemories: number;
    byCategory: Record<string, number>;
    oldestTimestamp: number;
    newestTimestamp: number;
    pinnedCount: number;
  } {
    const byCategory: Record<string, number> = {};
    for (const m of this.memories) {
      byCategory[m.category] = (byCategory[m.category] || 0) + 1;
    }

    return {
      totalMemories: this.memories.length,
      byCategory,
      oldestTimestamp: this.memories[this.memories.length - 1]?.timestamp ?? 0,
      newestTimestamp: this.memories[0]?.timestamp ?? 0,
      pinnedCount: this.memories.filter((m) => m.pinned).length,
    };
  }

  // ─── Prune ─────────────────────────────────────────

  /**
   * Remove low-value memories to stay within limit.
   * Keeps: pinned, high emotional weight, recent, category minimums.
   */
  prune(keepCount?: number): number {
    const target = keepCount ?? this.config.maxMemories;
    if (this.memories.length <= target) return 0;

    const now = Date.now();
    const toKeep: SharedExperience[] = [];
    const categoryCounts: Record<string, number> = {};

    // Phase 1: Keep all pinned + all within category minimums
    for (const m of this.memories) {
      const catCount = categoryCounts[m.category] || 0;
      if (m.pinned || catCount < this.config.minPerCategory) {
        toKeep.push(m);
        categoryCounts[m.category] = catCount + 1;
      }
    }

    // Phase 2: Score remaining memories
    const remaining = this.memories.filter((m) => !toKeep.includes(m));
    const scored = remaining.map((m) => {
      const ageMs = now - m.timestamp;
      const ageScore = Math.max(0, 1 - ageMs / this.config.lowWeightMaxAgeMs);
      const refScore = Math.min(1, m.timesReferenced / 10);
      return {
        memory: m,
        score: m.emotionalWeight * 0.5 + ageScore * 0.3 + refScore * 0.2,
      };
    });

    scored.sort((a, b) => b.score - a.score);

    // Fill remaining slots
    const slotsRemaining = target - toKeep.length;
    for (let i = 0; i < Math.min(slotsRemaining, scored.length); i++) {
      toKeep.push(scored[i].memory);
    }

    const removed = this.memories.length - toKeep.length;
    toKeep.sort((a, b) => b.timestamp - a.timestamp);
    this.memories = toKeep;

    if (removed > 0) {
      console.log(`[SharedExperience] Pruned ${removed} memories (keeping ${this.memories.length})`);
    }

    return removed;
  }

  /** Get raw memories array (for persistence). */
  getAll(): Readonly<SharedExperience[]> {
    return this.memories;
  }

  /** Replace all memories (for loading from persistence). */
  setAll(memories: SharedExperience[]): void {
    this.memories = memories;
    this.memories.sort((a, b) => b.timestamp - a.timestamp);
  }

  // ─── Helpers ───────────────────────────────────────

  private formatTimeAgo(ts: number): string {
    const elapsed = Date.now() - ts;
    const minutes = Math.floor(elapsed / 60000);
    if (minutes < 1) return "刚才";
    if (minutes < 60) return `${minutes}分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}小时前`;
    const days = Math.floor(hours / 24);
    return `${days}天前`;
  }
}

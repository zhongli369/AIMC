/**
 * MemoryCallbackGenerator — deterministic natural companion references (Phase 4-E).
 *
 * Generates contextual callbacks referencing shared history.
 * Examples:
 *   "上次我们在矿洞也遇到过苦力怕"
 *   "你之前挖矿的时候喜欢往左探路"
 *   "上次我救过你一次，这次别乱冲了"
 *
 * TEMPLATE-DRIVEN ONLY. NO LLM calls. NO external APIs.
 * Callbacks are OPTIONAL flavor — never block execution.
 *
 * Bilingual: zh (primary) + en (fallback).
 */
import type { SharedExperience, ExperienceCategory } from "./shared-experience.js";
export declare class MemoryCallbackGenerator {
    private usedCallbacks;
    private language;
    constructor(language?: "zh" | "en");
    /** Set output language. */
    setLanguage(lang: "zh" | "en"): void;
    /**
     * Generate a contextual callback referencing shared experience.
     * Returns null if no relevant memory or template available.
     *
     * This is DETERMINISTIC — no AI, no randomness beyond template selection.
     */
    getContextualCallback(experiences: SharedExperience[], currentContext?: {
        category?: ExperienceCategory;
        keywords?: string[];
    }): string | null;
    /** Generate a combat-specific callback. */
    getCombatCallback(combatExperiences: SharedExperience[]): string | null;
    /** Generate an exploration-specific callback. */
    getExplorationCallback(explorationExperiences: SharedExperience[]): string | null;
    /** Generate a rescue callback from shared rescue experiences. */
    getRescueCallback(rescueExperiences: SharedExperience[]): string | null;
    /** Generate a milestone callback. */
    getMilestoneCallback(milestoneExperiences: SharedExperience[], extra?: {
        sessionsTogether?: number;
        eventsCount?: number;
    }): string | null;
    /** Get a generic relationship callback based on warmth level. */
    getRelationshipCallback(warmthFactor: number): string | null;
    private generateForExperience;
    /** Pick the least recently used template to reduce repetition. */
    private pickLeastUsed;
    private finalize;
    /** Reset usage tracking. */
    reset(): void;
}
//# sourceMappingURL=memory-callbacks.d.ts.map
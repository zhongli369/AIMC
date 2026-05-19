/**
 * MemoryImportanceEngine — scores memory candidates 1-10.
 *
 * Additive scoring: each factor contributes points, total capped at 10.
 *
 * Factors (max contribution):
 *   - Death / near-death events (+9)
 *   - Combat / damage (+6)
 *   - Rare items / entities (+5)
 *   - Player interactions (+4)
 *   - System warnings / emergencies (+5)
 *   - Pattern repetition (+3)
 *   - Base score (+1)
 */
import type { MemoryCandidate } from "./types.js";
export declare class ImportanceEngine {
    /**
     * Score a memory candidate. Returns importance from 1 to 10.
     * Uses additive scoring: each factor contributes points, total capped at 10.
     */
    score(candidate: MemoryCandidate): number;
    filterImportant(candidates: MemoryCandidate[], threshold?: number): MemoryCandidate[];
    scoreBatch(candidates: MemoryCandidate[]): MemoryCandidate[];
    private scoreDeathProximity;
    private scoreCombat;
    private scoreRareItems;
    private scorePlayerInteraction;
    private scoreRepeatedPatterns;
    private scoreSystemWarnings;
}
/** Quick score a single candidate with default weights. */
export declare function scoreImportance(candidate: MemoryCandidate): number;
//# sourceMappingURL=importance.d.ts.map
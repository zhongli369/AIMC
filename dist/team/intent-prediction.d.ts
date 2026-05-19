/**
 * IntentPrediction — cooperative intent anticipation (Phase 4-F).
 *
 * Predicts short-term player intentions from observable context.
 * ADVISORY ONLY — predictions NEVER execute directly.
 * Output flows through normal AgentCore → SkillRouter pipeline.
 *
 * MUST NOT:
 *   - Execute actions independently
 *   - Create hidden task queues
 *   - Bypass SkillRouter or ActionDispatcher
 *   - Access Mineflayer directly
 */
import type { TeamState } from "./team-state.js";
export type PlayerIntentType = "mining" | "combat" | "exploration" | "retreat" | "building" | "regroup" | "inventory_management" | "travel" | "idle";
export interface PredictedIntent {
    intentType: PlayerIntentType;
    /** 0–1 confidence in prediction */
    confidence: number;
    /** Estimated ms duration of the intent */
    estimatedDurationMs: number;
    /** What kind of support is most helpful */
    supportOpportunity: SupportOpportunityType;
    /** Reasoning for the prediction */
    reasoning: string;
    /** Matched keywords/patterns */
    evidence: string[];
}
export type SupportOpportunityType = "guard" | "assist_mining" | "combat_backup" | "light_area" | "collect_drops" | "scout_ahead" | "regroup" | "hold_position" | "share_resources" | "none";
export interface PredictionContext {
    /** Player movement vector (dx, dz) over last few seconds */
    movementDirection?: {
        dx: number;
        dz: number;
    };
    /** Player speed (blocks/sec) */
    movementSpeed?: number;
    /** What the player is holding */
    heldItem?: string;
    /** Recent player actions (last 10s) */
    recentActions: string[];
    /** Nearby block types within 5 blocks of player */
    nearbyBlocks: string[];
    /** Nearby entities within 32 blocks */
    nearbyEntities: string[];
    /** Current team state */
    teamState: TeamState | null;
    /** Voice pressure level if voice active */
    voicePressure?: string;
    /** Relationship familiarity 0–100 */
    familiarityLevel: number;
    /** Current time of day in game (0–24000) */
    gameTime?: number;
    /** Player health */
    playerHealth?: number;
    /** Player hunger */
    playerHunger?: number;
}
export interface PredictionConfig {
    /** Min confidence to act on prediction */
    minConfidenceForAssist: number;
    /** How much familiarity boosts confidence */
    familiarityBoost: number;
    /** Max simultaneous support actions */
    maxSupportActions: number;
}
export declare class IntentPredictor {
    private config;
    private predictionHistory;
    constructor(config?: Partial<PredictionConfig>);
    /**
     * Predict the player's current short-term intent.
     *
     * DETERMINISTIC analysis — no AI, no randomness.
     * Uses weighted evidence scoring across multiple signals.
     */
    predict(context: PredictionContext): PredictedIntent;
    /**
     * Determine if companion should assist given a prediction.
     *
     * Returns true when:
     *   - Confidence exceeds threshold
     *   - Support opportunity is not "none"
     *   - Intent is one where assistance is genuinely helpful
     */
    shouldAssist(prediction: PredictedIntent): boolean;
    /**
     * Get the priority of support (1–5, 5 = most urgent).
     */
    getSupportPriority(prediction: PredictedIntent, context: PredictionContext): number;
    /** Get prediction history for pattern analysis. */
    getHistory(limit?: number): PredictedIntent[];
    /** Get the most recent prediction. */
    getLastPrediction(): PredictedIntent | null;
    private addScore;
    private estimateDuration;
    private mapSupportOpportunity;
}
//# sourceMappingURL=intent-prediction.d.ts.map
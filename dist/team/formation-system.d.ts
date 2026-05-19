/**
 * FormationSystem — dynamic squad positioning (Phase 4-F).
 *
 * Manages companion positioning relative to player.
 * ADVISORY ONLY — all movement still flows through SkillRouter.
 *
 * Formation modes: follow_close, follow_loose, flank_left, flank_right,
 *                  rear_guard, scout_ahead
 *
 * MUST NOT:
 *   - Execute movement directly
 *   - Bypass SkillRouter
 *   - Access bot.*() directly
 */
import type { TeamMode } from "./team-state.js";
import type { PlayerIntentType } from "./intent-prediction.js";
export type FormationMode = "follow_close" | "follow_loose" | "flank_left" | "flank_right" | "rear_guard" | "scout_ahead";
export interface FormationPosition {
    /** Desired offset from player */
    offsetX: number;
    offsetZ: number;
    /** Desired distance from player */
    distance: number;
    /** Whether position is relative to player facing direction */
    relativeToFacing: boolean;
    /** Tolerance before repositioning */
    toleranceRadius: number;
}
export interface FormationConfig {
    /** Default formation when no specific context */
    defaultFormation: FormationMode;
    /** Min distance before "too close" trigger */
    minDistance: number;
    /** Max distance before "too far" trigger */
    maxDistance: number;
    /** How often to re-evaluate formation (ms) */
    evaluationIntervalMs: number;
    /** Whether to avoid blocking player's line of sight */
    avoidBlockingLoS: boolean;
}
export declare class FormationSystem {
    private currentFormation;
    private config;
    private lastEvaluation;
    private formationHistory;
    constructor(config?: Partial<FormationConfig>);
    getCurrentFormation(): FormationMode;
    /**
     * Update formation mode based on context.
     * Returns the new formation and whether it changed.
     */
    updateFormationMode(params: {
        teamMode: TeamMode;
        predictedIntent: PlayerIntentType;
        hostilesNearby: boolean;
        isUnderground: boolean;
        playerHealth: number;
        familiarityLevel: number;
    }): {
        formation: FormationMode;
        changed: boolean;
    };
    /**
     * Get the desired position offset given current formation.
     * Returns the ideal offset from the player.
     */
    getDesiredFormationPosition(formation?: FormationMode): FormationPosition;
    /**
     * Determine if the companion should regroup (move closer to player).
     */
    shouldRegroup(params: {
        currentDistanceToPlayer: number;
        formation: FormationMode;
        isInDanger: boolean;
    }): boolean;
    /**
     * Check if companion is too close to player (blocking).
     */
    isTooClose(currentDistanceToPlayer: number): boolean;
    /**
     * Whether the companion should adjust position to avoid blocking.
     */
    shouldAvoidBlocking(params: {
        distanceToPlayer: number;
        playerFacingDirection?: {
            dx: number;
            dz: number;
        };
        botRelativeAngle?: number;
    }): boolean;
    /** Get formation change history. */
    getFormationHistory(): ReadonlyArray<{
        mode: FormationMode;
        timestamp: number;
        reason: string;
    }>;
    /** Reset formation to default. */
    reset(): void;
}
//# sourceMappingURL=formation-system.d.ts.map
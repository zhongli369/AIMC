/**
 * CombatSynergy — coordinated team combat (Phase 4-F).
 *
 * Makes combat feel like cooperative teamwork:
 *   - Avoid friendly collision
 *   - Focus same target as player
 *   - Peel hostile mobs off player
 *   - Retreat when player retreats
 *   - Avoid blocking bow shots
 *   - Prioritize rescue over kills
 *
 * ADVISORY ONLY. All actions flow through SkillRouter.
 * NO autonomous war AI. Reactive + team-oriented.
 *
 * MUST NOT:
 *   - Execute combat actions directly
 *   - Bypass SkillRouter
 *   - Initiate combat without player involvement
 *   - Create autonomous combat AI
 */
import type { TeamState, ActiveThreat } from "./team-state.js";
import type { IntentAction } from "../interfaces/intent.js";
export type CombatRole = "bodyguard" | "co_attacker" | "interceptor" | "rear_guard" | "rescuer";
export interface ThreatPriority {
    entityName: string;
    priority: number;
    reason: string;
    suggestedBy: "proximity" | "damage" | "player_targeting" | "type";
}
export interface CombatEvaluation {
    /** Recommended combat role */
    role: CombatRole;
    /** Prioritized threat list */
    threatPriorities: ThreatPriority[];
    /** Whether to prioritize rescue over offense */
    prioritizeRescue: boolean;
    /** Whether to retreat */
    shouldRetreat: boolean;
    /** Whether the player is currently targeting something */
    playerHasTarget: boolean;
    /** The player's likely target */
    playerTarget?: string;
}
export interface CombatSynergyConfig {
    /** Min distance to keep from player during combat */
    minCombatSpacing: number;
    /** Max distance from player during combat */
    maxCombatDistance: number;
    /** Health threshold for rescue priority */
    rescueHealthThreshold: number;
    /** Health threshold for retreat */
    retreatHealthThreshold: number;
    /** Whether to auto-target player's target */
    focusPlayerTarget: boolean;
    /** How strongly to avoid blocking player's bow shots */
    avoidBowLoS: boolean;
}
export declare class CombatSynergyEngine {
    private config;
    private lastCombatTick;
    private currentRole;
    constructor(config?: Partial<CombatSynergyConfig>);
    /**
     * Evaluate combat situation and recommend tactical actions.
     *
     * Returns CombatEvaluation for consumption by SkillRouter.
     */
    evaluateCombatSupport(params: {
        teamState: TeamState;
        botHealth: number;
        playerHealth: number;
        playerHeldItem?: string;
        playerRecentAttacks: string[];
        botPosition: {
            x: number;
            y: number;
            z: number;
        } | null;
    }): CombatEvaluation;
    /**
     * Select the best target for the companion to engage.
     *
     * Priority logic:
     *   1. Threats attacking the player → peel off
     *   2. Same target as player → focus fire
     *   3. Nearest high-danger threat → intercept
     *   4. Nearest threat → engage
     */
    selectSupportTarget(evaluation: CombatEvaluation): ThreatPriority | null;
    /**
     * Compute threat priority ordering.
     */
    computeThreatPriorities(threats: ActiveThreat[], playerTarget?: string, _botPosition?: {
        x: number;
        y: number;
        z: number;
    } | null): ThreatPriority[];
    /**
     * Build an IntentAction for combat support.
     * Caller MUST dispatch through SkillRouter.
     */
    buildCombatAction(target: ThreatPriority): IntentAction;
    /**
     * Build a rescue-oriented follow action.
     */
    buildRescueAction(): IntentAction;
    /**
     * Check if companion should avoid standing in player's bow line of sight.
     */
    shouldAvoidBowLoS(params: {
        playerHasBow: boolean;
        botRelativeAngle: number;
        distanceToPlayer: number;
    }): boolean;
    /** Get current combat role. */
    getCurrentRole(): CombatRole;
    /** Get last combat tick timestamp. */
    getLastCombatTick(): number;
}
//# sourceMappingURL=combat-synergy.d.ts.map
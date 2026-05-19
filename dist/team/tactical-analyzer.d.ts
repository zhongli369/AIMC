/**
 * TacticalAnalyzer — deterministic teammate awareness engine.
 *
 * Analyzes TeamState and produces TacticalRecommendation.
 * This is ANALYSIS ONLY. It does NOT:
 *   - Execute actions
 *   - Call bot.*() directly
 *   - Create new execution paths
 *   - Access Mineflayer
 *
 * Output is consumed by SkillRouter as soft skill-weight bias.
 */
import type { TeamState } from "./team-state.js";
import type { CompanionRole } from "../role/role-identity.js";
export type TacticalRecommendation = "protect" | "follow" | "regroup" | "assist_mining" | "scout" | "retreat" | "hold_position" | "none";
export interface SupportOpportunity {
    type: TacticalRecommendation;
    targetPlayer?: string;
    urgency: number;
    reason: string;
}
/**
 * Per-skill weight modifiers from tactical recommendation.
 * 1.0 = neutral, > 1.0 = prefer, < 1.0 = avoid.
 */
export interface TacticalSkillBias {
    defend_player: number;
    attack_target: number;
    follow_player: number;
    explore_area: number;
    mine_resource: number;
    gather_food: number;
    collect_items: number;
    build_shelter: number;
}
export declare class TacticalAnalyzer {
    /**
     * Analyze team state and produce a tactical recommendation.
     *
     * This is DETERMINISTIC — no AI, no randomness.
     * Rules are priority-ordered: danger > isolation > support > idle.
     */
    analyze(state: TeamState): {
        recommendation: TacticalRecommendation;
        opportunities: SupportOpportunity[];
    };
    /**
     * Identify support opportunities in the current state.
     */
    private findOpportunities;
    /**
     * Compute skill weight bias from a tactical recommendation.
     *
     * These biases are SOFT modifiers for skill routing preference.
     * They do NOT change the execution chain or force any action.
     */
    getSkillBias(recommendation: TacticalRecommendation): TacticalSkillBias;
    /**
     * Compute role-aware skill bias by merging tactical recommendation
     * with companion role profile weights (Phase 4-D).
     *
     * Role multipliers are applied ON TOP of tactical bias:
     *   fighter → defend/attack boosted, mining/gathering reduced
     *   miner   → mining/collect boosted, combat reduced
     *   scout   → explore boosted, building reduced
     *   support → follow/defend boosted, explore reduced
     *   balanced → tactical bias unchanged
     */
    getRoleAwareSkillBias(recommendation: TacticalRecommendation, role: CompanionRole): TacticalSkillBias;
    /**
     * Get role-specific tactical tendency modifiers (Phase 4-D).
     *
     * Returns adjustment factors for common tactical parameters:
     *   - defendBoost: extra weight on defense skills
     *   - regroupUrgency: how urgently to regroup when isolated
     *   - combatAvoidance: how strongly to avoid combat
     *   - exploreBoost: extra weight on exploration
     */
    getRoleTacticalModifiers(role: CompanionRole): {
        defendBoost: number;
        regroupUrgency: number;
        combatAvoidance: number;
        exploreBoost: number;
        supportBoost: number;
    };
}
//# sourceMappingURL=tactical-analyzer.d.ts.map
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
import { ROLE_PROFILES } from "../role/role-identity.js";
// ─── Analyzer ─────────────────────────────────────────
export class TacticalAnalyzer {
    /**
     * Analyze team state and produce a tactical recommendation.
     *
     * This is DETERMINISTIC — no AI, no randomness.
     * Rules are priority-ordered: danger > isolation > support > idle.
     */
    analyze(state) {
        const opportunities = this.findOpportunities(state);
        // Priority-ordered recommendation
        let recommendation = "none";
        // 1. CRITICAL: Player or bot in immediate danger
        if (state.botThreatLevel > 0.7 || state.teamMode === "retreat") {
            recommendation = "retreat";
        }
        else if (state.teamMode === "combat" && state.botThreatLevel > 0.3) {
            recommendation = "protect";
        }
        else if (state.activeThreats.length >= 3) {
            recommendation = "protect";
        }
        // 2. HIGH: Isolated from team
        else if (state.isIsolated) {
            recommendation = "regroup";
        }
        // 3. MEDIUM: Support opportunity
        else if (opportunities.length > 0) {
            recommendation = opportunities[0].type;
        }
        // 4. LOW: Context-dependent
        else if (state.teamMode === "exploration") {
            recommendation = state.nearbyPlayers.length > 0 ? "follow" : "scout";
        }
        else if (state.teamMode === "mining") {
            recommendation = "assist_mining";
        }
        else if (state.teamMode === "peaceful" && state.nearbyPlayers.length > 0) {
            recommendation = "follow";
        }
        return { recommendation, opportunities };
    }
    /**
     * Identify support opportunities in the current state.
     */
    findOpportunities(state) {
        const opps = [];
        for (const member of state.nearbyPlayers) {
            // Player under threat → protect
            if (member.threatLevel > 0.5 && member.distanceToBot < 32) {
                opps.push({
                    type: "protect",
                    targetPlayer: member.name,
                    urgency: member.threatLevel,
                    reason: `${member.name} under threat (${(member.threatLevel * 100).toFixed(0)}%)`,
                });
            }
            // Player mining nearby → assist
            if (member.currentAction === "mining" && member.distanceToBot < 16) {
                opps.push({
                    type: "assist_mining",
                    targetPlayer: member.name,
                    urgency: 0.3,
                    reason: `${member.name} is mining nearby`,
                });
            }
            // Player too far → regroup candidate
            if (member.distanceToBot > 32) {
                opps.push({
                    type: "regroup",
                    targetPlayer: member.name,
                    urgency: Math.min(0.7, member.distanceToBot / 64),
                    reason: `${member.name} is ${member.distanceToBot}m away`,
                });
            }
            // Player fighting → protect
            if (member.currentAction === "fighting") {
                opps.push({
                    type: "protect",
                    targetPlayer: member.name,
                    urgency: 0.9,
                    reason: `${member.name} is fighting`,
                });
            }
        }
        // Sort by urgency descending
        opps.sort((a, b) => b.urgency - a.urgency);
        return opps;
    }
    /**
     * Compute skill weight bias from a tactical recommendation.
     *
     * These biases are SOFT modifiers for skill routing preference.
     * They do NOT change the execution chain or force any action.
     */
    getSkillBias(recommendation) {
        const neutral = {
            defend_player: 1.0,
            attack_target: 1.0,
            follow_player: 1.0,
            explore_area: 1.0,
            mine_resource: 1.0,
            gather_food: 1.0,
            collect_items: 1.0,
            build_shelter: 1.0,
        };
        switch (recommendation) {
            case "protect":
                return {
                    ...neutral,
                    defend_player: 2.0,
                    attack_target: 1.8,
                    follow_player: 1.5,
                    explore_area: 0.3,
                    build_shelter: 0.2,
                };
            case "follow":
                return {
                    ...neutral,
                    follow_player: 2.0,
                    collect_items: 1.5,
                    explore_area: 0.5,
                    build_shelter: 0.3,
                };
            case "regroup":
                return {
                    ...neutral,
                    follow_player: 2.5,
                    explore_area: 1.2, // to find player
                    collect_items: 0.3,
                    mine_resource: 0.2,
                    build_shelter: 0.1,
                };
            case "assist_mining":
                return {
                    ...neutral,
                    mine_resource: 2.0,
                    collect_items: 1.8,
                    follow_player: 1.3,
                    attack_target: 0.3,
                    build_shelter: 0.5,
                };
            case "scout":
                return {
                    ...neutral,
                    explore_area: 2.5,
                    follow_player: 0.2,
                    build_shelter: 0.1,
                    gather_food: 0.5,
                };
            case "retreat":
                return {
                    ...neutral,
                    follow_player: 2.0,
                    defend_player: 1.5,
                    explore_area: 0.1,
                    mine_resource: 0.1,
                    build_shelter: 0.1,
                    collect_items: 0.2,
                };
            case "hold_position":
                return {
                    ...neutral,
                    explore_area: 0.1,
                    follow_player: 0.3,
                    defend_player: 1.3,
                    attack_target: 1.2,
                };
            case "none":
            default:
                return neutral;
        }
    }
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
    getRoleAwareSkillBias(recommendation, role) {
        const tactical = this.getSkillBias(recommendation);
        const profile = ROLE_PROFILES[role];
        const roleWeights = profile.skillWeights;
        // Merge: tactical bias × role weight, clamped to [0.1, 3.0]
        const merge = (key) => {
            const tacticalVal = tactical[key];
            const roleVal = roleWeights[key] ?? 1.0;
            return Math.max(0.1, Math.min(3.0, tacticalVal * roleVal));
        };
        return {
            defend_player: merge("defend_player"),
            attack_target: merge("attack_target"),
            follow_player: merge("follow_player"),
            explore_area: merge("explore_area"),
            mine_resource: merge("mine_resource"),
            gather_food: merge("gather_food"),
            collect_items: merge("collect_items"),
            build_shelter: merge("build_shelter"),
        };
    }
    /**
     * Get role-specific tactical tendency modifiers (Phase 4-D).
     *
     * Returns adjustment factors for common tactical parameters:
     *   - defendBoost: extra weight on defense skills
     *   - regroupUrgency: how urgently to regroup when isolated
     *   - combatAvoidance: how strongly to avoid combat
     *   - exploreBoost: extra weight on exploration
     */
    getRoleTacticalModifiers(role) {
        const profile = ROLE_PROFILES[role];
        return {
            defendBoost: profile.skillWeights["defend_player"] ?? 1.0,
            regroupUrgency: profile.skillWeights["follow_player"] ?? 1.0,
            combatAvoidance: 1.0 - (profile.skillWeights["attack_target"] ?? 0.5),
            exploreBoost: profile.skillWeights["explore_area"] ?? 1.0,
            supportBoost: profile.supportBias,
        };
    }
}
//# sourceMappingURL=tactical-analyzer.js.map
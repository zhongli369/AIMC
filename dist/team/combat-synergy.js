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
import { randomUUID } from "node:crypto";
const DEFAULT_COMBAT_CONFIG = {
    minCombatSpacing: 2,
    maxCombatDistance: 20,
    rescueHealthThreshold: 8,
    retreatHealthThreshold: 4,
    focusPlayerTarget: true,
    avoidBowLoS: true,
};
// ─── Threat Type Priority ───────────────────────────────
const THREAT_TYPE_PRIORITY = {
    creeper: 5, // Explosive — highest priority
    wither_skeleton: 4,
    blaze: 4,
    ghast: 4,
    witch: 3,
    skeleton: 3, // Ranged attacker
    spider: 2,
    zombie: 2,
    enderman: 3,
    piglin_brute: 4,
    hoglin: 3,
};
// ─── Synergy Engine ─────────────────────────────────────
export class CombatSynergyEngine {
    config;
    lastCombatTick = 0;
    currentRole = "bodyguard";
    constructor(config) {
        this.config = { ...DEFAULT_COMBAT_CONFIG, ...config };
    }
    /**
     * Evaluate combat situation and recommend tactical actions.
     *
     * Returns CombatEvaluation for consumption by SkillRouter.
     */
    evaluateCombatSupport(params) {
        const { teamState, botHealth, playerHealth } = params;
        // Determine if player has a combat target
        const playerHasBow = params.playerHeldItem
            ? /bow|crossbow/.test(params.playerHeldItem.toLowerCase())
            : false;
        const playerTargeting = params.playerRecentAttacks.length > 0;
        const playerTarget = playerTargeting ? params.playerRecentAttacks[0] : undefined;
        // Retreat check
        const shouldRetreat = botHealth < this.config.retreatHealthThreshold
            || (teamState.teamMode === "retreat")
            || (teamState.activeThreats.length >= 5 && botHealth < 12);
        // Rescue check
        const prioritizeRescue = playerHealth < this.config.rescueHealthThreshold
            && teamState.activeThreats.length > 0;
        // Determine combat role
        let role = "bodyguard";
        if (prioritizeRescue) {
            role = "rescuer";
        }
        else if (shouldRetreat) {
            role = "rear_guard";
        }
        else if (teamState.activeThreats.length >= 3) {
            role = "interceptor";
        }
        else if (playerTargeting && this.config.focusPlayerTarget) {
            role = "co_attacker";
        }
        else {
            role = "bodyguard";
        }
        this.currentRole = role;
        this.lastCombatTick = Date.now();
        // Prioritize threats
        const threatPriorities = this.computeThreatPriorities(teamState.activeThreats, playerTarget, params.botPosition);
        return {
            role,
            threatPriorities,
            prioritizeRescue,
            shouldRetreat,
            playerHasTarget: playerTargeting,
            playerTarget,
        };
    }
    /**
     * Select the best target for the companion to engage.
     *
     * Priority logic:
     *   1. Threats attacking the player → peel off
     *   2. Same target as player → focus fire
     *   3. Nearest high-danger threat → intercept
     *   4. Nearest threat → engage
     */
    selectSupportTarget(evaluation) {
        if (evaluation.threatPriorities.length === 0)
            return null;
        if (evaluation.prioritizeRescue) {
            // In rescue mode, target the threat closest to player
            return evaluation.threatPriorities[0];
        }
        // If player has target and synergy enabled → focus same
        if (evaluation.playerHasTarget && evaluation.playerTarget && this.config.focusPlayerTarget) {
            const match = evaluation.threatPriorities.find((t) => t.entityName.toLowerCase().includes(evaluation.playerTarget.toLowerCase()));
            if (match)
                return match;
        }
        // Otherwise, take highest priority threat
        return evaluation.threatPriorities[0];
    }
    /**
     * Compute threat priority ordering.
     */
    computeThreatPriorities(threats, playerTarget, _botPosition) {
        return threats
            .map((t) => {
            let priority = 3;
            // Type-based priority
            for (const [typeName, typePriority] of Object.entries(THREAT_TYPE_PRIORITY)) {
                if (t.entityName.toLowerCase().includes(typeName)) {
                    priority = typePriority;
                    break;
                }
            }
            // Proximity boost — closer threats = higher priority
            if (t.distanceToBot < 4)
                priority = Math.min(5, priority + 1);
            // Player targeting boost
            if (playerTarget && t.entityName.toLowerCase().includes(playerTarget.toLowerCase())) {
                priority = Math.min(5, priority + 1);
            }
            const reason = playerTarget && t.entityName.includes(playerTarget)
                ? "Player is targeting this"
                : t.distanceToBot < 4
                    ? `Immediate threat — ${t.distanceToBot.toFixed(0)}m away`
                    : `Threat type: ${t.entityName}`;
            return {
                entityName: t.entityName,
                priority,
                reason,
                suggestedBy: playerTarget && t.entityName.includes(playerTarget)
                    ? "player_targeting"
                    : t.distanceToBot < 4
                        ? "proximity"
                        : "type",
            };
        })
            .sort((a, b) => b.priority - a.priority);
    }
    /**
     * Build an IntentAction for combat support.
     * Caller MUST dispatch through SkillRouter.
     */
    buildCombatAction(target) {
        return {
            id: `combat_${randomUUID().slice(0, 8)}`,
            type: "attack_entity",
            target: { entityName: target.entityName },
            priority: target.priority,
            reason: target.reason,
            timeout: 15000,
            cancelable: target.priority < 4,
        };
    }
    /**
     * Build a rescue-oriented follow action.
     */
    buildRescueAction() {
        return {
            id: `rescue_${randomUUID().slice(0, 8)}`,
            type: "follow_player",
            target: {},
            priority: 5,
            reason: "Rescue priority — moving to player",
            timeout: 15000,
            cancelable: false,
        };
    }
    /**
     * Check if companion should avoid standing in player's bow line of sight.
     */
    shouldAvoidBowLoS(params) {
        if (!this.config.avoidBowLoS)
            return false;
        if (!params.playerHasBow)
            return false;
        // Avoid standing in a ±30° cone in front of the player if within 10 blocks
        return params.distanceToPlayer < 10
            && Math.abs(params.botRelativeAngle) < Math.PI / 6;
    }
    /** Get current combat role. */
    getCurrentRole() {
        return this.currentRole;
    }
    /** Get last combat tick timestamp. */
    getLastCombatTick() {
        return this.lastCombatTick;
    }
}
//# sourceMappingURL=combat-synergy.js.map
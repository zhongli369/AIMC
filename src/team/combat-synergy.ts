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
import { randomUUID } from "node:crypto";

// ─── Combat Role ────────────────────────────────────────

export type CombatRole =
  | "bodyguard"     // Stay close, peel threats off player
  | "co_attacker"   // Focus same target as player
  | "interceptor"   // Block incoming threats before they reach player
  | "rear_guard"    // Watch for flanking threats
  | "rescuer";      // Priority: save player over kills

// ─── Threat Priority ────────────────────────────────────

export interface ThreatPriority {
  entityName: string;
  priority: number;      // 1–5 (5 = eliminate now)
  reason: string;
  suggestedBy: "proximity" | "damage" | "player_targeting" | "type";
}

// ─── Combat Evaluation ──────────────────────────────────

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

// ─── Config ─────────────────────────────────────────────

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

const DEFAULT_COMBAT_CONFIG: CombatSynergyConfig = {
  minCombatSpacing: 2,
  maxCombatDistance: 20,
  rescueHealthThreshold: 8,
  retreatHealthThreshold: 4,
  focusPlayerTarget: true,
  avoidBowLoS: true,
};

// ─── Threat Type Priority ───────────────────────────────

const THREAT_TYPE_PRIORITY: Record<string, number> = {
  creeper: 5,        // Explosive — highest priority
  wither_skeleton: 4,
  blaze: 4,
  ghast: 4,
  witch: 3,
  skeleton: 3,       // Ranged attacker
  spider: 2,
  zombie: 2,
  enderman: 3,
  piglin_brute: 4,
  hoglin: 3,
};

// ─── Synergy Engine ─────────────────────────────────────

export class CombatSynergyEngine {
  private config: CombatSynergyConfig;
  private lastCombatTick = 0;
  private currentRole: CombatRole = "bodyguard";

  constructor(config?: Partial<CombatSynergyConfig>) {
    this.config = { ...DEFAULT_COMBAT_CONFIG, ...config };
  }

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
    botPosition: { x: number; y: number; z: number } | null;
  }): CombatEvaluation {
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
    let role: CombatRole = "bodyguard";
    if (prioritizeRescue) {
      role = "rescuer";
    } else if (shouldRetreat) {
      role = "rear_guard";
    } else if (teamState.activeThreats.length >= 3) {
      role = "interceptor";
    } else if (playerTargeting && this.config.focusPlayerTarget) {
      role = "co_attacker";
    } else {
      role = "bodyguard";
    }

    this.currentRole = role;
    this.lastCombatTick = Date.now();

    // Prioritize threats
    const threatPriorities = this.computeThreatPriorities(
      teamState.activeThreats,
      playerTarget,
      params.botPosition,
    );

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
  selectSupportTarget(evaluation: CombatEvaluation): ThreatPriority | null {
    if (evaluation.threatPriorities.length === 0) return null;

    if (evaluation.prioritizeRescue) {
      // In rescue mode, target the threat closest to player
      return evaluation.threatPriorities[0];
    }

    // If player has target and synergy enabled → focus same
    if (evaluation.playerHasTarget && evaluation.playerTarget && this.config.focusPlayerTarget) {
      const match = evaluation.threatPriorities.find(
        (t) => t.entityName.toLowerCase().includes(evaluation.playerTarget!.toLowerCase()),
      );
      if (match) return match;
    }

    // Otherwise, take highest priority threat
    return evaluation.threatPriorities[0];
  }

  /**
   * Compute threat priority ordering.
   */
  computeThreatPriorities(
    threats: ActiveThreat[],
    playerTarget?: string,
    _botPosition?: { x: number; y: number; z: number } | null,
  ): ThreatPriority[] {
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
        if (t.distanceToBot < 4) priority = Math.min(5, priority + 1);

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
            ? "player_targeting" as const
            : t.distanceToBot < 4
              ? "proximity" as const
              : "type" as const,
        };
      })
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Build an IntentAction for combat support.
   * Caller MUST dispatch through SkillRouter.
   */
  buildCombatAction(target: ThreatPriority): IntentAction {
    return {
      id: `combat_${randomUUID().slice(0, 8)}`,
      type: "attack_entity",
      target: { entityName: target.entityName },
      priority: target.priority as IntentAction["priority"],
      reason: target.reason,
      timeout: 15000,
      cancelable: target.priority < 4,
    };
  }

  /**
   * Build a rescue-oriented follow action.
   */
  buildRescueAction(): IntentAction {
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
  shouldAvoidBowLoS(params: {
    playerHasBow: boolean;
    botRelativeAngle: number; // radians, 0 = in front of player
    distanceToPlayer: number;
  }): boolean {
    if (!this.config.avoidBowLoS) return false;
    if (!params.playerHasBow) return false;

    // Avoid standing in a ±30° cone in front of the player if within 10 blocks
    return params.distanceToPlayer < 10
      && Math.abs(params.botRelativeAngle) < Math.PI / 6;
  }

  /** Get current combat role. */
  getCurrentRole(): CombatRole {
    return this.currentRole;
  }

  /** Get last combat tick timestamp. */
  getLastCombatTick(): number {
    return this.lastCombatTick;
  }
}

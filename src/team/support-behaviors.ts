/**
 * SupportBehaviors — passive teammate actions.
 *
 * These are PASSIVE ONLY. They generate IntentAction suggestions
 * that flow through the standard SkillRouter → ActionDispatcher path.
 *
 * MUST NOT:
 *   - Call bot.*() directly
 *   - Bypass SkillRouter
 *   - Create autonomous execution loops
 *   - Introduce parallel AI systems
 *
 * All execution STILL goes through the canonical chain.
 */

import type { IntentAction } from "../interfaces/intent.js";
import type { TeamState } from "./team-state.js";
import { randomUUID } from "node:crypto";

// ─── Config ──────────────────────────────────────────

export interface SupportBehaviorConfig {
  /** Ideal follow distance (blocks) */
  idealFollowDistance: number;
  /** Max follow distance before regroup triggered */
  maxFollowDistance: number;
  /** Auto-pickup dropped items while following */
  autoPickupItems: boolean;
  /** Avoid standing in player's path */
  avoidBlocking: boolean;
  /** Minimum health to offer support (below = self-preserve) */
  minHealthForSupport: number;
}

const DEFAULT_SUPPORT_CONFIG: SupportBehaviorConfig = {
  idealFollowDistance: 3,
  maxFollowDistance: 32,
  autoPickupItems: true,
  avoidBlocking: true,
  minHealthForSupport: 6,
};

// ─── Support Behaviors ───────────────────────────────

export class SupportBehaviors {
  private config: SupportBehaviorConfig;

  constructor(config?: Partial<SupportBehaviorConfig>) {
    this.config = { ...DEFAULT_SUPPORT_CONFIG, ...config };
  }

  /**
   * Generate passive support actions based on team state.
   *
   * Returns IntentAction[] that the caller MUST dispatch through
   * SkillRouter.route() — never directly to ActionDispatcher.
   */
  evaluate(
    teamState: TeamState,
    botHealth: number,
  ): { actions: IntentAction[]; behaviorTriggered: string | null } {
    const actions: IntentAction[] = [];
    let triggered: string | null = null;

    // Don't support if bot itself is in danger
    if (botHealth < this.config.minHealthForSupport) {
      return { actions: [], behaviorTriggered: null };
    }

    // 1. Regroup: if bot is isolated, generate follow action toward leader
    if (teamState.isIsolated && teamState.nearbyPlayers.length > 0) {
      const leader = teamState.nearbyPlayers[0];
      if (leader.distanceToBot > this.config.maxFollowDistance) {
        actions.push({
          id: `support_regroup_${randomUUID().slice(0, 8)}`,
          type: "follow_player",
          target: { playerName: leader.name },
          priority: 3,
          reason: `Regrouping — ${leader.distanceToBot}m from ${leader.name}`,
          timeout: 60000,
        });
        triggered = "regroup";
        return { actions, behaviorTriggered: triggered };
      }
    }

    // 2. Auto-pickup nearby items while following
    if (this.config.autoPickupItems && teamState.teamMode === "peaceful") {
      actions.push({
        id: `support_pickup_${randomUUID().slice(0, 8)}`,
        type: "collect_nearby_items",
        target: {},
        priority: 1, // Low priority — don't interrupt important tasks
        reason: "Auto-pickup while following player",
        timeout: 5000,
        cancelable: true,
      });
      triggered = "auto_pickup";
    }

    // 3. Maintain follow distance — if too close, generate a brief wait
    if (this.config.avoidBlocking && teamState.nearbyPlayers.length > 0) {
      const closest = teamState.nearbyPlayers[0];
      if (closest.distanceToBot < 1.5) {
        actions.push({
          id: `support_unblock_${randomUUID().slice(0, 8)}`,
          type: "move_away_from",
          target: { playerName: closest.name },
          priority: 2,
          reason: "Avoid blocking player path",
          timeout: 3000,
          cancelable: true,
        });
        triggered = triggered || "avoid_blocking";
      }
    }

    return { actions, behaviorTriggered: triggered };
  }

  // ─── Config ────────────────────────────────────────

  setConfig(patch: Partial<SupportBehaviorConfig>): void {
    Object.assign(this.config, patch);
  }

  getConfig(): Readonly<SupportBehaviorConfig> {
    return this.config;
  }
}

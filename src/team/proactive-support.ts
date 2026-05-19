/**
 * ProactiveSupport — safe helper action generation (Phase 4-F).
 *
 * Generates support suggestions that ALWAYS flow through SkillRouter.
 * NEVER executes independently. NEVER overrides explicit player commands.
 *
 * Support behaviors:
 *   - Auto-light caves
 *   - Collect dropped items
 *   - Guard during mining
 *   - Share food if player starving
 *   - Keep formation distance
 *   - Warn about threats
 *   - Assist combat target focus
 *   - Regroup automatically
 *
 * MUST NOT:
 *   - Override player commands
 *   - Steal resources aggressively
 *   - Wander far away
 *   - Initiate dangerous combat alone
 *   - Bypass SkillRouter or ActionDispatcher
 */

import type { IntentAction } from "../interfaces/intent.js";
import type { TeamState } from "./team-state.js";
import type { PredictedIntent, PredictionContext } from "./intent-prediction.js";
import { randomUUID } from "node:crypto";

// ─── Support Config ────────────────────────────────────

export interface ProactiveSupportConfig {
  /** Min ms between support actions */
  cooldownMs: number;
  /** Max distance from player for support actions */
  maxSupportDistance: number;
  /** Max support actions per evaluation */
  maxActionsPerCycle: number;
  /** Whether to auto-light dark areas */
  autoLightEnabled: boolean;
  /** Whether to auto-collect drops */
  autoCollectEnabled: boolean;
  /** Whether to auto-share food */
  autoShareFood: boolean;
  /** Min player hunger to trigger food share */
  minPlayerHungerForShare: number;
  /** Supported area radius for threat watching */
  guardRadius: number;
}

const DEFAULT_SUPPORT_CONFIG: ProactiveSupportConfig = {
  cooldownMs: 8000,
  maxSupportDistance: 48,
  maxActionsPerCycle: 2,
  autoLightEnabled: true,
  autoCollectEnabled: true,
  autoShareFood: true,
  minPlayerHungerForShare: 4,
  guardRadius: 16,
};

// ─── Support Action Result ─────────────────────────────

export interface SupportEvaluation {
  actions: IntentAction[];
  /** Whether existing task should be interrupted for support */
  shouldInterrupt: boolean;
  /** Reason for interruption (if any) */
  interruptReason: string | null;
  /** Highest priority support opportunity found */
  highestPriority: number;
}

// ─── Engine ────────────────────────────────────────────

export class ProactiveSupportEngine {
  private config: ProactiveSupportConfig;
  private lastSupportTime = 0;
  private supportActionCount = 0;
  private cooldowns: Map<string, number> = new Map();

  constructor(config?: Partial<ProactiveSupportConfig>) {
    this.config = { ...DEFAULT_SUPPORT_CONFIG, ...config };
  }

  /**
   * Evaluate context and generate safe support actions.
   *
   * ALL returned actions MUST be dispatched through SkillRouter.route().
   * This method does NOT dispatch anything directly.
   */
  evaluateSupportActions(params: {
    prediction: PredictedIntent;
    context: PredictionContext;
    teamState: TeamState | null;
    botHealth: number;
    botHunger: number;
    currentTask?: string;
    voicePressureLevel?: string;
  }): SupportEvaluation {
    const actions: IntentAction[] = [];
    let shouldInterrupt = false;
    let interruptReason: string | null = null;
    let highestPriority = 0;

    // Check cooldown
    const now = Date.now();
    if (now - this.lastSupportTime < this.config.cooldownMs) {
      return { actions: [], shouldInterrupt: false, interruptReason: null, highestPriority: 0 };
    }

    // Don't support if bot is critically low
    if (params.botHealth < 4) {
      return { actions: [], shouldInterrupt: false, interruptReason: null, highestPriority: 0 };
    }

    const prediction = params.prediction;

    // ── 1. Guard during mining ────────────────────
    if (prediction.supportOpportunity === "guard") {
      const guardAction = this.createGuardAction(params.teamState);
      if (guardAction) {
        actions.push(guardAction);
        highestPriority = Math.max(highestPriority, 4);
      }
    }

    // ── 2. Combat backup ──────────────────────────
    if (prediction.supportOpportunity === "combat_backup") {
      const combatAction = this.createCombatBackupAction(params.teamState);
      if (combatAction) {
        actions.push(combatAction);
        highestPriority = Math.max(highestPriority, 5);
        shouldInterrupt = true;
        interruptReason = "Player in combat — switching to combat support";
      }
    }

    // ── 3. Regroup ────────────────────────────────
    if (prediction.supportOpportunity === "regroup" || prediction.intentType === "retreat") {
      const regroupAction = this.createRegroupAction(params.teamState);
      if (regroupAction) {
        actions.push(regroupAction);
        highestPriority = Math.max(highestPriority, 4);
        shouldInterrupt = params.prediction.intentType === "retreat";
        interruptReason = shouldInterrupt ? "Player retreating — regrouping" : null;
      }
    }

    // ── 4. Collect drops ──────────────────────────
    if (this.config.autoCollectEnabled && this.canAct("collect_drops")) {
      const collectAction = this.createCollectAction();
      if (collectAction && actions.length < this.config.maxActionsPerCycle) {
        actions.push(collectAction);
        this.markActed("collect_drops");
      }
    }

    // ── 5. Light area ─────────────────────────────
    if (this.config.autoLightEnabled && this.canAct("light_area")) {
      const lightAction = this.createLightAction(params.teamState);
      if (lightAction && actions.length < this.config.maxActionsPerCycle) {
        actions.push(lightAction);
        this.markActed("light_area");
      }
    }

    // ── 6. Share food ─────────────────────────────
    if (this.config.autoShareFood && params.context.playerHunger !== undefined
        && params.context.playerHunger <= this.config.minPlayerHungerForShare
        && params.botHunger > 10) {
      const shareAction = this.createShareFoodAction();
      if (shareAction && actions.length < this.config.maxActionsPerCycle) {
        actions.push(shareAction);
        highestPriority = Math.max(highestPriority, 3);
      }
    }

    // ── 7. Scout ahead during exploration ─────────
    if (prediction.supportOpportunity === "scout_ahead") {
      const scoutAction = this.createScoutAction();
      if (scoutAction && actions.length < this.config.maxActionsPerCycle) {
        actions.push(scoutAction);
        highestPriority = Math.max(highestPriority, 2);
      }
    }

    // ── 8. Assist mining ──────────────────────────
    if (prediction.supportOpportunity === "assist_mining") {
      const miningAction = this.createAssistMiningAction(params.context);
      if (miningAction && actions.length < this.config.maxActionsPerCycle) {
        actions.push(miningAction);
        highestPriority = Math.max(highestPriority, 3);
      }
    }

    if (actions.length > 0) {
      this.lastSupportTime = now;
      this.supportActionCount += actions.length;
    }

    return { actions, shouldInterrupt, interruptReason, highestPriority };
  }

  /**
   * Determine whether current task should be interrupted for support.
   */
  shouldInterruptCurrentTask(
    prediction: PredictedIntent,
    currentTaskPriority: number,
    currentTaskElapsedMs: number,
  ): boolean {
    // Always interrupt for combat/retreat
    if (prediction.intentType === "combat" || prediction.intentType === "retreat") {
      return true;
    }

    // Interrupt low-priority tasks for important support
    if (currentTaskPriority <= 2 && prediction.confidence > 0.6) {
      return prediction.supportOpportunity === "guard"
        || prediction.supportOpportunity === "regroup";
    }

    // Don't interrupt tasks that just started
    if (currentTaskElapsedMs < 3000) {
      return false;
    }

    return false;
  }

  /**
   * Score a support opportunity 0–1 for prioritization.
   */
  scoreSupportOpportunity(
    prediction: PredictedIntent,
    context: PredictionContext,
  ): number {
    let score = prediction.confidence;

    // Higher urgency for danger
    if (prediction.intentType === "combat" || prediction.intentType === "retreat") {
      score += 0.3;
    }

    // Higher score when player needs help
    if (context.playerHealth !== undefined && context.playerHealth < 8) {
      score += 0.2;
    }
    if (context.playerHunger !== undefined && context.playerHunger < 6) {
      score += 0.15;
    }

    // Familiarity boosts support motivation
    score += (context.familiarityLevel / 100) * 0.15;

    return Math.min(1.0, score);
  }

  /** Get total support actions generated. */
  getSupportStats(): { totalActions: number; lastSupportTime: number } {
    return {
      totalActions: this.supportActionCount,
      lastSupportTime: this.lastSupportTime,
    };
  }

  // ─── Action Factories ─────────────────────────────

  private createGuardAction(teamState: TeamState | null): IntentAction | null {
    return {
      id: `support_guard_${randomUUID().slice(0, 8)}`,
      type: "wait",
      target: {},
      priority: 4,
      reason: "Guarding player while they are occupied",
      timeout: 30000,
      cancelable: true,
    };
  }

  private createCombatBackupAction(teamState: TeamState | null): IntentAction | null {
    if (!teamState || teamState.activeThreats.length === 0) return null;
    const threat = teamState.activeThreats[0];
    return {
      id: `support_combat_${randomUUID().slice(0, 8)}`,
      type: "attack_entity",
      target: { entityName: threat.entityName },
      priority: 5,
      reason: `Backing up player against ${threat.entityName}`,
      timeout: 20000,
      cancelable: false,
    };
  }

  private createRegroupAction(teamState: TeamState | null): IntentAction | null {
    if (!teamState || teamState.nearbyPlayers.length === 0) return null;
    const leader = teamState.nearbyPlayers[0];
    return {
      id: `support_regroup_${randomUUID().slice(0, 8)}`,
      type: "follow_player",
      target: { playerName: leader.name },
      priority: 4,
      reason: `Regrouping with ${leader.name} (${leader.distanceToBot}m away)`,
      timeout: 30000,
      cancelable: true,
    };
  }

  private createCollectAction(): IntentAction | null {
    return {
      id: `support_collect_${randomUUID().slice(0, 8)}`,
      type: "collect_nearby_items",
      target: {},
      priority: 1,
      reason: "Auto-collecting nearby dropped items",
      timeout: 5000,
      cancelable: true,
    };
  }

  private createLightAction(teamState: TeamState | null): IntentAction | null {
    return {
      id: `support_light_${randomUUID().slice(0, 8)}`,
      type: "place_torch",
      target: {},
      priority: 2,
      reason: "Lighting dark area for safety",
      timeout: 5000,
      cancelable: true,
    };
  }

  private createShareFoodAction(): IntentAction | null {
    return {
      id: `support_share_food_${randomUUID().slice(0, 8)}`,
      type: "give_to_player",
      target: { playerName: "" },
      priority: 3,
      reason: "Player is hungry — sharing food",
      timeout: 8000,
      cancelable: true,
    };
  }

  private createScoutAction(): IntentAction | null {
    return {
      id: `support_scout_${randomUUID().slice(0, 8)}`,
      type: "move_to",
      target: {},
      priority: 2,
      reason: "Scouting ahead during exploration",
      timeout: 15000,
      cancelable: true,
    };
  }

  private createAssistMiningAction(context: PredictionContext): IntentAction | null {
    const ores = context.nearbyBlocks.filter((b) =>
      /ore|diamond|emerald|gold|iron|coal|redstone|lapis|copper/.test(b),
    );
    if (ores.length === 0) return null;
    return {
      id: `support_mine_${randomUUID().slice(0, 8)}`,
      type: "collect_block",
      target: { blockType: ores[0] },
      priority: 3,
      reason: `Assisting mining: ${ores[0]}`,
      timeout: 10000,
      cancelable: true,
    };
  }

  // ─── Cooldown Helpers ─────────────────────────────

  private canAct(actionType: string): boolean {
    const last = this.cooldowns.get(actionType) || 0;
    return Date.now() - last >= 15000; // 15s per-type cooldown
  }

  private markActed(actionType: string): void {
    this.cooldowns.set(actionType, Date.now());
  }
}

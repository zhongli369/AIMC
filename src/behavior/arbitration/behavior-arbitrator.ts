/**
 * BehaviorArbitrator — real-time behavior arbitration layer (Phase 4-G).
 *
 * Collects signals from ALL soft influence layers and produces a single
 * prioritized action list for SkillRouter. Resolves conflicts between
 * tactical, role, voice, relationship, memory, and cooperative signals.
 *
 * DETERMINISTIC — same input → same output. No AI, no randomness.
 *
 * Emergency Rules (checked in order):
 *   1. Memory emergency ALWAYS overrides everything
 *   2. Voice pressure overrides tactical ONLY if safe state
 *   3. Combat safety: HP < 30% → role cannot force attack
 *   4. Relationship protection overrides mining/building if player in danger
 *   5. Only ONE final primary action is selected
 *
 * ADVISORY ONLY. All actions flow through SkillRouter.
 * NEVER executes independently. NEVER bypasses the token gate.
 */

import type { IntentAction, ActionType } from "../../interfaces/intent.js";
import type { VoicePressureSignal } from "../../voice/voice-pressure.js";
import type { TacticalRecommendation } from "../../team/tactical-analyzer.js";
import type { CompanionRole } from "../../role/role-identity.js";
import type { RelationshipSnapshot } from "../../memory/relationship-state.js";
import type {
  PredictedIntent,
  PlayerIntentType,
  SupportOpportunityType,
} from "../../team/intent-prediction.js";
import { randomUUID } from "node:crypto";

// ─── Memory Urgency Signal ───────────────────────────────

export interface MemoryUrgencySignal {
  level: "none" | "low" | "medium" | "high" | "emergency";
  triggeredMemories: string[];
  suggestedAction?: string;
  urgencyScore: number; // 0–1
}

// ─── Cooperative State ────────────────────────────────────

export interface CooperativeStateSignal {
  predictedIntent: PlayerIntentType | null;
  predictionConfidence: number;
  supportOpportunity: SupportOpportunityType | null;
  supportPriority: number; // 1–5
}

// ─── Arbitration Input ────────────────────────────────────

export interface ArbitrationInput {
  /** Proposed actions from LLM (validated AgentOutput.actions) */
  proposedActions: IntentAction[];
  /** Current bot intent from LLM (chat/skill/plan) */
  agentIntent?: string;
  /** Tactical recommendation (4-C) */
  tacticalRecommendation: TacticalRecommendation;
  /** Role skill weights (4-D) */
  roleSkillWeights: Record<string, number>;
  /** Current companion role */
  companionRole: CompanionRole;
  /** Relationship snapshot (4-E) */
  relationshipSnapshot: RelationshipSnapshot | null;
  /** Voice pressure signal (4-A/B) */
  voicePressure: VoicePressureSignal;
  /** Cooperative state (4-F) */
  cooperativeState: CooperativeStateSignal;
  /** Memory urgency (4-E) */
  memoryUrgency: MemoryUrgencySignal | null;
  /** Bot health (0–20) */
  botHealth: number;
  /** Player health (0–20, if known) */
  playerHealth?: number;
}

// ─── Arbitration Output ───────────────────────────────────

export interface SuppressedAction {
  action: IntentAction;
  reason: string;
  suppressedBy: string; // rule name
}

export interface ArbitrationResult {
  /** Final ranked action list for SkillRouter */
  rankedActions: IntentAction[];
  /** Primary (winning) action */
  primaryAction: IntentAction | null;
  /** Actions that were suppressed or removed */
  suppressedActions: SuppressedAction[];
  /** Which emergency rule was applied (if any) */
  appliedRule: string | null;
  /** Human-readable reason chain for the decision */
  reasonChain: string[];
  /** Per-signal normalized weights for telemetry */
  signalWeights: ArbitrationWeights;
}

// ─── Arbitration Weights ──────────────────────────────────

export interface ArbitrationWeights {
  tacticalWeight: number;
  roleWeight: number;
  relationshipWeight: number;
  memoryWeight: number;
  voiceWeight: number;
  cooperativeWeight: number;
  finalScore: number;
}

// ─── Config ───────────────────────────────────────────────

export interface ArbitrationConfig {
  /** Weight coefficients in the final score formula */
  coefficients: {
    tactical: number;
    role: number;
    relationship: number;
    memory: number;
    voice: number;
    cooperative: number;
  };
  /** Bot health threshold for combat override (fraction 0–1) */
  combatOverrideHealthFraction: number;
  /** Player health threshold for relationship protection */
  playerDangerHealthThreshold: number;
  /** Max suppressed actions to track */
  maxSuppressedActions: number;
}

const DEFAULT_CONFIG: ArbitrationConfig = {
  coefficients: {
    tactical: 1.0,
    role: 0.8,
    relationship: 0.7,
    memory: 1.2,
    voice: 1.5,
    cooperative: 0.9,
  },
  combatOverrideHealthFraction: 0.3,
  playerDangerHealthThreshold: 8,
  maxSuppressedActions: 16,
};

// ─── Action Category Mapping ──────────────────────────────

const COMBAT_ACTIONS: Set<ActionType> = new Set([
  "attack_entity", "defend_self", "flee",
]);

const MINING_ACTIONS: Set<ActionType> = new Set([
  "mine_block", "collect_block",
]);

const BUILDING_ACTIONS: Set<ActionType> = new Set([
  "place_block", "craft_item", "smelt_item",
]);

const SURVIVAL_ACTIONS: Set<ActionType> = new Set([
  "consume", "flee", "defend_self", "go_to_surface", "equip_item",
]);

const SUPPORT_ACTIONS: Set<ActionType> = new Set([
  "follow_player", "give_to_player", "place_torch", "collect_nearby_items",
]);

// ─── Tactical → Weight Mapping ────────────────────────────

const TACTICAL_WEIGHT_MAP: Record<TacticalRecommendation, number> = {
  retreat: 2.0,
  protect: 1.8,
  regroup: 1.5,
  assist_mining: 0.8,
  scout: 0.7,
  follow: 1.0,
  hold_position: 0.5,
  none: 0.5,
};

// ─── Engine ───────────────────────────────────────────────

export class BehaviorArbitrator {
  private config: ArbitrationConfig;
  private decisionLog: ArbitrationResult[] = [];

  // Phase 0.5: Optional config-driven multipliers (applied on top of coefficients)
  private voiceWeightMultiplier = 1.0;
  private memoryWeightMultiplier = 1.0;
  private relationshipProtectionEnabled = true;

  constructor(config?: Partial<ArbitrationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (config?.coefficients) {
      this.config.coefficients = { ...DEFAULT_CONFIG.coefficients, ...config.coefficients };
    }
  }

  /**
   * Apply config-driven weight multipliers (Phase 0.5).
   * Called at startup after config file is loaded.
   * Multipliers are applied ON TOP of the base coefficients — they do NOT replace them.
   */
  applyConfigMultipliers(params: {
    voiceWeightMultiplier?: number;
    memoryWeightMultiplier?: number;
    relationshipProtectionEnabled?: boolean;
  }): void {
    if (params.voiceWeightMultiplier !== undefined) this.voiceWeightMultiplier = params.voiceWeightMultiplier;
    if (params.memoryWeightMultiplier !== undefined) this.memoryWeightMultiplier = params.memoryWeightMultiplier;
    if (params.relationshipProtectionEnabled !== undefined) this.relationshipProtectionEnabled = params.relationshipProtectionEnabled;
    console.log(`[Arbitration] Config multipliers applied — voice:${this.voiceWeightMultiplier}x memory:${this.memoryWeightMultiplier}x relationshipProtect:${this.relationshipProtectionEnabled}`);
  }

  /**
   * Evaluate all subsystem signals and produce a single arbitrated action list.
   *
   * This is the SOLE entry point for behavior arbitration.
   * Call AFTER RuntimeCore.validate() and BEFORE SkillRouter.route().
   */
  evaluate(input: ArbitrationInput): ArbitrationResult {
    const reasonChain: string[] = [];
    const suppressedActions: SuppressedAction[] = [];
    let appliedRule: string | null = null;

    // ════════════════════════════════════════════════════════
    // RULE 1: Emergency memory ALWAYS overrides everything
    // ════════════════════════════════════════════════════════
    if (this.hasEmergencyMemory(input.memoryUrgency)) {
      appliedRule = "rule1_emergency_memory";
      reasonChain.push("RULE 1: Emergency memory override active");
      reasonChain.push(
        `Triggered by: ${input.memoryUrgency!.triggeredMemories.slice(0, 3).join("; ")}`,
      );

      const weights = this.computeWeights(input);
      const emergencyAction = this.buildEmergencyAction(input);

      const result: ArbitrationResult = {
        rankedActions: emergencyAction ? [emergencyAction] : [],
        primaryAction: emergencyAction,
        suppressedActions: input.proposedActions.map((a) => ({
          action: a,
          reason: "Suppressed by emergency memory rule",
          suppressedBy: "rule1_emergency_memory",
        })),
        appliedRule,
        reasonChain,
        signalWeights: weights,
      };

      this.logDecision(result);
      return result;
    }

    // ════════════════════════════════════════════════════════
    // RULE 3: Combat safety — low HP blocks attack behavior
    // ════════════════════════════════════════════════════════
    const hpFraction = input.botHealth / 20;
    if (hpFraction < this.config.combatOverrideHealthFraction) {
      appliedRule = "rule3_combat_safety";

      // Filter out combat actions from proposed actions
      const filtered = input.proposedActions.filter((a) => {
        if (COMBAT_ACTIONS.has(a.type)) {
          suppressedActions.push({
            action: a,
            reason: `Blocked: bot HP at ${(hpFraction * 100).toFixed(0)}% (threshold ${this.config.combatOverrideHealthFraction * 100}%)`,
            suppressedBy: "rule3_combat_safety",
          });
          return false;
        }
        return true;
      });

      // Inject survival action if none remain
      let finalActions = filtered;
      if (finalActions.length === 0 || !finalActions.some((a) => SURVIVAL_ACTIONS.has(a.type))) {
        const fleeAction = this.buildSurvivalAction(input.botHealth);
        finalActions = [fleeAction, ...finalActions];
        reasonChain.push("RULE 3: Injected survival action — bot critically low HP");
      }

      reasonChain.push(
        `RULE 3: Combat safety active — HP ${(hpFraction * 100).toFixed(0)}%, combat actions blocked`,
      );

      const weights = this.computeWeights(input);
      const primary = this.selectPrimary(finalActions);

      const result: ArbitrationResult = {
        rankedActions: this.rankByPriority(finalActions),
        primaryAction: primary,
        suppressedActions,
        appliedRule,
        reasonChain,
        signalWeights: weights,
      };

      this.logDecision(result);
      return result;
    }

    // ════════════════════════════════════════════════════════
    // RULE 4: Relationship protection — player danger overrides
    // ════════════════════════════════════════════════════════
    if (this.isPlayerInDanger(input)) {
      appliedRule = "rule4_relationship_protection";

      // Suppress mining/building actions
      const filtered = input.proposedActions.filter((a) => {
        if (MINING_ACTIONS.has(a.type) || BUILDING_ACTIONS.has(a.type)) {
          suppressedActions.push({
            action: a,
            reason: "Player in danger — mining/building suppressed for protection",
            suppressedBy: "rule4_relationship_protection",
          });
          return false;
        }
        return true;
      });

      // Inject protect action if needed
      if (!filtered.some((a) => a.type === "follow_player" || a.type === "attack_entity")) {
        const protectAction = this.buildProtectAction(input);
        filtered.unshift(protectAction);
        reasonChain.push("RULE 4: Injected player protection action");
      }

      reasonChain.push(
        `RULE 4: Relationship protection — player HP ${input.playerHealth ?? "unknown"}, guarding player`,
      );

      const weights = this.computeWeights(input);
      const primary = this.selectPrimary(filtered);

      const result: ArbitrationResult = {
        rankedActions: this.rankByPriority(filtered),
        primaryAction: primary,
        suppressedActions,
        appliedRule,
        reasonChain,
        signalWeights: weights,
      };

      this.logDecision(result);
      return result;
    }

    // ════════════════════════════════════════════════════════
    // RULE 2: Voice pressure overrides tactical (safe state only)
    // ════════════════════════════════════════════════════════
    const voiceOverrides = this.voiceOverridesTactical(input);
    if (voiceOverrides) {
      appliedRule = "rule2_voice_override";
      reasonChain.push(
        `RULE 2: Voice pressure "${input.voicePressure.level}" overrides tactical "${input.tacticalRecommendation}"`,
      );

      // Adjust action priorities based on voice pressure
      const adjusted = input.proposedActions.map((a) => ({
        ...a,
        priority: this.adjustPriorityForVoice(a, input.voicePressure),
        reason: `${a.reason} [voice-pressure: ${input.voicePressure.level}]`,
      }));

      const weights = this.computeWeights(input);
      const primary = this.selectPrimary(adjusted);

      const result: ArbitrationResult = {
        rankedActions: this.rankByPriority(adjusted),
        primaryAction: primary,
        suppressedActions,
        appliedRule,
        reasonChain,
        signalWeights: weights,
      };

      this.logDecision(result);
      return result;
    }

    // ════════════════════════════════════════════════════════
    // STANDARD PATH: Weight-based arbitration
    // ════════════════════════════════════════════════════════
    const weights = this.computeWeights(input);
    reasonChain.push(
      `Standard arbitration: finalScore=${weights.finalScore.toFixed(3)} ` +
      `(T:${weights.tacticalWeight.toFixed(2)} R:${weights.roleWeight.toFixed(2)} ` +
      `Rel:${weights.relationshipWeight.toFixed(2)} M:${weights.memoryWeight.toFixed(2)} ` +
      `V:${weights.voiceWeight.toFixed(2)} C:${weights.cooperativeWeight.toFixed(2)})`,
    );

    // Rank actions by priority (no emergency rule applied)
    const ranked = this.rankByPriority(input.proposedActions);

    // RULE 5: Only ONE primary action
    const primary = this.selectPrimary(ranked);

    if (ranked.length > 1) {
      reasonChain.push(`RULE 5: ${ranked.length} actions → primary: ${primary?.type ?? "none"}`);
    }

    // Secondary actions (non-primary) are marked as suppressed for telemetry
    for (let i = 1; i < ranked.length; i++) {
      suppressedActions.push({
        action: ranked[i],
        reason: "Secondary action — superseded by primary",
        suppressedBy: "rule5_single_primary",
      });
    }

    const result: ArbitrationResult = {
      rankedActions: [primary, ...ranked.filter((a) => a.id !== primary?.id)].filter(Boolean) as IntentAction[],
      primaryAction: primary,
      suppressedActions,
      appliedRule,
      reasonChain,
      signalWeights: weights,
    };

    this.logDecision(result);
    return result;
  }

  /**
   * Compute normalized per-signal weights and final arbitration score.
   *
   * finalScore = T*1.0 + R*0.8 + Rel*0.7 + M*1.2 + V*1.5 + C*0.9
   */
  computeWeights(input: ArbitrationInput): ArbitrationWeights {
    const tacticalWeight = this.normalizeTactical(input.tacticalRecommendation);
    const roleWeight = this.normalizeRole(input.roleSkillWeights, input.companionRole, input.proposedActions);
    const relationshipWeight = this.normalizeRelationship(input.relationshipSnapshot);
    const memoryWeight = this.normalizeMemory(input.memoryUrgency);
    const voiceWeight = this.normalizeVoice(input.voicePressure);
    const cooperativeWeight = this.normalizeCooperative(input.cooperativeState);

    const { coefficients: c } = this.config;
    // Phase 0.5: Apply config multipliers on top of base coefficients
    const finalScore =
      tacticalWeight * c.tactical +
      roleWeight * c.role +
      relationshipWeight * c.relationship +
      memoryWeight * c.memory * this.memoryWeightMultiplier +
      voiceWeight * c.voice * this.voiceWeightMultiplier +
      cooperativeWeight * c.cooperative;

    return {
      tacticalWeight,
      roleWeight,
      relationshipWeight,
      memoryWeight,
      voiceWeight,
      cooperativeWeight,
      finalScore,
    };
  }

  /** Get recent decisions for telemetry/audit. */
  getDecisionLog(limit?: number): ArbitrationResult[] {
    return this.decisionLog.slice(0, limit ?? 20);
  }

  /** Clear decision log. */
  clearDecisionLog(): void {
    this.decisionLog = [];
  }

  // ─── Rule Checks ──────────────────────────────────────

  private hasEmergencyMemory(urgency: MemoryUrgencySignal | null): boolean {
    if (!urgency) return false;
    return urgency.level === "emergency" && urgency.urgencyScore >= 0.8;
  }

  private isPlayerInDanger(input: ArbitrationInput): boolean {
    // Phase 0.5: Respect relationship protection config flag
    if (!this.relationshipProtectionEnabled) return false;
    if (input.playerHealth === undefined) return false;
    if (input.playerHealth >= this.config.playerDangerHealthThreshold) return false;

    // Only relevant if we have a relationship worth protecting
    if (input.relationshipSnapshot) {
      if (input.relationshipSnapshot.familiarity < 20) return false;
    }

    // Player low HP + nearby threats or combat context
    return (
      input.tacticalRecommendation === "protect" ||
      input.tacticalRecommendation === "retreat" ||
      input.cooperativeState.predictedIntent === "combat" ||
      input.cooperativeState.predictedIntent === "retreat"
    );
  }

  private voiceOverridesTactical(input: ArbitrationInput): boolean {
    const { voicePressure, tacticalRecommendation } = input;

    // Only urgent/critical voice can override
    if (voicePressure.level !== "urgent" && voicePressure.level !== "critical") {
      return false;
    }

    // Voice confidence must be high
    if (voicePressure.confidence < 0.6) return false;

    // Only override if safe (not in combat, not retreating)
    const isSafe =
      tacticalRecommendation !== "retreat" &&
      tacticalRecommendation !== "protect" &&
      input.cooperativeState.predictedIntent !== "combat" &&
      input.cooperativeState.predictedIntent !== "retreat";

    return isSafe;
  }

  // ─── Signal Normalization ──────────────────────────────

  private normalizeTactical(recommendation: TacticalRecommendation): number {
    return TACTICAL_WEIGHT_MAP[recommendation] ?? 0.5;
  }

  private normalizeRole(
    skillWeights: Record<string, number>,
    _role: CompanionRole,
    proposedActions: IntentAction[],
  ): number {
    if (proposedActions.length === 0) return 1.0;

    // Compute average role weight for proposed action types
    let sum = 0;
    let count = 0;
    for (const action of proposedActions) {
      const w = skillWeights[action.type] ?? 1.0;
      sum += w;
      count++;
    }

    if (count === 0) return 1.0;
    const avg = sum / count;
    // Clamp to [0.0, 2.0]
    return Math.max(0.0, Math.min(2.0, avg));
  }

  private normalizeRelationship(snapshot: RelationshipSnapshot | null): number {
    if (!snapshot) return 1.0; // No relationship data → neutral

    // Familiarity + trust → weight (higher → more protective/cooperative)
    const composite = (snapshot.familiarity * 0.5 + snapshot.trust * 0.5) / 100;
    // Map to [0.4, 2.0] — even low relationship gets some weight
    return 0.4 + composite * 1.6;
  }

  private normalizeMemory(urgency: MemoryUrgencySignal | null): number {
    if (!urgency) return 1.0;

    switch (urgency.level) {
      case "emergency": return 2.0;
      case "high": return 1.7;
      case "medium": return 1.4;
      case "low": return 1.1;
      case "none":
      default: return 1.0;
    }
  }

  private normalizeVoice(pressure: VoicePressureSignal): number {
    switch (pressure.level) {
      case "critical": return 2.0;
      case "urgent": return 1.7;
      case "normal": return 1.0;
      case "calm": return 0.5;
    }
  }

  private normalizeCooperative(coop: CooperativeStateSignal): number {
    if (!coop.predictedIntent || coop.predictedIntent === "idle") return 1.0;

    // Higher support priority → higher weight
    const priorityFactor = (coop.supportPriority - 1) / 4; // 0–1
    const confidenceFactor = coop.predictionConfidence;

    // Map to [0.5, 2.0]
    return 0.5 + (priorityFactor * 0.8 + confidenceFactor * 0.7);
  }

  // ─── Action Ranking ────────────────────────────────────

  private rankByPriority(actions: IntentAction[]): IntentAction[] {
    return [...actions].sort((a, b) => {
      // Priority first (descending)
      if (b.priority !== a.priority) return b.priority - a.priority;
      // Non-cancelable actions first (tie-break)
      if (a.cancelable !== b.cancelable) return a.cancelable ? 1 : -1;
      // Shorter timeout first (tie-break)
      return (a.timeout ?? 5000) - (b.timeout ?? 5000);
    });
  }

  private selectPrimary(actions: IntentAction[]): IntentAction | null {
    if (actions.length === 0) return null;
    return this.rankByPriority(actions)[0];
  }

  private adjustPriorityForVoice(
    action: IntentAction,
    pressure: VoicePressureSignal,
  ): IntentAction["priority"] {
    const boost = pressure.level === "critical" ? 2 : pressure.level === "urgent" ? 1 : 0;
    const current = action.priority;
    const adjusted = Math.min(5, current + boost) as IntentAction["priority"];
    return adjusted;
  }

  // ─── Emergency Action Builders ─────────────────────────

  private buildEmergencyAction(input: ArbitrationInput): IntentAction | null {
    const urgency = input.memoryUrgency;
    if (!urgency) return null;

    const suggestedType = urgency.suggestedAction || "flee";

    return {
      id: `arb_emergency_${randomUUID().slice(0, 8)}`,
      type: this.sanitizeActionType(suggestedType),
      target: {},
      priority: 5,
      reason: `EMERGENCY: ${urgency.triggeredMemories.slice(0, 2).join("; ")}`,
      timeout: 10000,
      cancelable: false,
    };
  }

  private buildSurvivalAction(botHealth: number): IntentAction {
    if (botHealth < 6) {
      return {
        id: `arb_survival_flee_${randomUUID().slice(0, 8)}`,
        type: "flee",
        target: {},
        priority: 5,
        reason: "Critical HP — emergency flee (arbitration)",
        timeout: 10000,
        cancelable: false,
      };
    }
    return {
      id: `arb_survival_consume_${randomUUID().slice(0, 8)}`,
      type: "consume",
      target: {},
      priority: 5,
      reason: "Low HP — heal (arbitration)",
      timeout: 8000,
      cancelable: false,
    };
  }

  private buildProtectAction(input: ArbitrationInput): IntentAction {
    return {
      id: `arb_protect_${randomUUID().slice(0, 8)}`,
      type: "follow_player",
      target: {},
      priority: 4,
      reason: `Protecting player (HP: ${input.playerHealth ?? "unknown"}) — arbitration override`,
      timeout: 15000,
      cancelable: false,
    };
  }

  private sanitizeActionType(raw: string): ActionType {
    const valid: ActionType[] = [
      "flee", "defend_self", "consume", "follow_player", "go_to_surface",
      "wait", "move_to", "attack_entity", "equip_item", "collect_nearby_items",
    ];
    const lower = raw.toLowerCase();
    for (const v of valid) {
      if (v === lower || lower.includes(v)) return v;
    }
    return "flee"; // safest default
  }

  private logDecision(result: ArbitrationResult): void {
    this.decisionLog.unshift(result);
    if (this.decisionLog.length > this.config.maxSuppressedActions) {
      this.decisionLog = this.decisionLog.slice(0, this.config.maxSuppressedActions);
    }
  }
}

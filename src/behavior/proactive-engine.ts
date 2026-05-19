/**
 * ProactiveEngine — autonomous behavior generation.
 *
 * AI autonomously: follows player, warns about danger, suggests goals,
 * gathers resources, assists combat, checks player condition.
 *
 * Priority hierarchy:
 *   1. Survival (self-preservation)
 *   2. Cooperation (player assistance)
 *   3. Efficiency (long-term optimization)
 *   4. Support (resource gathering, lighting, etc.)
 */
import { EventEmitter } from "node:events";
import type { BotState } from "../interfaces/minecraft.js";
import type { GameEvent } from "../interfaces/event.js";
import type { PersonalityEngine, DecisionContext } from "../personality/personality-engine.js";
import type { EmotionEngine } from "../personality/emotion-engine.js";

// ─── Proactive Intent ────────────────────────────────

export interface ProactiveIntent {
  /** Action type to execute */
  actionType: string;
  /** Priority 1–5 (higher = more urgent) */
  priority: number;
  /** Reason for this proactive action */
  reason: string;
  /** Target specification */
  target?: Record<string, unknown>;
  /** Whether this intent requires LLM validation */
  requireLLM: boolean;
}

// ─── Config ──────────────────────────────────────────

export interface ProactiveConfig {
  /** Interval between proactive evaluation ticks (ms) */
  evaluationIntervalMs: number;
  /** Minimum interval between actions (ms) */
  minActionIntervalMs: number;
  /** Max intents to generate per evaluation */
  maxIntentsPerTick: number;
  /** Whether to require LLM validation for high-risk actions */
  llmValidationForRisky: boolean;
  /** Max follow distance from player (blocks) */
  maxFollowDistance: number;
  /** Health threshold for self-preservation mode */
  survivalHealthThreshold: number;
}

const DEFAULT_CONFIG: ProactiveConfig = {
  evaluationIntervalMs: 5000,
  minActionIntervalMs: 8000,
  maxIntentsPerTick: 2,
  llmValidationForRisky: true,
  maxFollowDistance: 32,
  survivalHealthThreshold: 30,
};

// ─── Behavior Priority Constants ─────────────────────

const PRIORITY_SURVIVAL = 5;
const PRIORITY_COOPERATION = 4;
const PRIORITY_EFFICIENCY = 3;
const PRIORITY_SUPPORT = 2;

// ─── Engine ──────────────────────────────────────────

export class ProactiveEngine extends EventEmitter {
  private config: ProactiveConfig;
  private personality: PersonalityEngine;
  private emotion: EmotionEngine;
  private lastActionTime = 0;
  private evaluationTimer: ReturnType<typeof setInterval> | null = null;
  private active = false;

  constructor(
    personality: PersonalityEngine,
    emotion: EmotionEngine,
    config?: Partial<ProactiveConfig>,
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.personality = personality;
    this.emotion = emotion;
  }

  // ─── Lifecycle ─────────────────────────────────────

  start(): void {
    if (this.active) return;
    this.active = true;
    this.evaluationTimer = setInterval(() => this.evaluate(), this.config.evaluationIntervalMs);
    console.log("[ProactiveEngine] Started — autonomous behavior active");
  }

  stop(): void {
    this.active = false;
    if (this.evaluationTimer) {
      clearInterval(this.evaluationTimer);
      this.evaluationTimer = null;
    }
    console.log("[ProactiveEngine] Stopped.");
  }

  isActive(): boolean {
    return this.active;
  }

  // ─── Evaluation ────────────────────────────────────

  /**
   * Evaluate current state and generate proactive intents.
   * Called on a timer.
   */
  async evaluate(params?: {
    botState?: BotState | null;
    recentEvents?: GameEvent[];
    nearbyEntities?: string[];
  }): Promise<ProactiveIntent[]> {
    if (!this.active) return [];
    if (params && !params.botState) return [];

    const botState = params?.botState;
    if (!botState) return [];

    const now = Date.now();

    // Rate limit
    if (now - this.lastActionTime < this.config.minActionIntervalMs) {
      return [];
    }

    // Build decision context
    const context = this.buildContext(botState, params?.recentEvents || [], params?.nearbyEntities || []);

    // Check if personality wants to act now
    if (!this.personality.shouldActProactively(context)) {
      return [];
    }

    const intents: ProactiveIntent[] = [];

    // ═══ Priority 1: Survival ═══
    intents.push(...this.evaluateSurvival(botState, context));

    // ═══ Priority 2: Cooperation ═══
    intents.push(...this.evaluateCooperation(botState, context));

    // ═══ Priority 3: Efficiency ═══
    intents.push(...this.evaluateEfficiency(botState, context));

    // ═══ Priority 4: Support ═══
    intents.push(...this.evaluateSupport(botState, context));

    // Sort by priority (highest first), limit
    intents.sort((a, b) => b.priority - a.priority);
    const selected = intents.slice(0, this.config.maxIntentsPerTick);

    if (selected.length > 0) {
      this.lastActionTime = now;
      for (const intent of selected) {
        this.emit("intent", intent);
      }
      console.log(`[ProactiveEngine] Generated ${selected.length} proactive intent(s): ${selected.map((i) => i.actionType).join(", ")}`);
    }

    return selected;
  }

  // ─── Priority Evaluators ───────────────────────────

  private evaluateSurvival(
    state: BotState,
    ctx: DecisionContext,
  ): ProactiveIntent[] {
    const intents: ProactiveIntent[] = [];
    const hp = ctx.healthPercent;

    // Critical health — must eat or flee
    if (hp < 20 && state.food > 3) {
      intents.push({
        actionType: "consume",
        priority: PRIORITY_SURVIVAL,
        reason: `Health critical at ${hp.toFixed(0)}% — must eat`,
        target: { itemName: "food" },
        requireLLM: false,
      });
    }

    // Low health with nearby hostiles — flee
    if (hp < this.config.survivalHealthThreshold && ctx.nearbyHostiles > 0) {
      intents.push({
        actionType: "flee",
        priority: PRIORITY_SURVIVAL,
        reason: `Low health (${hp.toFixed(0)}%) with ${ctx.nearbyHostiles} hostiles — fleeing`,
        requireLLM: false,
      });
    }

    // Starving
    if (state.food < 6) {
      intents.push({
        actionType: "consume",
        priority: PRIORITY_SURVIVAL,
        reason: `Food low (${state.food.toFixed(0)}) — must eat soon`,
        target: { itemName: "food" },
        requireLLM: false,
      });
    }

    return intents;
  }

  private evaluateCooperation(
    state: BotState,
    ctx: DecisionContext,
  ): ProactiveIntent[] {
    const intents: ProactiveIntent[] = [];

    // Player nearby — follow
    if (ctx.playerNearby && this.personality.getTraits().helpfulness > 0.5) {
      intents.push({
        actionType: "follow_player",
        priority: PRIORITY_COOPERATION,
        reason: "Keeping close to player",
        requireLLM: false,
      });
    }

    // Warn player if nearby hostiles
    if (ctx.nearbyHostiles > 0 && ctx.playerNearby && ctx.healthPercent > 40) {
      intents.push({
        actionType: "speak_chat",
        priority: PRIORITY_COOPERATION,
        reason: `Warning player about ${ctx.nearbyHostiles} hostiles nearby`,
        target: { text: `Careful — ${ctx.nearbyHostiles} hostiles nearby!` },
        requireLLM: false,
      });
    }

    // Assist in combat
    if (ctx.nearbyHostiles > 0 && ctx.healthPercent > 50 && this.personality.getTraits().aggressiveness > 0.3) {
      intents.push({
        actionType: "attack_entity",
        priority: PRIORITY_COOPERATION,
        reason: "Assisting in combat",
        requireLLM: this.config.llmValidationForRisky,
      });
    }

    return intents;
  }

  private evaluateEfficiency(
    state: BotState,
    ctx: DecisionContext,
  ): ProactiveIntent[] {
    const intents: ProactiveIntent[] = [];

    // No held item — collect something useful
    if (!state.heldItem && this.personality.getTraits().independence > 0.4) {
      intents.push({
        actionType: "collect_nearby_items",
        priority: PRIORITY_EFFICIENCY,
        reason: "Hands empty — collecting nearby items",
        requireLLM: false,
      });
    }

    // Place torches in dark areas (heuristic: player nearby, not in water)
    if (ctx.playerNearby && !state.isInWater && ctx.healthPercent > 30) {
      intents.push({
        actionType: "place_torch",
        priority: PRIORITY_EFFICIENCY,
        reason: "Lighting up the area",
        requireLLM: false,
      });
    }

    return intents;
  }

  private evaluateSupport(
    state: BotState,
    ctx: DecisionContext,
  ): ProactiveIntent[] {
    const intents: ProactiveIntent[] = [];

    // Long idle — suggest being useful
    if (ctx.idleTimeMs > 60_000 && ctx.playerNearby) {
      intents.push({
        actionType: "speak_chat",
        priority: PRIORITY_SUPPORT,
        reason: "Been idle too long — checking in",
        target: { text: "What should we do next?" },
        requireLLM: false,
      });
    }

    // Look at player occasionally
    if (ctx.playerNearby && this.personality.getTraits().sociability > 0.4) {
      intents.push({
        actionType: "look_at_player",
        priority: PRIORITY_SUPPORT,
        reason: "Making eye contact with player",
        requireLLM: false,
      });
    }

    return intents;
  }

  // ─── Context Builder ───────────────────────────────

  private buildContext(
    state: BotState,
    events: GameEvent[],
    nearbyEntities: string[],
  ): DecisionContext {
    const hostileKeywords = ["zombie", "skeleton", "creeper", "spider", "witch", "hoglin", "piglin_brute", "enderman", "warden", "blaze", "ghast"];
    const nearbyHostiles = nearbyEntities.filter((e) =>
      hostileKeywords.some((h) => e.toLowerCase().includes(h)),
    ).length;

    const playerNearby = nearbyEntities.some(
      (e) => !hostileKeywords.some((h) => e.toLowerCase().includes(h)) && e.includes("("),
    );

    return {
      healthPercent: (state.health / 20) * 100,
      nearbyHostiles,
      playerNearby,
      idleTimeMs: Date.now() - this.lastActionTime,
      recentFailures: events.filter((e) =>
        e.type === "action_failed" && Date.now() - e.timestamp < 60_000,
      ).length,
    };
  }

  // ─── Manual Trigger ────────────────────────────────

  /**
   * Manually force a proactive intent (used by emergency signals).
   */
  forceIntent(intent: ProactiveIntent): void {
    this.emit("intent", intent);
    this.lastActionTime = Date.now();
  }
}

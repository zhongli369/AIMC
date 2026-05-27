/**
 * AgentCore — bridges DeepSeek V4 Pro → RuntimeCore → SkillRouter (Phase 2.5).
 *
 * Orchestrates the full "perceive → reason → validate → execute" cycle:
 *   ContextAssembler → DeepSeekV4Pro → RuntimeCore.validate() → SkillRouter.route() → ActionDispatcher
 *
 * Single Execution Chain:
 *   AgentCore → SkillRouter (sole entry) → ActionDispatcher (sole executor) → Mineflayer
 *
 * Features: dedup, debounce, cancellation, backpressure.
 */
import type { BotState } from "../interfaces/minecraft.js";
import type { AgentOutput, IntentAction, ExecutionResult } from "../interfaces/intent.js";
import type { ValidationResult } from "../runtime/runtime-core.js";
import { ContextAssembler, type ChatEntry } from "../llm/context-assembler.js";
import { DeepSeekV4Pro, type DeepSeekConfig, FALLBACK_IDLE_OUTPUT } from "../llm/deepseek-v4-pro.js";
import { RuntimeCore } from "../runtime/runtime-core.js";
import type { GameEvent } from "../interfaces/event.js";
import { eventBus } from "../runtime/event-bus.js";
import { logger } from "../runtime/logger.js";
import type { SQLiteMemoryStore } from "../memory/sqlite-store.js";
import type { MemoryRetriever } from "../memory/retriever.js";
import { ImportanceEngine } from "../memory/importance.js";
import type { PersonalityEngine, DecisionContext } from "../personality/personality-engine.js";
import type { EmotionEngine } from "../personality/emotion-engine.js";
import type { SocialEngine } from "../personality/social-engine.js";
import type { ProactiveEngine, ProactiveIntent } from "../behavior/proactive-engine.js";
import type { TaskPlanner } from "../behavior/task-planner.js";
import { HeuristicEngine, type NearbyInfo } from "../heuristics/index.js";
import { SkillRouter, type SkillContext } from "../skill/index.js";
import { VoiceIntentAnalyzer } from "../voice/voice-intent-analyzer.js";
import { createNeutralSignal, type VoicePressureSignal } from "../voice/voice-pressure.js";
import { TacticalAnalyzer } from "../team/tactical-analyzer.js";
import { SupportBehaviors } from "../team/support-behaviors.js";
import { buildTeamState, type TeamState } from "../team/team-state.js";
import { RoleAdaptationEngine } from "../role/role-adaptation.js";
import { getRoleProfile, type CompanionRole } from "../role/role-identity.js";
import { RelationshipEngine, type RelationshipState } from "../memory/relationship-state.js";
import { SharedExperienceTimeline } from "../memory/shared-experience.js";
import { MemoryCallbackGenerator } from "../memory/memory-callbacks.js";
import {
  BehaviorArbitrator,
  type ArbitrationInput,
  type ArbitrationResult,
  type MemoryUrgencySignal,
  type CooperativeStateSignal,
} from "../behavior/arbitration/behavior-arbitrator.js";
import { IntentPredictor, type PredictedIntent, type PredictionContext } from "../team/intent-prediction.js";
import { ProactiveSupportEngine } from "../team/proactive-support.js";
import {
  StabilityMonitor,
  type StabilityState,
  type ProgressType,
} from "../behavior/stability/stuck-detector.js";
import { RuntimeTraceRecorder } from "../observability/runtime-trace.js";
import { BehaviorTimeline } from "../observability/behavior-timeline.js";
import { getEventCollector } from "../observability/event-collector.js";
import { SystemHealthTracker } from "../observability/system-health.js";

// ─── Config ──────────────────────────────────────────

export interface AgentCoreConfig {
  /** Minimum ms between think cycles */
  debounceMs: number;
  /** DeepSeek API configuration */
  deepseek: DeepSeekConfig;
  /** Max concurrent think cycles (1 = no overlap) */
  maxConcurrent: number;
  /** Whether to emit events for every think cycle */
  verboseEvents: boolean;
}

const DEFAULT_AGENT_CONFIG: Partial<AgentCoreConfig> = {
  debounceMs: 500,
  maxConcurrent: 1,
  verboseEvents: false,
};

// ─── Think Result ────────────────────────────────────

export interface ThinkResult {
  /** Whether the think cycle produced any output */
  completed: boolean;
  /** The LLM output (if valid) */
  agentOutput?: AgentOutput;
  /** Results from SkillRouter execution */
  executionResults: ExecutionResult[];
  /** Validation result summary */
  validation: ValidationResult | null;
  /** Latency breakdown */
  timing: {
    contextMs: number;
    llmMs: number;
    validationMs: number;
    executionMs: number;
    totalMs: number;
  };
  /** Whether this was a fallback (LLM failed) */
  fallback: boolean;
}

// ─── Agent State ─────────────────────────────────────

export type AgentState = "idle" | "thinking" | "executing" | "error";

// ─── AgentCore ───────────────────────────────────────

export class AgentCore {
  private config: AgentCoreConfig;
  private deepseek: DeepSeekV4Pro;
  private assembler: ContextAssembler;
  private runtimeCore: RuntimeCore;
  private state: AgentState = "idle";
  private lastThinkTime = 0;
  private activeRequest: AbortController | null = null;
  private pendingThink: (() => void) | null = null;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private heuristicEngine: HeuristicEngine | null = null;

  // Phase 5: Memory system
  private memoryStore: SQLiteMemoryStore | null = null;
  private memoryRetriever: MemoryRetriever | null = null;
  private importanceEngine: ImportanceEngine = new ImportanceEngine();

  // Phase 6: Personality + Proactive system
  private personalityEngine: PersonalityEngine | null = null;
  private emotionEngine: EmotionEngine | null = null;
  private socialEngine: SocialEngine | null = null;
  private proactiveEngine: ProactiveEngine | null = null;
  private taskPlanner: TaskPlanner | null = null;
  private proactiveTimer: ReturnType<typeof setInterval> | null = null;
  private proactiveRunning = false;
  private proactiveIntervalMs = 5000;
  // Phase 5B: user interaction tracking for proactive gating
  private lastUserInteraction = 0;

  // Phase 2.5: SkillRouter — REQUIRED for execution
  private skillRouter: SkillRouter | null = null;

  constructor(
    runtimeCore: RuntimeCore,
    deepseekConfig: DeepSeekConfig,
    config?: Partial<AgentCoreConfig>,
  ) {
    this.config = { ...DEFAULT_AGENT_CONFIG, ...config } as AgentCoreConfig;
    this.runtimeCore = runtimeCore;
    this.deepseek = new DeepSeekV4Pro(deepseekConfig);
    this.assembler = new ContextAssembler();
  }

  /** Wire Phase 5 memory backend into the agent. */
  setMemoryBackend(store: SQLiteMemoryStore, retriever: MemoryRetriever): void {
    this.memoryStore = store;
    this.memoryRetriever = retriever;
    console.log("[AgentCore] Memory backend wired — retrieval + storage active");
  }

  /** Wire Phase 6 personality + proactive systems. */
  setPersonalityBackend(params: {
    personality: PersonalityEngine;
    emotion: EmotionEngine;
    social: SocialEngine;
    proactive: ProactiveEngine;
    tasks: TaskPlanner;
  }): void {
    this.personalityEngine = params.personality;
    this.emotionEngine = params.emotion;
    this.socialEngine = params.social;
    this.proactiveEngine = params.proactive;
    this.taskPlanner = params.tasks;
    console.log("[AgentCore] Personality+Proactive backend wired — autonomous teammate active");
  }

  /** Wire heuristic engine — enables non-LLM fast path for survival actions. */
  setHeuristicEngine(engine: HeuristicEngine): void {
    this.heuristicEngine = engine;
  }

  /** Wire role adaptation engine — enables role-specialized behavior (Phase 4-D). */
  setRoleBackend(adaptation: RoleAdaptationEngine): void {
    this.roleAdaptation = adaptation;
    console.log(`[AgentCore] Role backend wired — current role: ${adaptation.getIdentity().currentRole}`);
  }

  getRoleAdaptation(): RoleAdaptationEngine | null {
    return this.roleAdaptation;
  }

  /** Wire relationship + shared experience backends (Phase 4-E). */
  setRelationshipBackend(params: {
    relationship: RelationshipEngine;
    experiences: SharedExperienceTimeline;
    language?: "zh" | "en";
  }): void {
    this.relationshipEngine = params.relationship;
    this.sharedExperiences = params.experiences;
    if (params.language) {
      this.callbackGenerator.setLanguage(params.language);
    }
    const snap = params.relationship.getSnapshot();
    console.log(`[AgentCore] Relationship backend wired — ${snap.style}, familiarity ${snap.familiarity}/100`);
  }

  getRelationshipEngine(): RelationshipEngine | null {
    return this.relationshipEngine;
  }

  getSharedExperiences(): SharedExperienceTimeline | null {
    return this.sharedExperiences;
  }

  getCallbackGenerator(): MemoryCallbackGenerator {
    return this.callbackGenerator;
  }

  /** Wire behavior arbitration backend (Phase 4-G). */
  setArbitrationBackend(params?: {
    arbitrator?: BehaviorArbitrator;
    intentPredictor?: IntentPredictor;
    proactiveSupport?: ProactiveSupportEngine;
  }): void {
    if (params?.arbitrator) this.behaviorArbitrator = params.arbitrator;
    if (params?.intentPredictor) this.intentPredictor = params.intentPredictor;
    if (params?.proactiveSupport) this.proactiveSupport = params.proactiveSupport;
    console.log("[AgentCore] Arbitration backend wired — real-time behavior arbitration active");
  }

  getArbitrator(): BehaviorArbitrator {
    return this.behaviorArbitrator;
  }

  getIntentPredictor(): IntentPredictor {
    return this.intentPredictor;
  }

  getProactiveSupport(): ProactiveSupportEngine {
    return this.proactiveSupport;
  }

  /** Wire Phase 6 observability backends (trace recorder + timeline). */
  setObservabilityBackend(params: {
    traceRecorder: RuntimeTraceRecorder;
    timeline: BehaviorTimeline;
  }): void {
    this.traceRecorder = params.traceRecorder;
    this.timeline = params.timeline;
    console.log("[AgentCore] Observability backends wired — trace recording active");
  }

  getTraceRecorder(): RuntimeTraceRecorder | null {
    return this.traceRecorder;
  }

  getBehaviorTimeline(): BehaviorTimeline | null {
    return this.timeline;
  }

  getHealthTracker(): SystemHealthTracker {
    return this.healthTracker;
  }

  /**
   * Wire skill system — REQUIRED for execution.
   * Without SkillRouter, validated intents will NOT be dispatched.
   */
  setSkillRouter(router: SkillRouter): void {
    this.skillRouter = router;
    console.log("[AgentCore] SkillRouter wired — sole execution entry active");
  }

  getSkillRouter(): SkillRouter | null {
    return this.skillRouter;
  }

  /** Start the proactive behavior loop. */
  startProactiveLoop(intervalMs: number = 5000): void {
    if (this.proactiveTimer) return;
    this.proactiveIntervalMs = intervalMs;
    this.proactiveTimer = setInterval(() => this.proactiveTick(), intervalMs);
    console.log(`[AgentCore] Proactive loop started — ${intervalMs}ms interval`);
  }

  /** Stop the proactive behavior loop. */
  stopProactiveLoop(): void {
    if (this.proactiveTimer) {
      clearInterval(this.proactiveTimer);
      this.proactiveTimer = null;
    }
  }

  // ─── Phase 5: Stability Watchdog ────────────────────

  /** Start the stability watchdog loop. */
  startWatchdog(intervalMs: number = 2000): void {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(() => this.stabilityTick(), intervalMs);
    console.log(`[AgentCore] Stability watchdog started — ${intervalMs}ms interval`);
  }

  /** Stop the stability watchdog loop. */
  stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  /**
   * Periodic stability evaluation tick.
   *
   * Checks for stuck state, loop detection, and safe mode transitions.
   * Recovery flows through the normal think() pipeline — NO new execution path.
   */
  private async stabilityTick(): Promise<void> {
    const state = this.stabilityMonitor.evaluate();

    // Record recovery if previously stuck and now in a think cycle
    // (progress is recorded by think() after successful execution)

    // Emit trace on safe mode transitions (tracked by evaluate())
    if (state.isSafeMode && this.skillRouter) {
      this.skillRouter.emitStabilityTrace({
        event: "safe_mode_enter",
        reason: state.isStuck
          ? `Stuck for ${state.stuckDurationMs}ms`
          : "Loop detected with recent failures",
      });
    }

    // If stuck, force a recovery replan
    if (state.isStuck && !this.isBusy()) {
      const recoveryAction = this.stabilityMonitor.detector.getRecoveryAction();
      console.log(`[AgentCore] STUCK DETECTED — ${state.stuckDurationMs}ms without progress. Recovery: ${recoveryAction}`);

      if (this.skillRouter) {
        this.skillRouter.emitStabilityTrace({
          event: "stuck_detected",
          stuckDurationMs: state.stuckDurationMs,
          reason: `Forcing recovery: ${recoveryAction}`,
        });
      }

      // Force recovery through the normal think() pipeline
      await this.think({
        botState: null,
        chatMessage: {
          source: "stability_watchdog",
          message: `[RECOVERY] System stuck. Execute fallback: ${recoveryAction}.`,
        },
      });

      this.stabilityMonitor.detector.reset();
    }
  }

  /** Record a progress event after successful execution. */
  recordProgress(type: ProgressType, detail?: string): void {
    this.stabilityMonitor.detector.recordProgress(type, detail);
  }

  /** Get current stability state (read-only diagnostic). */
  getStabilityState(): StabilityState {
    return this.stabilityMonitor.evaluate();
  }

  /** Get stability monitor for external telemetry. */
  getStabilityMonitor(): StabilityMonitor {
    return this.stabilityMonitor;
  }

  // ─── Phase 4-G: Arbitration Signal Collection ────────

  /**
   * Collect all subsystem signals into a single ArbitrationInput.
   * Called AFTER RuntimeCore.validate() and BEFORE SkillRouter.route().
   */
  private collectArbitrationSignals(params: {
    proposedActions: import("../interfaces/intent.js").IntentAction[];
    agentIntent?: string;
    botState: import("../interfaces/minecraft.js").BotState | null;
    predictionContext?: PredictionContext;
  }): ArbitrationInput {
    const { proposedActions, agentIntent, botState } = params;

    // ── Tactical signal (4-C) ──────────────────────────
    const tacticalResult = this.lastTeamState
      ? this.tacticalAnalyzer.analyze(this.lastTeamState)
      : { recommendation: "none" as const, opportunities: [] };

    // ── Role signal (4-D) ──────────────────────────────
    const roleWeights = this.roleAdaptation
      ? this.roleAdaptation.getSkillWeights()
      : {};
    const companionRole = this.roleAdaptation
      ? this.roleAdaptation.getIdentity().currentRole
      : "balanced";

    // ── Relationship signal (4-E) ──────────────────────
    const relationshipSnapshot = this.relationshipEngine
      ? this.relationshipEngine.getSnapshot()
      : null;

    // ── Voice pressure signal (4-A/B) ──────────────────
    const voicePressure = this.lastVoicePressure;

    // ── Cooperative state (4-F) ────────────────────────
    const predictionContext = params.predictionContext || {
      recentActions: [],
      nearbyBlocks: [],
      nearbyEntities: [],
      teamState: this.lastTeamState,
      voicePressure: voicePressure.level,
      familiarityLevel: relationshipSnapshot?.familiarity ?? 0,
      playerHealth: undefined,
      playerHunger: undefined,
    };
    const prediction = this.intentPredictor.predict(predictionContext);
    const supportPriority = this.intentPredictor.getSupportPriority(prediction, predictionContext);

    const cooperativeState: CooperativeStateSignal = {
      predictedIntent: prediction.intentType,
      predictionConfidence: prediction.confidence,
      supportOpportunity: prediction.supportOpportunity,
      supportPriority,
    };

    // ── Memory urgency (4-E) ────────────────────────────
    const memoryUrgency = this.buildMemoryUrgency();

    return {
      proposedActions,
      agentIntent,
      tacticalRecommendation: tacticalResult.recommendation,
      roleSkillWeights: roleWeights,
      companionRole,
      relationshipSnapshot,
      voicePressure,
      cooperativeState,
      memoryUrgency,
      botHealth: botState?.health ?? 20,
      playerHealth: undefined, // populated externally if available
    };
  }

  /**
   * Derive memory urgency from shared experiences.
   *
   * Scans recent experiences for danger-related memories
   * (combat deaths, near-death, lava/void incidents).
   */
  private buildMemoryUrgency(): MemoryUrgencySignal | null {
    if (!this.sharedExperiences) return null;

    const recent = this.sharedExperiences.getRelevantMemories({
      keywords: ["death", "lava", "void", "creeper", "ambush", "died", "danger", "escape", "rescue"],
      limit: 8,
    });

    if (recent.length === 0) return null;

    // Check for emergency-level memories
    const emergencyMemories = recent.filter((exp) => {
      const lower = (exp.summary || "").toLowerCase();
      return (
        exp.category === "failure" ||
        exp.category === "combat" ||
        /died|death|lava|void|almost died|killed/.test(lower)
      );
    });

    const veryRecent = emergencyMemories.filter(
      (exp) => Date.now() - exp.timestamp < 60_000, // within last minute
    );

    let level: MemoryUrgencySignal["level"] = "none";
    let urgencyScore = 0;

    if (veryRecent.length > 0) {
      level = "emergency";
      urgencyScore = 0.9;
    } else if (emergencyMemories.length >= 2) {
      level = "high";
      urgencyScore = 0.7;
    } else if (emergencyMemories.length === 1) {
      level = "medium";
      urgencyScore = 0.5;
    } else if (recent.some((exp) => exp.category === "combat" || exp.category === "rescue")) {
      level = "low";
      urgencyScore = 0.3;
    }

    if (level === "none") return null;

    const triggeredMemories = recent.slice(0, 5).map((exp) => exp.summary || exp.category);

    let suggestedAction: string | undefined;
    if (/lava/.test(triggeredMemories.join(" "))) suggestedAction = "go_to_surface";
    else if (/died|death|killed/.test(triggeredMemories.join(" "))) suggestedAction = "flee";
    else if (/creeper/.test(triggeredMemories.join(" "))) suggestedAction = "flee";
    else if (/ambush/.test(triggeredMemories.join(" "))) suggestedAction = "defend_self";

    return { level, triggeredMemories, suggestedAction, urgencyScore };
  }

  /**
   * Apply behavior arbitration to a validated AgentOutput.
   *
   * Collects all subsystem signals, runs the arbitrator, emits the trace,
   * and returns a new AgentOutput with the arbitrated action list.
   *
   * If the arbitrator has no opinion (no rules triggered, no conflicts),
   * the original output is returned unchanged.
   */
  private async applyArbitration(
    output: import("../interfaces/intent.js").AgentOutput,
    botState: import("../interfaces/minecraft.js").BotState | null,
  ): Promise<import("../interfaces/intent.js").AgentOutput> {
    if (output.actions.length === 0) return output;

    const input = this.collectArbitrationSignals({
      proposedActions: output.actions,
      agentIntent: output.intent,
      botState,
    });

    const result = this.behaviorArbitrator.evaluate(input);

    // Emit arbitration trace for observability
    if (this.skillRouter) {
      this.skillRouter.emitArbitrationTrace({
        signalWeights: {
          tactical: result.signalWeights.tacticalWeight,
          role: result.signalWeights.roleWeight,
          relationship: result.signalWeights.relationshipWeight,
          memory: result.signalWeights.memoryWeight,
          voice: result.signalWeights.voiceWeight,
          cooperative: result.signalWeights.cooperativeWeight,
          finalScore: result.signalWeights.finalScore,
        },
        primaryAction: result.primaryAction?.type ?? null,
        suppressedCount: result.suppressedActions.length,
        appliedRule: result.appliedRule,
        reasonChain: result.reasonChain,
        tacticalRecommendation: input.tacticalRecommendation,
        voiceLevel: input.voicePressure.level,
        companionRole: input.companionRole,
      });
    }

    // Return output with arbitrated actions
    return { ...output, actions: result.rankedActions };
  }

  // ─── Skill Context Builder ─────────────────────────

  private buildSkillContext(botState: BotState | null): SkillContext {
    return {
      botState: botState || null,
      nearbyEntities: (globalThis as any).__WORLD_STATE__?.getNearbyEntities?.() || [],
      nearbyPlayers: (globalThis as any).__WORLD_STATE__?.getNearbyPlayers?.() || [],
      nearbyHostiles: (globalThis as any).__WORLD_STATE__?.getNearbyHostiles?.() || [],
    };
  }

  // ─── Execute validated output through SkillRouter ───

  /**
   * Route validated AgentOutput through SkillRouter for execution.
   * This is the ONLY path from AI decision to Minecraft action.
   */
  private async executeViaSkillRouter(
    output: AgentOutput,
    botState: BotState | null,
  ): Promise<ExecutionResult[]> {
    if (!this.skillRouter) {
      console.warn("[AgentCore] No SkillRouter bound — actions will NOT be executed");
      return [];
    }

    const skillCtx = this.buildSkillContext(botState);

    try {
      const routeResult = await this.skillRouter.route(output, skillCtx);

      // If this was a plan, sync with TaskPlanner
      if (output.intent === "plan" && routeResult.planResult && this.taskPlanner) {
        const plan = output.plan!;
        const tasks = this.taskPlanner.createFromPlan(plan);
        console.log(`[AgentCore] Plan "${plan.goal}" → ${plan.steps.length} tasks created`);

        // Sync step-level execution results back to each task (Phase 3-A)
        if (routeResult.planResult.stepStatuses) {
          for (let i = 0; i < tasks.length && i < routeResult.planResult.stepStatuses.length; i++) {
            this.taskPlanner.syncFromPlanExecution(tasks[i].id, [routeResult.planResult.stepStatuses[i]]);
          }
        }

        if (!routeResult.planResult.completed) {
          console.log(`[AgentCore] Plan progress: ${routeResult.planResult.stepsCompleted}/${routeResult.planResult.stepsTotal}`);
        }
      }

      return routeResult.results;
    } catch (err) {
      console.warn("[AgentCore] SkillRouter execution failed:", (err as Error).message);
      return [];
    }
  }

  // ─── Main Think Cycle ──────────────────────────────

  /**
   * Execute a full think cycle:
   *   context → LLM → RuntimeCore.validate() → SkillRouter.route() → ActionDispatcher
   *
   * This is the PRIMARY entry point for triggering the agent.
   */
  async think(params: {
    botState: BotState | null;
    chatMessage?: { source: string; message: string };
    recentEvents?: GameEvent[];
    chatHistory?: ChatEntry[];
    nearbyEntities?: string[];
  }): Promise<ThinkResult> {
    const totalStart = Date.now();
    const timing = { contextMs: 0, llmMs: 0, validationMs: 0, executionMs: 0, totalMs: 0 };

    // ── Dedup/Debounce ────────────────────────────
    const now = Date.now();
    const elapsed = now - this.lastThinkTime;

    if (this.state === "thinking" || this.state === "executing") {
      this.cancelActiveRequest();

      if (elapsed < this.config.debounceMs) {
        if (this._debounceTimer) clearTimeout(this._debounceTimer);
        await new Promise<void>((r) => {
          this.pendingThink = r;
          this._debounceTimer = setTimeout(() => {
            this.pendingThink?.();
            this.pendingThink = null;
            this._debounceTimer = null;
          }, this.config.debounceMs - elapsed);
        });
      }
    }

    this.state = "thinking";
    this.lastThinkTime = Date.now();
    this.activeRequest = new AbortController();

    // Phase 6: Start trace session (non-blocking, never-throws)
    let traceSessionId: string | null = null;
    if (this.traceRecorder) {
      try {
        traceSessionId = this.traceRecorder.startSession(
          params.chatMessage?.message
            ? `think:${params.chatMessage.source}:${params.chatMessage.message.slice(0, 40)}`
            : "think:proactive_tick",
        );
      } catch { /* observability must never throw */ }
    }

    try {
      // ═══ PERCEIVE: Build context ═══
      const contextStart = Date.now();

      const events = params.recentEvents || eventBus.getRecentEvents(30000, 20);
      const chatHistory = params.chatHistory || [];
      if (params.chatMessage) {
        chatHistory.push({
          source: params.chatMessage.source,
          message: params.chatMessage.message,
          timestamp: Date.now(),
        });
      }

      // Phase 5: Memory retrieval
      let memorySnapshots: string[] | undefined;
      if (this.memoryStore && this.memoryRetriever) {
        try {
          const queryText = params.chatMessage?.message
            || events.slice(0, 3).map((e) => `${e.category}:${e.type}`).join(" ");
          const retrieval = await this.memoryRetriever.retrieve({
            store: this.memoryStore,
            queryText,
            currentLocation: params.botState?.position
              ? { x: params.botState.position.x, y: params.botState.position.y, z: params.botState.position.z }
              : undefined,
            limit: 5,
          });
          if (retrieval.contextText) {
            memorySnapshots = [retrieval.contextText];
          }
        } catch (err) {
          console.warn("[AgentCore] Memory retrieval failed:", (err as Error).message);
        }
      }

      const assembled = this.assembler.build({
        botState: params.botState,
        recentEvents: events,
        chatHistory,
        nearbyEntities: params.nearbyEntities,
        memorySnapshots,
      });

      // Phase 6: Inject personality-driven behavior hints
      if (this.personalityEngine && this.emotionEngine) {
        const decisionCtx: DecisionContext = {
          healthPercent: params.botState ? (params.botState.health / 20) * 100 : 100,
          nearbyHostiles: params.nearbyEntities?.filter((e) =>
            /zombie|skeleton|creeper|spider|witch/i.test(e),
          ).length || 0,
          playerNearby: params.nearbyEntities?.some((e) => /\(\d+m\)/.test(e)) || false,
          idleTimeMs: Date.now() - this.lastThinkTime,
          recentFailures: 0,
        };
        const hints = this.personalityEngine.getBehaviorHints(decisionCtx);
        if (hints.length > 0) {
          assembled.messages.push({
            role: "system",
            content: `[BEHAVIOR HINTS]\n${hints.join("\n")}`,
          });
        }
      }

      // Phase 4-C: Inject team awareness into context
      const teamState = this.buildTeamState(params.botState, params.nearbyEntities || []);
      this.lastTeamState = teamState;
      if (teamState.nearbyPlayers.length > 0 || teamState.activeThreats.length > 0) {
        const tactical = this.tacticalAnalyzer.analyze(teamState);
        const teamContext = this.formatTeamContext(teamState, tactical.recommendation);
        assembled.messages.push({
          role: "system",
          content: teamContext,
        });
        // Set tactical bias on SkillRouter before execution
        if (this.skillRouter) {
          const bias = this.tacticalAnalyzer.getSkillBias(tactical.recommendation);
          this.skillRouter.setTacticalBias(bias, tactical.recommendation);
        }
      }

      // Phase 4-D: Inject role identity context
      if (this.roleAdaptation) {
        const identity = this.roleAdaptation.getIdentity();
        const profile = getRoleProfile(identity.currentRole);
        const traits = identity.dominantTraits.slice(0, 3).map((t) => t.trait).join(", ");
        assembled.messages.push({
          role: "system",
          content: [
            "[ROLE CONTEXT]",
            `Role: ${profile.label} — ${profile.description}`,
            `Confidence: ${(identity.confidence * 100).toFixed(0)}%`,
            `Style: ${profile.voiceStyle}, ${profile.confidenceStyle}`,
            `Prefer: ${profile.preferredSkills.join(", ") || "adaptable"}`,
            `Avoid: ${profile.avoidedSkills.join(", ") || "nothing"}`,
            profile.retryBias > 0 ? `Retry bias: +${profile.retryBias} extra attempts on preferred skills` : null,
            traits ? `Dominant traits: ${traits}` : null,
            "Stay in character for your role. Use role-appropriate judgment.",
          ].filter(Boolean).join("\n"),
        });

        // Apply role-aware tactical bias on SkillRouter
        if (this.skillRouter && this.lastTeamState) {
          const tactical = this.tacticalAnalyzer.analyze(this.lastTeamState);
          const roleBias = this.tacticalAnalyzer.getRoleAwareSkillBias(
            tactical.recommendation,
            identity.currentRole,
          );
          this.skillRouter.setTacticalBias(roleBias, tactical.recommendation);
        }
      }

      // Phase 4-E: Inject relationship & shared experience context
      if (this.relationshipEngine && this.sharedExperiences) {
        const snap = this.relationshipEngine.getSnapshot();
        const recentHistory = this.sharedExperiences.summarizeRecentHistory(3);
        const relContext = [
          "[RELATIONSHIP CONTEXT]",
          snap.promptSafe,
          `Interaction warmth: ${(this.relationshipEngine.getWarmthFactor() * 100).toFixed(0)}%`,
          recentHistory ? `Recent shared experiences:\n${recentHistory}` : null,
          snap.familiarity < 25
            ? "You are still getting to know this player. Be helpful but respectful."
            : snap.familiarity < 60
              ? "You have a growing friendship. Be supportive and recall shared experiences."
              : "You are a trusted long-term companion. Be natural, reference past adventures, show warmth.",
        ].filter(Boolean).join("\n");
        assembled.messages.push({
          role: "system",
          content: relContext,
        });
      }

      // Phase 5: Inject safe mode constraint hints (passive — restricts, never enhances)
      if (this.stabilityMonitor.safeMode.isSafeMode) {
        const safeHints = this.stabilityMonitor.safeMode.getSafeModeHints();
        if (safeHints) {
          assembled.messages.push({
            role: "system",
            content: safeHints,
          });
        }
      }

      // Phase 6: Inject active task context
      if (this.taskPlanner) {
        const activeTask = this.taskPlanner.getActiveTask();
        if (activeTask) {
          const step = activeTask.steps[activeTask.currentStep] || "complete task";
          assembled.messages.push({
            role: "system",
            content: `[ACTIVE TASK] ${activeTask.description}\nCurrent step: ${step} (${activeTask.currentStep + 1}/${activeTask.steps.length})`,
          });
        }
      }

      timing.contextMs = Date.now() - contextStart;

      // Phase 6: Record context-assembled trace event
      if (this.traceRecorder) {
        try {
          this.traceRecorder.recordEvent({
            stage: "agent_core_input",
            label: "context_assembled",
            elapsedMs: timing.contextMs,
            input: {
              botHealth: params.botState?.health,
              chatSource: params.chatMessage?.source,
              messageLength: params.chatMessage?.message?.length ?? 0,
              eventCount: events.length,
              memoryAvailable: !!memorySnapshots,
            },
          });
        } catch { /* never throw */ }
      }

      // ═══ HEURISTIC FAST PATH: survival actions skip LLM ═══
      if (this.heuristicEngine && params.botState) {
        const nearby = this.classifyNearby(params.nearbyEntities || []);
        const heuristicResult = this.heuristicEngine.evaluate({
          botState: params.botState,
          nearby,
        });
        if (heuristicResult?.decided && heuristicResult.category === "survival" && heuristicResult.output) {
          timing.llmMs = 0;

          // Phase 6: Record heuristic fast-path trace
          if (this.traceRecorder) {
            try {
              this.traceRecorder.recordEvent({
                stage: "agent_core_output",
                label: "heuristic_fast_path",
                output: { intent: heuristicResult.output.intent, category: heuristicResult.category },
              });
            } catch { /* never throw */ }
          }

          // Validate through RuntimeCore
          const execStart = Date.now();
          const validation = this.runtimeCore.validate(heuristicResult.output);
          timing.validationMs = Date.now() - execStart;

          let executionResults: ExecutionResult[] = [];
          if (validation.output) {
            // Phase 4-G: Arbitrate before SkillRouter
            const arbitratedOutput = await this.applyArbitration(validation.output, params.botState);
            executionResults = await this.executeViaSkillRouter(arbitratedOutput, params.botState);
          }
          timing.executionMs = Date.now() - execStart - timing.validationMs;
          timing.totalMs = Date.now() - totalStart;
          this.state = "idle";
          return {
            completed: true,
            agentOutput: heuristicResult.output,
            executionResults,
            validation,
            timing,
            fallback: false,
          };
        }
      }

      // ═══ REASON: Call LLM ═══
      const llmStart = Date.now();

      // Phase 6: Record LLM call start
      if (this.traceRecorder) {
        try {
          this.traceRecorder.recordEvent({
            stage: "agent_core_output",
            label: "llm_call_start",
            input: { messageCount: assembled.messages.length },
          });
        } catch { /* never throw */ }
      }

      const llmResult = await this.deepseek.generate(
        assembled.messages,
        { signal: this.activeRequest.signal },
      );

      timing.llmMs = Date.now() - llmStart;

      // Phase 6: Record LLM call end
      if (this.traceRecorder) {
        try {
          this.traceRecorder.recordEvent({
            stage: "agent_core_output",
            label: "llm_call_end",
            elapsedMs: timing.llmMs,
            output: {
              success: llmResult.success,
              hasOutput: !!llmResult.output,
              intent: (llmResult.output as any)?.intent,
              timedOut: llmResult.timedOut,
            },
          });
        } catch { /* never throw */ }
      }

      if (!llmResult.success || !llmResult.output) {
        timing.totalMs = Date.now() - totalStart;
        this.state = "idle";
        logger.actionFailed(
          { id: "llm-fail", type: "__think_cycle__" as any, target: {}, priority: 1 as const, reason: "LLM failure" },
          { actionId: "llm-fail", success: false, message: llmResult.error || "LLM failed", interrupted: false, timedOut: llmResult.timedOut },
          timing.llmMs,
        );

        return {
          completed: false,
          executionResults: [],
          validation: null,
          timing,
          fallback: true,
        };
      }

      // ═══ VALIDATE: Schema + Safety (NO execution) ═══
      const validationStart = Date.now();
      const validation = this.runtimeCore.validate(llmResult.output);
      timing.validationMs = Date.now() - validationStart;

      // Phase 6: Record validation trace
      if (this.traceRecorder) {
        try {
          this.traceRecorder.recordEvent({
            stage: "runtime_validate",
            label: validation.success ? "validation_pass" : "validation_fail",
            elapsedMs: timing.validationMs,
            input: { intent: (llmResult.output as any)?.intent },
            output: {
              success: validation.success,
              hasOutput: !!validation.output,
              actionCount: validation.output?.actions?.length ?? 0,
            },
            tags: validation.success ? ["valid"] : ["invalid"],
          });
        } catch { /* never throw */ }
      }

      const agentOutput = llmResult.output as unknown as AgentOutput;

      // Phase 5: Save memory candidates from LLM output
      if (this.memoryStore && validation.memorySave) {
        this.saveMemoryCandidate(validation.memorySave, params.botState).catch((err) => {
          console.warn("[AgentCore] Memory save failed:", (err as Error).message);
        });
      }

      // Emit task update signals
      if (validation.taskUpdate) {
        const update = validation.taskUpdate;
        const eventType = update.action === "fail" ? "task_failed"
          : update.action === "complete" ? "task_completed"
          : "task_started";
        eventBus.emit("agent", eventType, { taskUpdate: update });
      }

      // ═══ ARBITRATE: Resolve conflicting subsystem signals (Phase 4-G) ═══
      const arbStart = Date.now();
      let arbitratedOutput = validation.output;
      if (validation.output && validation.output.actions.length > 0) {
        arbitratedOutput = await this.applyArbitration(validation.output, params.botState);
      }
      const arbitrationMs = Date.now() - arbStart;

      // Phase 6: Record arbitration trace
      if (this.traceRecorder) {
        try {
          this.traceRecorder.recordEvent({
            stage: "arbitration",
            label: "arbitration_complete",
            elapsedMs: arbitrationMs,
            input: { originalActionCount: validation.output?.actions?.length ?? 0 },
            output: { arbitratedActionCount: arbitratedOutput?.actions?.length ?? 0 },
          });
        } catch { /* never throw */ }
      }

      // ═══ EXECUTE: Route through SkillRouter (ONLY path) ═══
      const execStart = Date.now();
      let executionResults: ExecutionResult[] = [];

      if (arbitratedOutput) {
        executionResults = await this.executeViaSkillRouter(arbitratedOutput, params.botState);
      }

      timing.executionMs = Date.now() - execStart;
      timing.totalMs = Date.now() - totalStart;

      // Phase 6: Record SkillRouter execution trace + health metrics
      const execSuccess = executionResults.some((r) => r.success);
      if (this.traceRecorder) {
        try {
          this.traceRecorder.recordEvent({
            stage: "skill_router",
            label: "execution_complete",
            elapsedMs: timing.executionMs,
            output: {
              resultCount: executionResults.length,
              successCount: executionResults.filter((r) => r.success).length,
              overallSuccess: execSuccess,
            },
          });
        } catch { /* never throw */ }
      }

      // Phase 6: Record health tick
      try {
        this.healthTracker.recordTick({
          latencyMs: timing.llmMs + timing.validationMs + timing.executionMs,
        });
        if (executionResults.length > 0) {
          this.healthTracker.recordAction({});
          for (const r of executionResults) {
            this.healthTracker.recordSkill({ success: r.success });
          }
        }
        // Ingest health snapshot into collector (non-blocking)
        const collector = getEventCollector();
        collector.ingestHealthSnapshot(this.healthTracker.compute());
      } catch { /* never throw */ }

      // Phase 5: Record progress on successful execution
      if (executionResults.some((r) => r.success)) {
        this.stabilityMonitor.detector.recordProgress(
          agentOutput?.intent === "skill" ? "skill_success" : "action_success",
          agentOutput?.skill?.name ?? agentOutput?.intent,
        );
        this.stabilityMonitor.recordSuccess();
      } else if (executionResults.length > 0) {
        this.stabilityMonitor.recordFailure();
      }

      this.state = "idle";

      return {
        completed: true,
        agentOutput,
        executionResults,
        validation,
        timing,
        fallback: false,
      };
    } catch (err) {
      timing.totalMs = Date.now() - totalStart;
      this.state = "error";

      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.actionFailed(
        { id: "think-error", type: "__think_cycle__" as any, target: {}, priority: 1 as const, reason: errorMsg },
        { actionId: "think-error", success: false, message: errorMsg, interrupted: false, timedOut: false },
        timing.totalMs,
      );

      return {
        completed: false,
        executionResults: [],
        validation: null,
        timing,
        fallback: true,
      };
    } finally {
      // Phase 6: Close trace session (non-blocking, never-throws)
      if (this.traceRecorder && traceSessionId) {
        try {
          const closed = this.traceRecorder.closeSession();
          if (closed) {
            // Ingest closed session into event collector
            getEventCollector().ingestTraceSession(closed);
          }
        } catch { /* observability must never throw */ }
      }
      this.activeRequest = null;
    }
  }

  // ─── Lifecycle ─────────────────────────────────────

  cancelActiveRequest(): void {
    if (this.activeRequest) {
      this.activeRequest.abort();
      this.activeRequest = null;
    }
    this.deepseek.cancel();
  }

  getState(): AgentState {
    return this.state;
  }

  isBusy(): boolean {
    return this.state === "thinking" || this.state === "executing";
  }

  /** Record a user interaction timestamp — gates proactive ticks (Phase 5B). */
  recordUserInteraction(): void {
    this.lastUserInteraction = Date.now();
  }

  // ─── Phase 6: Proactive Loop ──────────────────────

  /**
   * Periodic proactive evaluation — generates autonomous intents
   * based on personality, emotion, and current game state.
   * ALL proactive actions route through RuntimeCore.validate() → SkillRouter.route().
   *
   * Phase 5B skip rules (user interaction always wins):
   *   1. Agent busy thinking/executing → skip
   *   2. Previous proactive tick still running → skip
   *   3. User interaction within last 15s → skip
   */
  private async proactiveTick(): Promise<void> {
    if (!this.proactiveEngine || !this.personalityEngine) return;
    if (this.isBusy()) {
      console.log("[PROACTIVE] skipped reason=agent_busy");
      return;
    }
    if (this.proactiveRunning) {
      console.log("[PROACTIVE] skipped reason=previous_tick_running");
      return;
    }
    const sinceUser = Date.now() - this.lastUserInteraction;
    if (sinceUser < 15000) {
      console.log(`[PROACTIVE] skipped reason=recent_user_interaction since=${sinceUser}ms`);
      return;
    }

    this.proactiveRunning = true;
    try {
      const bridge = (globalThis as any).__aimc__;
      const botState = bridge?.getBotState?.() || null;
      const intents = await this.proactiveEngine.evaluate({
        botState,
        recentEvents: eventBus.getRecentEvents(30000, 10),
        nearbyEntities: bridge?.getNearbyEntities?.() || [],
      });
      if (intents.length === 0) return;

      for (const intent of intents) {
        // Re-check skip conditions between intents
        if (Date.now() - this.lastUserInteraction < 15000) {
          console.log("[PROACTIVE] skipped mid-tick reason=user_interaction_arrived");
          break;
        }
        if (intent.requireLLM) {
          // Proactive LLM calls get a shorter timeout (15s) — no user-visible fallback
          const PROACTIVE_LLM_TIMEOUT_MS = 15000;
          try {
            await Promise.race([
              this.think({
                botState: null,
                chatMessage: {
                  source: "proactive_engine",
                  message: `[PROACTIVE] ${intent.reason}. Suggested action: ${intent.actionType}.`,
                },
              }),
              new Promise<never>((_, reject) => setTimeout(() => {
                reject(new Error(`PROACTIVE_TIMEOUT_${PROACTIVE_LLM_TIMEOUT_MS}ms`));
              }, PROACTIVE_LLM_TIMEOUT_MS)),
            ]);
          } catch (err) {
            if ((err as Error).message?.startsWith("PROACTIVE_TIMEOUT")) {
              console.log(`[PROACTIVE] timeout after ${PROACTIVE_LLM_TIMEOUT_MS}ms — skipped`);
              this.cancelActiveRequest();
            } else {
              console.warn("[PROACTIVE] think failed:", (err as Error).message);
            }
          }
        } else {
          // Build AgentOutput for proactive intent → validate → route
          const output: AgentOutput = {
            intent: "chat",
            actions: [{
              id: `proactive-${Date.now()}`,
              type: intent.actionType as IntentAction["type"],
              target: (intent.target || {}) as IntentAction["target"],
              priority: intent.priority as IntentAction["priority"],
              reason: intent.reason,
            }],
          };

          const validation = this.runtimeCore.validate(output);
          if (validation.output) {
            // Phase 4-G: Arbitrate proactive actions before SkillRouter
            const arbitratedOutput = await this.applyArbitration(validation.output, botState);
            await this.executeViaSkillRouter(arbitratedOutput, botState);
            console.log(`[AgentCore] Proactive: ${intent.actionType} — ${intent.reason}`);
          }
        }
      }
    } catch (err) {
      console.warn("[AgentCore] Proactive tick failed:", (err as Error).message);
    } finally {
      this.proactiveRunning = false;
    }
  }

  // ─── Convenience Methods ───────────────────────────

  /**
   * Quick response: just generate speech, no actions.
   * Lower-latency path for chat-only interactions.
   */
  async quickChat(
    botState: BotState,
    chatHistory: ChatEntry[],
    userMessage: string,
  ): Promise<string | null> {
    const messages = [
      { role: "system" as const, content: "Respond to the player with ONLY a JSON object with a 'speech' field and empty actions array. Be brief. Use AgentOutput schema." },
      { role: "user" as const, content: `Player says: "${userMessage}"\nRespond briefly.` },
    ];

    const result = await this.deepseek.generate(messages);
    return result.output?.speech?.text || null;
  }

  /**
   * Emergency assessment: low-latency call to assess danger level.
   */
  async assessDanger(botState: BotState, recentDamage: GameEvent[]): Promise<"safe" | "caution" | "danger"> {
    if (botState.health < 6) return "danger";
    if (botState.health < 12) return "caution";

    const recentHits = recentDamage.filter(
      (e) => e.type === "damage_taken" && Date.now() - e.timestamp < 5000,
    );
    if (recentHits.length > 3) return "danger";
    if (recentHits.length > 1) return "caution";

    return "safe";
  }

  // ─── Phase 5: Memory Save ──────────────────────────

  private async saveMemoryCandidate(
    raw: unknown,
    botState: BotState | null,
  ): Promise<void> {
    if (!this.memoryStore) return;

    const mc = raw as Record<string, unknown>;

    const candidate = {
      type: (mc.type as any) || "event",
      summary: (mc.summary as string) || "",
      details: (mc.details as string) || (mc.summary as string) || "",
      importance: this.importanceEngine.score({
        type: (mc.type as any) || "event",
        summary: (mc.summary as string) || "",
        details: (mc.details as string) || "",
        importance: (mc.importance as number) || 5,
        emotionalValence: (mc.emotionalValence as number) ?? 0,
        tags: (mc.tags as string[]) || [],
        relatedEntities: [],
        location: botState?.position
          ? { x: botState.position.x, y: botState.position.y, z: botState.position.z }
          : undefined,
      }),
      emotionalValence: (mc.emotionalValence as number) ?? 0,
      tags: (mc.tags as string[]) || [],
      relatedEntities: [],
      location: botState?.position
        ? { x: botState.position.x, y: botState.position.y, z: botState.position.z, dimension: botState.dimension }
        : undefined,
      source: "llm" as const,
    };

    const saved = await this.memoryStore.save(candidate);
    console.log(`[AgentCore] Memory saved: [${saved.type}] ${saved.summary.slice(0, 80)} (importance: ${saved.importance})`);
  }

  // ─── Phase 4-A: Voice Companion Loop ────────────────

  private voiceInputHandler: ((text: string) => Promise<void>) | null = null;
  private voiceOutputEmitter: ((text: string) => void) | null = null;
  private _voiceState = { speaking: false, listening: false, interrupted: false, processing: false };

  // Phase 4-B: Voice Pressure Analyzer
  private voiceIntentAnalyzer: VoiceIntentAnalyzer = new VoiceIntentAnalyzer();
  private lastVoicePressure: VoicePressureSignal = createNeutralSignal();

  // Phase 4-C: Tactical Coordination
  private tacticalAnalyzer: TacticalAnalyzer = new TacticalAnalyzer();
  private supportBehaviors: SupportBehaviors = new SupportBehaviors();
  private lastTeamState: TeamState | null = null;

  // Phase 4-D: Role Specialization
  private roleAdaptation: RoleAdaptationEngine | null = null;

  // Phase 4-E: Relationship & Shared Experience
  private relationshipEngine: RelationshipEngine | null = null;
  private sharedExperiences: SharedExperienceTimeline | null = null;
  private callbackGenerator: MemoryCallbackGenerator = new MemoryCallbackGenerator("zh");

  // Phase 4-G: Behavior Arbitration
  private behaviorArbitrator: BehaviorArbitrator = new BehaviorArbitrator();
  private intentPredictor: IntentPredictor = new IntentPredictor();
  private proactiveSupport: ProactiveSupportEngine = new ProactiveSupportEngine();

  // Phase 5: Stability & Recovery
  private stabilityMonitor: StabilityMonitor = new StabilityMonitor();
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;

  // Phase 6: Observability — trace recording (PURE OBSERVABILITY, zero behavior impact)
  private traceRecorder: RuntimeTraceRecorder | null = null;
  private timeline: BehaviorTimeline | null = null;
  private healthTracker: SystemHealthTracker = new SystemHealthTracker();

  /**
   * Handle voice input from STT adapter.
   * Routes through the EXISTING chat pipeline:
   *   voice text → think({ chatMessage }) → RuntimeCore.validate → SkillRouter → ActionDispatcher
   *
   * This does NOT create a new execution path. It reuses the chat pipeline
   * with source "player_voice".
   */
  async handleVoiceInput(text: string): Promise<ThinkResult | null> {
    if (!text.trim()) return null;

    this._voiceState.listening = false;
    this._voiceState.processing = true;

    // Phase 4-B: Analyze voice pressure from transcript
    const pressure = this.voiceIntentAnalyzer.analyze(text);
    this.lastVoicePressure = pressure;

    // Inject pressure into SkillRouter for timing influence
    if (this.skillRouter) {
      this.skillRouter.setVoicePressure(pressure);
    }

    const bridge = (globalThis as any).__aimc__;
    const botState = bridge?.getBotState?.() || null;

    const result = await this.think({
      botState,
      chatMessage: { source: "player_voice", message: text },
    });

    // Emit voice output if the response contains speech
    if (result?.agentOutput?.speech?.text) {
      this.emitVoiceOutput(result.agentOutput.speech.text);
    }

    // Phase 4-B: Emit voice pressure telemetry
    if (this.skillRouter) {
      this.skillRouter.emitVoicePressureTrace({
        planInfluenceApplied: result?.agentOutput?.intent === "plan" || result?.agentOutput?.intent === "skill",
        intentType: result?.agentOutput?.intent,
      });
      // Reset to neutral after cycle
      this.skillRouter.setVoicePressure(createNeutralSignal());
    }

    this._voiceState.processing = false;
    return result;
  }

  /**
   * Emit voice output text to TTS adapter.
   * This is OUTPUT ONLY — it does not affect execution.
   */
  emitVoiceOutput(text: string): void {
    if (!text) return;
    this._voiceState.speaking = true;

    // Notify registered emitter (TTS adapter wires in here)
    if (this.voiceOutputEmitter) {
      this.voiceOutputEmitter(text);
    }

    // Auto-clear speaking after TTS duration estimate (~150ms per char)
    const estimatedMs = Math.min(text.length * 150, 15000);
    setTimeout(() => {
      this._voiceState.speaking = false;
    }, estimatedMs);
  }

  /** Wire voice input handler (called by VoiceEventBridge / STT adapter). */
  onVoiceInput(handler: (text: string) => Promise<void>): void {
    this.voiceInputHandler = handler;
  }

  /** Wire voice output callback (called by TTS adapter). */
  onVoiceOutput(emitter: (text: string) => void): void {
    this.voiceOutputEmitter = emitter;
  }

  /** Get voice state (read-only — does NOT affect bot state). */
  getVoiceState(): Readonly<{ speaking: boolean; listening: boolean; interrupted: boolean; processing: boolean }> {
    return this._voiceState;
  }

  /**
   * Get voice context bundle (Phase 4-B).
   *
   * Provides a read-only snapshot of voice pressure + state for
   * context injection without exposing internal objects.
   */
  getVoiceContext(): {
    pressure: VoicePressureSignal;
    state: Readonly<{ speaking: boolean; listening: boolean; interrupted: boolean; processing: boolean }>;
  } {
    return {
      pressure: this.lastVoicePressure,
      state: this._voiceState,
    };
  }

  /** Get raw voice intent analyzer (for external telemetry). */
  getVoiceAnalyzer(): VoiceIntentAnalyzer {
    return this.voiceIntentAnalyzer;
  }

  // ─── Phase 4-C: Team Awareness ──────────────────────

  /** Get last computed team state (read-only). */
  getTeamState(): TeamState | null {
    return this.lastTeamState;
  }

  /** Get tactical analyzer (for external telemetry). */
  getTacticalAnalyzer(): TacticalAnalyzer {
    return this.tacticalAnalyzer;
  }

  /** Get support behaviors instance. */
  getSupportBehaviors(): SupportBehaviors {
    return this.supportBehaviors;
  }

  /**
   * Generate passive support actions from team state.
   * Caller MUST dispatch results through SkillRouter.route().
   */
  generateSupportActions(botHealth: number): {
    actions: import("../interfaces/intent.js").IntentAction[];
    behaviorTriggered: string | null;
  } {
    if (!this.lastTeamState) return { actions: [], behaviorTriggered: null };
    return this.supportBehaviors.evaluate(this.lastTeamState, botHealth);
  }

  /**
   * Build TeamState from read-only sources: __WORLD_STATE__, __botState__.
   */
  private buildTeamState(
    botState: import("../interfaces/minecraft.js").BotState | null,
    nearbyEntities: string[],
  ): TeamState {
    const worldState = (globalThis as any).__WORLD_STATE__;
    const nearbyPlayers = worldState?.getNearbyPlayers?.() || [];
    const nearbyHostiles = worldState?.getNearbyHostiles?.() || [];

    return buildTeamState({
      botPosition: botState?.position || null,
      botHealth: botState?.health || 20,
      nearbyEntities,
      nearbyPlayers,
      nearbyHostiles,
    });
  }

  /**
   * Format team tactical context as a short LLM system message.
   */
  private formatTeamContext(
    state: TeamState,
    recommendation: import("../team/tactical-analyzer.js").TacticalRecommendation,
  ): string {
    const lines: string[] = ["[TEAM CONTEXT]"];

    lines.push(`Mode: ${state.teamMode}`);
    lines.push(`Threat level: ${(state.botThreatLevel * 100).toFixed(0)}%`);

    if (state.nearbyPlayers.length > 0) {
      const names = state.nearbyPlayers.map((p) =>
        `${p.name}(${p.distanceToBot}m, ${p.currentAction})`,
      );
      lines.push(`Nearby players: ${names.join(", ")}`);
    }

    if (state.activeThreats.length > 0) {
      const threats = state.activeThreats.map((t) =>
        `${t.entityName}(${t.distanceToBot}m)`,
      );
      lines.push(`Active threats: ${threats.join(", ")}`);
    }

    if (state.isIsolated) {
      lines.push("STATUS: Isolated from team. Consider regrouping.");
    }

    if (recommendation !== "none") {
      lines.push(`Tactical priority: ${recommendation}`);
    }

    lines.push("Act as a cooperative teammate. Prioritize team safety.");
    return lines.join("\n");
  }

  /** Interrupt voice output (SAFE MODE — does NOT touch ActionDispatcher). */
  interruptVoice(reason: string): void {
    this._voiceState.interrupted = true;
    this._voiceState.speaking = false;
    console.log(`[AgentCore] Voice interrupted: ${reason}`);

    this.cancelActiveRequest();

    // Clear interrupt after debounce
    setTimeout(() => {
      this._voiceState.interrupted = false;
    }, 1000);
  }

  /** Classify entity strings into categories for heuristic engine. */
  private classifyNearby(entities: string[]): NearbyInfo {
    const hostileKeywords = ["zombie", "skeleton", "creeper", "spider", "witch", "hoglin", "piglin_brute", "enderman", "warden", "blaze", "ghast"];
    const projectileKeywords = ["arrow", "fireball", "trident", "snowball"];
    const itemKeywords = ["item", "drop", "experience_orb", "xp"];

    const hostiles: string[] = [];
    const projectiles: string[] = [];
    const items: string[] = [];
    const players: string[] = [];
    const other: string[] = [];

    for (const e of entities) {
      const lower = e.toLowerCase();
      if (hostileKeywords.some((h) => lower.includes(h))) {
        hostiles.push(e);
      } else if (projectileKeywords.some((p) => lower.includes(p))) {
        projectiles.push(e);
      } else if (itemKeywords.some((i) => lower.includes(i))) {
        items.push(e);
      } else if (lower.includes("player") || /\(\d+m\)/.test(e)) {
        players.push(e);
      } else {
        other.push(e);
      }
    }

    return { entities: entities, hostiles, items, players, projectiles: projectiles };
  }
}

// Re-export for convenience
export { FALLBACK_IDLE_OUTPUT };

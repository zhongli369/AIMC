/**
 * SkillRouter — SOLE execution entry point for ALL AgentOutput.
 *
 * This is the ONLY path from AI decision to Minecraft action:
 *   AgentCore → RuntimeCore.validate() → SkillRouter.route() → ActionDispatcher → Mineflayer
 *
 * Handles three intent types:
 *   - "chat"  → dispatch validated actions directly
 *   - "skill" → look up skill, plan actions, dispatch (with retry + fallback)
 *   - "plan"  → decompose plan steps, execute sequentially (with lifecycle)
 *
 * Phase 3-A additions:
 *   - Retry mechanism (max 2, exponential backoff 100→300→600ms)
 *   - Fallback skill chain (registry-level mapping, max 2 hops)
 *   - Execution telemetry (AIMC_SKILL_TRACE structured logs)
 *   - Plan step lifecycle (pending/running/success/failed/retrying/skipped)
 *
 * SkillRouter sets a caller token before dispatching so ActionDispatcher
 * can verify the caller is authorized. Token is cleared in finally block.
 */
import type { AgentOutput, IntentAction, ExecutionResult } from "../interfaces/intent.js";
import type { ActionDispatcher } from "../runtime/action-dispatcher.js";
import type { SkillContext } from "./skill-definitions.js";
import { SkillRegistry } from "./skill-registry.js";
import type { SkillExecutionResult, PlanStepStatus, SkillTrace, PlanStepState } from "./types/skill-result.js";
import { DEFAULT_RETRY_CONFIG } from "./types/skill-result.js";
import { randomUUID } from "node:crypto";
import type { VoicePressureSignal } from "../voice/voice-pressure.js";
import { computeTimingModifiers, applyRetryModifiers, applyTimeoutModifier, createNeutralSignal } from "../voice/voice-pressure.js";
import type { TacticalRecommendation, TacticalSkillBias } from "../team/tactical-analyzer.js";
import type { CompanionRole } from "../role/role-identity.js";
import type { RelationshipSnapshot } from "../memory/relationship-state.js";
import type { ExperienceCategory } from "../memory/shared-experience.js";
import { SkillFailureTracker, ActionLoopDetector } from "../behavior/stability/stuck-detector.js";
import { BehaviorTimeline } from "../observability/behavior-timeline.js";
import { getEventCollector } from "../observability/event-collector.js";
import type { RuntimeTraceRecorder } from "../observability/runtime-trace.js";
import { getFallbackMap, getVoicePressureSensitivity, isVoiceTimingEnabled, getBehaviorConfig } from "../config/aimc-config.js";

// ─── Plan Types ───────────────────────────────────────

export interface PlanStep {
  step: number;
  action: string;
  skill?: string;
  params: Record<string, unknown>;
}

export interface TaskPlan {
  goal: string;
  steps: PlanStep[];
}

export interface PlanExecutionResult {
  goal: string;
  completed: boolean;
  stepsCompleted: number;
  stepsTotal: number;
  currentStep: number;
  results: ExecutionResult[];
  message: string;
  /** Per-step lifecycle status (Phase 3-A) */
  stepStatuses: PlanStepStatus[];
}

// ─── Caller Token ─────────────────────────────────────
// Set on globalThis before dispatching so ActionDispatcher can verify.

const CALLER_TOKEN_KEY = "__AIMC_SKILLROUTER_TOKEN__";

function generateCallerToken(): string {
  return `skillrouter_${randomUUID()}`;
}

function setCallerToken(token: string): void {
  (globalThis as any)[CALLER_TOKEN_KEY] = token;
}

function clearCallerToken(): void {
  delete (globalThis as any)[CALLER_TOKEN_KEY];
}

// ─── Router ───────────────────────────────────────────

export class SkillRouter {
  private registry: SkillRegistry;
  private dispatcher: ActionDispatcher | null = null;
  private aborted = false;
  private callerToken: string;

  // Phase 4-B: Voice-driven timing influence (READ ONLY)
  private voicePressure: VoicePressureSignal = createNeutralSignal();

  // Phase 0.5: Config-driven sensitivity (1.0 = default)
  private voiceSensitivity: number = getVoicePressureSensitivity();
  private voiceTimingEnabled: boolean = isVoiceTimingEnabled();

  constructor(registry?: SkillRegistry) {
    this.registry = registry || new SkillRegistry();
    this.callerToken = generateCallerToken();
  }

  /** Bind the ActionDispatcher (late binding, set after bot spawn). */
  setDispatcher(dispatcher: ActionDispatcher): void {
    this.dispatcher = dispatcher;
    // Register this router's token with the dispatcher
    dispatcher.registerCaller("SkillRouter", this.callerToken);
  }

  getRegistry(): SkillRegistry {
    return this.registry;
  }

  /** Abort any running plan execution. */
  abort(): void {
    this.aborted = true;
  }

  /**
   * Set voice pressure signal for timing influence (Phase 4-B).
   *
   * This is a SOFT modifier only. It scales retry delays, timeouts,
   * and fallback speed. It does NOT change the execution chain or
   * create new control paths. Call with createNeutralSignal() to reset.
   */
  setVoicePressure(signal: VoicePressureSignal): void {
    this.voicePressure = signal;
  }

  /** Get current voice pressure signal (read-only). */
  getVoicePressure(): Readonly<VoicePressureSignal> {
    return this.voicePressure;
  }

  // Phase 4-C: Tactical coordination bias (READ ONLY, skill-weight influence only)

  private tacticalBias: TacticalSkillBias | null = null;
  private tacticalRecommendation: TacticalRecommendation = "none";

  // Phase 5: Stability — failure tracking + loop detection (gating only)
  private failureTracker: SkillFailureTracker = new SkillFailureTracker();
  private loopDetector: ActionLoopDetector = new ActionLoopDetector();

  // Phase 6: Observability — timeline + trace recording (PURE OBSERVABILITY)
  private timeline: BehaviorTimeline | null = null;
  private traceRecorder: RuntimeTraceRecorder | null = null;

  /** Set tactical bias for skill routing preference (Phase 4-C). */
  setTacticalBias(bias: TacticalSkillBias, recommendation: TacticalRecommendation): void {
    this.tacticalBias = bias;
    this.tacticalRecommendation = recommendation;
  }

  /** Get failure tracker for external telemetry (Phase 5). */
  getFailureTracker(): SkillFailureTracker {
    return this.failureTracker;
  }

  /** Get loop detector for external telemetry (Phase 5). */
  getLoopDetector(): ActionLoopDetector {
    return this.loopDetector;
  }

  /** Clear tactical bias (return to neutral). */
  clearTacticalBias(): void {
    this.tacticalBias = null;
    this.tacticalRecommendation = "none";
  }

  // Phase 6: Observability wiring

  /** Wire observability backends for trace recording. */
  setObservabilityBackend(params: {
    timeline: BehaviorTimeline;
    traceRecorder?: RuntimeTraceRecorder;
  }): void {
    this.timeline = params.timeline;
    if (params.traceRecorder) this.traceRecorder = params.traceRecorder;
  }

  getBehaviorTimeline(): BehaviorTimeline | null {
    return this.timeline;
  }

  // Phase 0.5: Config wiring

  /**
   * Apply config values at runtime (after config file loaded).
   * Replaces hardcoded fallback mapping, voice sensitivity, and behavior flags.
   */
  applyConfig(): void {
    // Wire fallback map from config
    const fallbackMap = getFallbackMap();
    this.failureTracker.setFallbackMap(fallbackMap);

    // Wire voice sensitivity
    this.voiceSensitivity = getVoicePressureSensitivity();
    this.voiceTimingEnabled = isVoiceTimingEnabled();

    console.log("[SkillRouter] Config applied — fallback map + voice sensitivity wired");
  }

  /** Get current tactical recommendation (read-only). */
  getTacticalRecommendation(): TacticalRecommendation {
    return this.tacticalRecommendation;
  }

  /**
   * Adjust fallback chain based on tactical recommendation.
   * If tactical mode is "protect", a non-combat skill failure should
   * prefer falling back to defend_player rather than explore_area.
   */
  private applyTacticalFallbackBias(skillName: string, originalFb: string | undefined): string | undefined {
    if (!this.tacticalBias) return originalFb;

    const combatSkills = ["attack_target", "defend_player"];
    const nonCombatSkills = ["mine_resource", "gather_food", "build_shelter", "explore_area", "collect_items"];

    // In protect/retreat mode: non-combat failures → prefer defend_player
    if ((this.tacticalRecommendation === "protect" || this.tacticalRecommendation === "retreat")
        && nonCombatSkills.includes(skillName)) {
      return "defend_player";
    }

    // In regroup mode: any non-movement failure → prefer follow_player
    if (this.tacticalRecommendation === "regroup"
        && skillName !== "follow_player") {
      return "follow_player";
    }

    // In scout mode: non-exploration failure → prefer explore_area
    if (this.tacticalRecommendation === "scout"
        && skillName !== "explore_area") {
      return "explore_area";
    }

    return originalFb;
  }

  // ─── Route (SOLE EXECUTION ENTRY) ───────────────────

  /**
   * Route a VALIDATED AgentOutput through the skill system.
   *
   * This is the SINGLE entry point for all action execution.
   * RuntimeCore.validate() must be called BEFORE this method.
   *
   * Handles ALL intent types:
   *   - "chat"  → dispatch actions directly
   *   - "skill" → execute a single skill (with retry + fallback)
   *   - "plan"  → execute a multi-step plan (with step lifecycle)
   */
  async route(
    output: AgentOutput,
    ctx: SkillContext,
  ): Promise<{ results: ExecutionResult[]; planResult?: PlanExecutionResult; skillResult?: SkillExecutionResult }> {
    this.aborted = false;

    // Phase 6: Record route entry in trace recorder
    if (this.traceRecorder) {
      try {
        this.traceRecorder.recordEvent({
          stage: "skill_router",
          label: `route_${output.intent}`,
          input: {
            intent: output.intent,
            skillName: output.skill?.name,
            planGoal: output.plan?.goal,
            actionCount: output.actions?.length ?? 0,
          },
        });
      } catch { /* never throw */ }
    }

    if (!this.dispatcher) {
      return {
        results: [{
          actionId: "route",
          success: false,
          message: "SkillRouter: no dispatcher bound — call setDispatcher() first",
          interrupted: false,
          timedOut: false,
        }],
      };
    }

    // Set caller token so ActionDispatcher can verify authorization
    setCallerToken(this.callerToken);

    try {
      if (output.intent === "skill" && output.skill) {
        // Phase 6: Timeline — skill start
        if (this.timeline) {
          try {
            this.timeline.skillStart(output.skill.name, output.skill.params || {});
          } catch { /* never throw */ }
        }

        const skillStart = Date.now();
        const skillResult = await this.executeSkillWithRetry(
          output.skill.name,
          output.skill.params || {},
          ctx,
        );

        // Phase 6: Timeline — skill end
        if (this.timeline) {
          try {
            if (skillResult.success) {
              this.timeline.skillComplete(output.skill.name, Date.now() - skillStart);
            } else {
              this.timeline.skillFailed(output.skill.name, skillResult.error);
            }
          } catch { /* never throw */ }
        }

        return { results: skillResult.actionResults, skillResult };
      }

      if (output.intent === "plan" && output.plan) {
        const planResult = await this.executePlan(output.plan, ctx);
        return { results: planResult.results, planResult };
      }

      // "chat" intent (or missing intent) — dispatch actions directly
      const results = await this.dispatchActions(output.actions, ctx);
      return { results };
    } finally {
      // Phase 6: Record timeline entries to event collector
      if (this.timeline) {
        try {
          const collector = getEventCollector();
          const recentEntries = this.timeline.getAll(10);
          for (const entry of recentEntries) {
            collector.ingestTimelineEntry(entry);
          }
        } catch { /* never throw */ }
      }
      clearCallerToken();
    }
  }

  // ─── Chat Actions Dispatch ──────────────────────────

  private async dispatchActions(
    actions: IntentAction[],
    _ctx: SkillContext,
  ): Promise<ExecutionResult[]> {
    if (!this.dispatcher) return [];
    const results: ExecutionResult[] = [];
    for (const action of actions) {
      if (this.aborted) {
        results.push({
          actionId: action.id,
          success: false,
          message: "Execution aborted",
          interrupted: true,
          timedOut: false,
        });
        break;
      }
      const result = await this.dispatcher.dispatch(action);
      results.push(result);
    }
    return results;
  }

  // ─── Single Action with Retry ───────────────────────

  /**
   * Dispatch a single action with retry on execution failure.
   * DOES NOT retry on safety blocks or validation failures.
   */
  private async dispatchWithRetry(
    action: IntentAction,
    maxRetries: number = DEFAULT_RETRY_CONFIG.maxRetries,
  ): Promise<ExecutionResult> {
    if (!this.dispatcher) {
      return {
        actionId: action.id,
        success: false,
        message: "No dispatcher bound",
        interrupted: false,
        timedOut: false,
      };
    }

    // Phase 5: Loop gate — suppress repeated identical actions
    const targetKey = typeof action.target === "object" && action.target !== null
      ? JSON.stringify(action.target)
      : String(action.target || "_none_");
    this.loopDetector.recordAction(action.type, targetKey);

    if (this.loopDetector.isLooping(action.type, targetKey)) {
      this.loopDetector.applyCooldown(action.type);

      // Phase 6: Timeline — loop detected
      if (this.timeline) {
        try { this.timeline.loopDetected(action.type, this.loopDetector.getLoopCount()); } catch { /* never throw */ }
      }

      this.emitStabilityTrace({
        event: "loop_detected",
        actionType: action.type,
        targetKey,
        loopCount: this.loopDetector.getLoopCount(),
      });
      return {
        actionId: action.id,
        success: false,
        message: `Loop suppressed: ${action.type} executed too many times`,
        interrupted: false,
        timedOut: false,
      };
    }

    // Check cooldown gate
    if (this.loopDetector.isInCooldown(action.type)) {
      return {
        actionId: action.id,
        success: false,
        message: `Action ${action.type} in cooldown (${this.loopDetector.getCooldownRemaining(action.type)}ms remaining)`,
        interrupted: false,
        timedOut: false,
      };
    }

    // Phase 4-B: Apply voice pressure to retry config (soft influence only)
    const modifiers = computeTimingModifiers(this.voicePressure, this.voiceSensitivity);
    const adjusted = applyRetryModifiers(
      DEFAULT_RETRY_CONFIG.baseDelayMs,
      DEFAULT_RETRY_CONFIG.maxDelayMs,
      maxRetries,
      modifiers,
    );

    let lastResult: ExecutionResult | null = null;

    for (let attempt = 0; attempt <= adjusted.maxRetries; attempt++) {
      if (this.aborted) {
        return {
          actionId: action.id,
          success: false,
          message: "Execution aborted",
          interrupted: true,
          timedOut: false,
        };
      }

      const result = await this.dispatcher.dispatch(action);

      if (result.success) {
        // Tag with retry metadata
        result.data = { ...(result.data || {}), retryAttempt: attempt };
        return result;
      }

      lastResult = result;

      // Don't retry if safety blocked or interrupted
      if (result.interrupted || result.message?.includes("Safety blocked")) {
        return result;
      }

      // Last attempt — don't wait
      if (attempt < adjusted.maxRetries) {
        const delay = Math.min(
          adjusted.baseDelayMs * Math.pow(2, attempt),
          adjusted.maxDelayMs,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    return lastResult ?? {
      actionId: action.id,
      success: false,
      message: "All retries exhausted",
      interrupted: false,
      timedOut: false,
    };
  }

  // ─── Single Skill with Retry + Fallback ─────────────

  /**
   * Execute a single skill with retry and fallback support.
   *
   * Phase 3-A flow:
   *   1. Plan actions via registry
   *   2. Dispatch each action with retry
   *   3. If any action fails all retries → trigger fallback
   *   4. If fallback exists → execute fallback skill
   *   5. Emit AIMC_SKILL_TRACE telemetry
   */
  async executeSkillWithRetry(
    name: string,
    params: Record<string, unknown>,
    ctx: SkillContext,
  ): Promise<SkillExecutionResult> {
    const startedAt = Date.now();
    let retryCount = 0;
    let fallbackUsed = false;
    let fallbackSkillName: string | undefined;

    // Phase 5: Gate — skip disabled skills, go straight to fallback
    if (this.failureTracker.isDisabled(name)) {
      console.log(`[SkillRouter] Skill "${name}" is temporarily disabled — skipping`);
      const fb = this.failureTracker.getFallback(name)
        || this.registry.resolveFallback(name);
      if (fb && fb !== name) {
        fallbackUsed = true;
        fallbackSkillName = fb;

        // Phase 6: Timeline — fallback (skill disabled)
        if (this.timeline) {
          try { this.timeline.fallbackTriggered(name, fb, "skill_disabled"); } catch { /* never throw */ }
        }

        const fbResult = await this.executeSkillInternal(fb, params, ctx);
        const durationMs = Date.now() - startedAt;
        this.emitStabilityTrace({
          event: "skill_disabled",
          skillName: name,
          fallbackSkill: fb,
          disableRemainingMs: this.failureTracker.getDisableRemaining(name),
        });
        return {
          ...fbResult,
          durationMs,
          fallbackUsed: true,
          fallbackSkillName: fb,
          retryCount: fbResult.retryCount,
        };
      }
    }

    // Try primary skill
    let result = await this.executeSkillInternal(name, params, ctx);

    retryCount = result.retryCount;

    // Phase 5: Track success/failure (gating only — no decision change)
    if (result.success) {
      this.failureTracker.recordSuccess(name);
    } else {
      this.failureTracker.recordFailure(name);
    }

    // If primary skill failed and has fallback, try fallback
    if (!result.success && !this.aborted) {
      const fb = this.registry.resolveFallback(name);
      // Phase 4-C: Tactical bias may suggest a different fallback preference
      const tacticallyAdjustedFb = this.applyTacticalFallbackBias(name, fb);
      const finalFb = tacticallyAdjustedFb && tacticallyAdjustedFb !== name ? tacticallyAdjustedFb : fb;
      if (finalFb && finalFb !== name) {
        console.log(
          `[SkillRouter] Skill "${name}" failed — falling back to "${finalFb}"${tacticallyAdjustedFb && tacticallyAdjustedFb !== fb ? ' (tactical adjustment)' : ''}`,
        );
        fallbackUsed = true;
        fallbackSkillName = finalFb;

        // Phase 6: Timeline — fallback
        if (this.timeline) {
          try { this.timeline.fallbackTriggered(name, finalFb, "skill_failed"); } catch { /* never throw */ }
        }

        const fbResult = await this.executeSkillInternal(finalFb, params, ctx);
        retryCount += fbResult.retryCount;

        // Merge results
        result = {
          ...fbResult,
          fallbackUsed: true,
          fallbackSkillName: finalFb,
          retryCount,
        };
      }
    }

    const durationMs = Date.now() - startedAt;

    // Emit AIMC_SKILL_TRACE
    this.emitSkillTrace({
      traceId: randomUUID(),
      timestamp: startedAt,
      skillName: name,
      intent: "skill",
      durationMs,
      retryCount,
      finalStatus: result.success
        ? "success"
        : fallbackUsed
          ? "fallback"
          : "failed",
      fallbackTriggered: fallbackUsed,
      fallbackSkillName,
      actionsDispatched: result.actionsExecuted,
      error: result.error,
    });

    return {
      ...result,
      durationMs,
      fallbackUsed,
      fallbackSkillName,
      retryCount,
    };
  }

  /**
   * Internal skill execution (dispatches all planned actions with retry).
   */
  private async executeSkillInternal(
    name: string,
    params: Record<string, unknown>,
    ctx: SkillContext,
  ): Promise<SkillExecutionResult> {
    if (!this.dispatcher) {
      return {
        success: false,
        skillName: name,
        actionsExecuted: 0,
        retryCount: 0,
        durationMs: 0,
        error: "No dispatcher bound",
        fallbackUsed: false,
        actionResults: [],
      };
    }

    const actions = this.registry.plan(name, params, ctx);
    if (actions.length === 0) {
      return {
        success: false,
        skillName: name,
        actionsExecuted: 0,
        retryCount: 0,
        durationMs: 0,
        error: `Skill "${name}" not found or produced no actions`,
        fallbackUsed: false,
        actionResults: [],
      };
    }

    const actionResults: ExecutionResult[] = [];
    let totalRetries = 0;
    let allSucceeded = true;
    const isRetryable = this.registry.isRetryable(name);

    for (const action of actions) {
      if (this.aborted) {
        actionResults.push({
          actionId: action.id,
          success: false,
          message: "Plan aborted",
          interrupted: true,
          timedOut: false,
        });
        allSucceeded = false;
        break;
      }

      const maxR = isRetryable ? DEFAULT_RETRY_CONFIG.maxRetries : 0;
      const result = await this.dispatchWithRetry(action, maxR);
      const attempts = (result.data?.retryAttempt as number) ?? 0;
      totalRetries += attempts;
      actionResults.push(result);

      if (!result.success) {
        allSucceeded = false;
        // Critical actions: break on failure (don't continue if survival at stake)
        if (action.priority >= 4) break;
      }
    }

    return {
      success: allSucceeded,
      skillName: name,
      actionsExecuted: actionResults.length,
      retryCount: totalRetries,
      durationMs: 0, // filled by caller
      error: allSucceeded
        ? undefined
        : `Skill "${name}" had ${actionResults.filter((r) => !r.success).length} failed actions`,
      fallbackUsed: false,
      actionResults,
    };
  }

  // ─── Legacy executeSkill (backward compat) ──────────

  /**
   * Execute a skill (backward-compatible wrapper).
   * Delegates to executeSkillInternal for single-shot execution without fallback.
   */
  async executeSkill(
    name: string,
    params: Record<string, unknown>,
    ctx: SkillContext,
  ): Promise<ExecutionResult[]> {
    const result = await this.executeSkillInternal(name, params, ctx);
    return result.actionResults;
  }

  // ─── Multi-Step Plan (Phase 3-A enhanced) ───────────

  async executePlan(
    plan: TaskPlan,
    ctx: SkillContext,
  ): Promise<PlanExecutionResult> {
    const allResults: ExecutionResult[] = [];
    const stepStatuses: PlanStepStatus[] = [];
    let stepsCompleted = 0;

    for (let i = 0; i < plan.steps.length; i++) {
      if (this.aborted) break;

      const step = plan.steps[i];
      const stepStatus: PlanStepStatus = {
        step: i + 1,
        action: step.action,
        skill: step.skill,
        state: "running",
        retryCount: 0,
        startedAt: Date.now(),
        fallbackUsed: false,
      };

      let stepResults: ExecutionResult[];

      if (step.skill) {
        // Use full retry+fallback for skill steps
        const skillResult = await this.executeSkillWithRetry(
          step.skill,
          step.params || {},
          ctx,
        );
        stepResults = skillResult.actionResults;
        stepStatus.retryCount = skillResult.retryCount;
        stepStatus.fallbackUsed = skillResult.fallbackUsed;
        stepStatus.fallbackSkillName = skillResult.fallbackSkillName;
      } else if (step.action) {
        const action: IntentAction = {
          id: `plan_${i}_${Date.now()}`,
          type: step.action as IntentAction["type"],
          target: (step.params || {}) as IntentAction["target"],
          priority: 3,
          reason: `Plan step ${i + 1}/${plan.steps.length}: ${step.action}`,
          timeout: this.stepTimeout(3),
        };
        const result = await this.dispatchWithRetry(action);
        stepResults = [result];
        stepStatus.retryCount = (result.data?.retryAttempt as number) ?? 0;
      } else {
        stepStatus.state = "skipped";
        stepStatus.completedAt = Date.now();
        stepStatuses.push(stepStatus);
        continue;
      }

      stepStatus.completedAt = Date.now();
      stepStatus.durationMs = stepStatus.completedAt - (stepStatus.startedAt ?? stepStatus.completedAt);

      allResults.push(...stepResults);
      const allSucceeded = stepResults.every((r) => r.success);

      if (allSucceeded) {
        stepStatus.state = "success";
        stepsCompleted++;
      } else if (stepStatus.retryCount > 0 && !stepStatus.fallbackUsed) {
        stepStatus.state = "failed";
        stepStatus.error = "Step failed after retries";
      } else if (stepStatus.fallbackUsed) {
        stepStatus.state = "skipped";
        stepStatus.error = "Fallback applied";
      } else {
        stepStatus.state = "failed";
        stepStatus.error = stepResults.find((r) => !r.success)?.message || "Step failed";
      }

      stepStatuses.push(stepStatus);

      // Failure isolation: a failed step does NOT block subsequent steps
      // (AgentCore can decide to re-plan based on the step statuses)
    }

    // Emit plan-level AIMC_SKILL_TRACE
    this.emitSkillTrace({
      traceId: randomUUID(),
      timestamp: stepStatuses[0]?.startedAt ?? Date.now(),
      skillName: plan.goal,
      intent: "plan",
      durationMs: stepStatuses.reduce((sum, s) => sum + (s.durationMs ?? 0), 0),
      retryCount: stepStatuses.reduce((sum, s) => sum + s.retryCount, 0),
      finalStatus: stepsCompleted === plan.steps.length
        ? "success"
        : stepsCompleted > 0
          ? "partial"
          : "failed",
      fallbackTriggered: stepStatuses.some((s) => s.fallbackUsed),
      actionsDispatched: allResults.length,
      planSteps: stepStatuses,
    });

    return {
      goal: plan.goal,
      completed: stepsCompleted === plan.steps.length,
      stepsCompleted,
      stepsTotal: plan.steps.length,
      currentStep: stepsCompleted,
      results: allResults,
      message: stepsCompleted === plan.steps.length
        ? `Plan "${plan.goal}" completed: ${stepsCompleted}/${plan.steps.length} steps`
        : `Plan "${plan.goal}" partial: ${stepsCompleted}/${plan.steps.length} steps`,
      stepStatuses,
    };
  }

  // ─── Telemetry ──────────────────────────────────────

  /**
   * Emit a structured AIMC_SKILL_TRACE log entry.
   * This is a SIDE EFFECT ONLY — it does not affect execution flow.
   */
  private emitSkillTrace(trace: SkillTrace): void {
    const logLine = `AIMC_SKILL_TRACE:${JSON.stringify(trace)}`;
    console.log(logLine);

    // Also write to stdout for parent process monitoring
    try {
      process.stdout.write(logLine + "\n");
    } catch {
      // stdout may be closed — ignore
    }
  }

  // ─── Helpers ────────────────────────────────────────

  /** Calculate per-step timeout based on priority, scaled by voice pressure. */
  private stepTimeout(priority: number): number {
    // priority 5: 8s, priority 4: 10s, priority 3: 12s, priority 2: 14s, priority 1: 15s
    const base = 16;
    const baseMs = (base - priority * 2) * 1000;
    const raw = Math.max(8000, Math.min(15000, baseMs));

    // Phase 4-B: Apply voice pressure timeout modifier
    const modifiers = computeTimingModifiers(this.voicePressure, this.voiceSensitivity);
    return applyTimeoutModifier(raw, modifiers);
  }

  // ─── Phase 4-B: Voice Pressure Telemetry ────────────

  /**
   * Emit AIMC_VOICE_PRESSURE_TRACE for observability.
   * Side-effect only — does NOT affect execution flow.
   */
  emitVoicePressureTrace(extra?: Record<string, unknown>): void {
    const trace = {
      traceId: randomUUID(),
      timestamp: Date.now(),
      level: this.voicePressure.level,
      intensity: this.voicePressure.intensity,
      confidence: this.voicePressure.confidence,
      triggeredKeywords: this.voicePressure.source.keywords,
      repetitionCount: this.voicePressure.source.repetitionCount,
      modifiers: computeTimingModifiers(this.voicePressure, this.voiceSensitivity),
      ...extra,
    };
    const logLine = `AIMC_VOICE_PRESSURE_TRACE:${JSON.stringify(trace)}`;
    console.log(logLine);
    try {
      process.stdout.write(logLine + "\n");
    } catch {
      // stdout may be closed
    }
  }

  // ─── Phase 4-C: Tactical Telemetry ──────────────────

  /**
   * Emit AIMC_TACTICAL_TRACE for observability.
   * Side-effect only — does NOT affect execution flow.
   */
  emitTacticalTrace(extra?: Record<string, unknown>): void {
    const trace = {
      traceId: randomUUID(),
      timestamp: Date.now(),
      tacticalRecommendation: this.tacticalRecommendation,
      skillBias: this.tacticalBias,
      ...extra,
    };
    const logLine = `AIMC_TACTICAL_TRACE:${JSON.stringify(trace)}`;
    console.log(logLine);
    try {
      process.stdout.write(logLine + "\n");
    } catch {
      // stdout may be closed
    }
  }

  // ─── Phase 4-D: Role Telemetry ──────────────────────

  /**
   * Emit AIMC_ROLE_TRACE for observability.
   *
   * Captures role influence on skill execution:
   *   - Current role and confidence
   *   - Role switch events
   *   - Skill weight overrides from role
   *
   * Side-effect only — does NOT affect execution flow.
   */
  emitRoleTrace(params: {
    currentRole: CompanionRole;
    confidence: number;
    event: "skill_influence" | "role_switch" | "adaptation_tick";
    roleSkillWeights?: Record<string, number>;
    previousRole?: CompanionRole;
    switchReason?: string;
    dominantTraits?: string[];
  }): void {
    const trace = {
      traceId: randomUUID(),
      timestamp: Date.now(),
      ...params,
    };
    const logLine = `AIMC_ROLE_TRACE:${JSON.stringify(trace)}`;
    console.log(logLine);
    try {
      process.stdout.write(logLine + "\n");
    } catch {
      // stdout may be closed
    }
  }

  // ─── Phase 4-E: Memory & Relationship Telemetry ──────

  /**
   * Emit AIMC_MEMORY_TRACE for observability (Phase 4-E).
   *
   * Tracks: memory recalls, callback usage, memory pruning.
   * Side-effect only — does NOT affect execution flow.
   */
  emitMemoryTrace(params: {
    event: "recall" | "callback_generated" | "pruned" | "experience_added";
    category?: ExperienceCategory;
    callbackText?: string;
    memoryCount?: number;
    prunedCount?: number;
    queryKeywords?: string[];
  }): void {
    const trace = {
      traceId: randomUUID(),
      timestamp: Date.now(),
      ...params,
    };
    const logLine = `AIMC_MEMORY_TRACE:${JSON.stringify(trace)}`;
    console.log(logLine);
    try {
      process.stdout.write(logLine + "\n");
    } catch {
      // stdout may be closed
    }
  }

  /**
   * Emit AIMC_RELATIONSHIP_TRACE for observability (Phase 4-E).
   *
   * Tracks: trust changes, familiarity evolution, relationship milestones.
   * Side-effect only — does NOT affect execution flow.
   */
  emitRelationshipTrace(params: {
    event: "trust_change" | "familiarity_change" | "session_start" | "session_end" | "milestone";
    snapshot?: RelationshipSnapshot;
    delta?: number;
    reason?: string;
    previousLevel?: number;
    newLevel?: number;
  }): void {
    const trace = {
      traceId: randomUUID(),
      timestamp: Date.now(),
      ...params,
    };
    const logLine = `AIMC_RELATIONSHIP_TRACE:${JSON.stringify(trace)}`;
    console.log(logLine);
    try {
      process.stdout.write(logLine + "\n");
    } catch {
      // stdout may be closed
    }
  }

  // ─── Phase 5: Stability Telemetry ──────────────────────

  /**
   * Emit AIMC_STABILITY_TRACE for observability (Phase 5).
   *
   * Diagnostic only — does NOT affect execution flow or feed back into reasoning.
   * Tracks: stuck detection, loop detection, skill disable, safe mode transitions.
   */
  emitStabilityTrace(params: {
    event: "stuck_detected" | "loop_detected" | "skill_disabled" | "safe_mode_enter" | "safe_mode_exit" | "cooldown_active";
    skillName?: string;
    actionType?: string;
    targetKey?: string;
    fallbackSkill?: string;
    disableRemainingMs?: number;
    loopCount?: number;
    stuckDurationMs?: number;
    reason?: string;
  }): void {
    const trace = {
      traceId: randomUUID(),
      timestamp: Date.now(),
      ...params,
    };
    const logLine = `AIMC_STABILITY_TRACE:${JSON.stringify(trace)}`;
    console.log(logLine);
    try {
      process.stdout.write(logLine + "\n");
    } catch {
      // stdout may be closed
    }
  }

  // ─── Phase 4-G: Arbitration Telemetry ──────────────────

  /**
   * Emit AIMC_ARBITRATION_TRACE for observability (Phase 4-G).
   *
   * Tracks: signal weights, winning action, rejected actions, applied rules.
   * Side-effect only — does NOT affect execution flow.
   */
  emitArbitrationTrace(params: {
    signalWeights: Record<string, number>;
    primaryAction: string | null;
    suppressedCount: number;
    appliedRule: string | null;
    reasonChain: string[];
    tacticalRecommendation?: string;
    voiceLevel?: string;
    companionRole?: string;
  }): void {
    const trace = {
      traceId: randomUUID(),
      timestamp: Date.now(),
      ...params,
    };
    const logLine = `AIMC_ARBITRATION_TRACE:${JSON.stringify(trace)}`;
    console.log(logLine);
    try {
      process.stdout.write(logLine + "\n");
    } catch {
      // stdout may be closed
    }
  }

  // ─── Phase 4-F: Cooperative Telemetry ─────────────────

  /**
   * Emit AIMC_COOP_TRACE for observability (Phase 4-F).
   *
   * Tracks: predicted intents, proactive assists, cooperative success rate.
   * Side-effect only — does NOT affect execution flow.
   */
  emitCoopTrace(params: {
    event: "intent_predicted" | "assist_action" | "coop_success" | "coop_failure";
    predictedIntent?: string;
    confidence?: number;
    supportAction?: string;
    playerAction?: string;
    durationMs?: number;
  }): void {
    const trace = {
      traceId: randomUUID(),
      timestamp: Date.now(),
      ...params,
    };
    const logLine = `AIMC_COOP_TRACE:${JSON.stringify(trace)}`;
    console.log(logLine);
    try {
      process.stdout.write(logLine + "\n");
    } catch {
      // stdout may be closed
    }
  }

  /**
   * Emit AIMC_SUPPORT_TRACE for observability (Phase 4-F).
   *
   * Tracks: proactive support actions, interruptions, assistance decisions.
   * Side-effect only — does NOT affect execution flow.
   */
  emitSupportTrace(params: {
    event: "support_generated" | "support_interrupted" | "support_completed" | "support_skipped";
    supportType?: string;
    reason?: string;
    priority?: number;
    cooldownActive?: boolean;
  }): void {
    const trace = {
      traceId: randomUUID(),
      timestamp: Date.now(),
      ...params,
    };
    const logLine = `AIMC_SUPPORT_TRACE:${JSON.stringify(trace)}`;
    console.log(logLine);
    try {
      process.stdout.write(logLine + "\n");
    } catch {
      // stdout may be closed
    }
  }

  /**
   * Emit AIMC_FORMATION_TRACE for observability (Phase 4-F).
   *
   * Tracks: formation mode switches, positioning adjustments.
   * Side-effect only — does NOT affect execution flow.
   */
  emitFormationTrace(params: {
    event: "formation_changed" | "regroup_triggered" | "position_adjusted";
    previousFormation?: string;
    newFormation?: string;
    reason?: string;
    distanceToPlayer?: number;
  }): void {
    const trace = {
      traceId: randomUUID(),
      timestamp: Date.now(),
      ...params,
    };
    const logLine = `AIMC_FORMATION_TRACE:${JSON.stringify(trace)}`;
    console.log(logLine);
    try {
      process.stdout.write(logLine + "\n");
    } catch {
      // stdout may be closed
    }
  }

  /**
   * Emit AIMC_COMBAT_TRACE for observability (Phase 4-F).
   *
   * Tracks: combat role, target selection, rescue events, threat priorities.
   * Side-effect only — does NOT affect execution flow.
   */
  emitCombatTrace(params: {
    event: "combat_role" | "target_selected" | "rescue_triggered" | "retreat" | "threat_cleared";
    combatRole?: string;
    targetEntity?: string;
    threatCount?: number;
    botHealth?: number;
    playerHealth?: number;
  }): void {
    const trace = {
      traceId: randomUUID(),
      timestamp: Date.now(),
      ...params,
    };
    const logLine = `AIMC_COMBAT_TRACE:${JSON.stringify(trace)}`;
    console.log(logLine);
    try {
      process.stdout.write(logLine + "\n");
    } catch {
      // stdout may be closed
    }
  }
}

/**
 * RuntimeCore — central orchestrator for the AIMC runtime pipeline.
 *
 * Pipeline: AgentOutput JSON → Schema Validation → SafetyGuard → ActionDispatcher → Results
 *
 * This is the ONLY entry point for LLM outputs to reach Minecraft actions.
 * No LLM may bypass this pipeline.
 */
import type { AgentOutput, IntentAction, ExecutionResult, ValidationError } from "../interfaces/intent.js";
import { validateAgentOutput, type SchemaValidationResult } from "./intent-schema.js";
import { SafetyGuard } from "./safety-guard.js";
import { ActionDispatcher } from "./action-dispatcher.js";
import { eventBus } from "./event-bus.js";
import { logger } from "./logger.js";

// ─── Runtime State ───────────────────────────────────

export type RuntimeState = "init" | "running" | "paused" | "emergency" | "shutdown";

export interface RuntimeStats {
  state: RuntimeState;
  intentsReceived: number;
  intentsApproved: number;
  intentsRejected: number;
  schemaRejections: number;
  safetyRejections: number;
  actionsCompleted: number;
  actionsFailed: number;
  actionsTimedOut: number;
  avgLatencyMs: number;
  uptimeMs: number;
  emergencyReason: string | null;
}

// ─── Pipeline Result ─────────────────────────────────

export interface PipelineResult {
  success: boolean;
  results: ExecutionResult[];
  schemaResult: SchemaValidationResult;
  rejectedIntents: { intent: IntentAction; errors: ValidationError[] }[];
}

// ─── RuntimeCore ─────────────────────────────────────

export class RuntimeCore {
  private safety: SafetyGuard;
  private dispatcher: ActionDispatcher | null = null;
  private state: RuntimeState = "init";
  private startedAt: number = 0;

  // Stats
  private intentsReceived = 0;
  private intentsApproved = 0;
  private intentsRejected = 0;
  private schemaRejections = 0;
  private safetyRejections = 0;
  private actionsCompleted = 0;
  private actionsFailed = 0;
  private actionsTimedOut = 0;
  private totalLatencyMs = 0;
  private latencySamples = 0;

  constructor(safety?: SafetyGuard) {
    this.safety = safety || new SafetyGuard();
  }

  // ─── Lifecycle ─────────────────────────────────────

  setDispatcher(dispatcher: ActionDispatcher): void {
    this.dispatcher = dispatcher;
    this.safety.setBot((dispatcher as any).bot);
  }

  start(): void {
    this.state = "running";
    this.startedAt = Date.now();
    logger.intentReceived({ id: "__runtime_start__", type: "__system__", target: {}, priority: 1, reason: "Runtime started" } as any);
    console.log("[RuntimeCore] Pipeline running — LLM intents will be validated and dispatched.");
  }

  pause(): void {
    this.state = "paused";
    console.log("[RuntimeCore] Runtime paused — intents will be queued but not executed.");
  }

  resume(): void {
    this.state = "running";
    console.log("[RuntimeCore] Runtime resumed.");
  }

  emergencyStop(reason: string): void {
    this.state = "emergency";
    this.safety.emergencyStop(reason);
    logger.safetyEmergency(reason);
    eventBus.emit("system", "safety_block", {
      emergency: true,
      reason,
      allActionsBlocked: true,
    });
    // Cancel all pending actions
    this.dispatcher?.cancelPending();
  }

  clearEmergency(): void {
    this.safety.clearEmergency();
    this.state = "running";
  }

  shutdown(): void {
    this.state = "shutdown";
    this.dispatcher?.cancelPending();
    console.log("[RuntimeCore] Shutdown complete.");
  }

  // ─── Main Pipeline ─────────────────────────────────
  // This is THE method that processes all LLM output.

  /**
   * Process an AgentOutput from any LLM.
   *
   * Pipeline:
   * 1. Schema validation (Zod) — reject malformed JSON
   * 2. Safety validation per intent — reject dangerous actions
   * 3. Dispatch valid intents through ActionDispatcher
   *
   * Returns a PipelineResult with the outcome of every intent.
   */
  async processAgentOutput(rawJson: unknown): Promise<PipelineResult> {
    const startTime = Date.now();
    this.intentsReceived++;

    // ═══ STAGE 1: Schema Validation ═══
    const schemaResult = validateAgentOutput(rawJson);

    if (!schemaResult.valid || !schemaResult.data) {
      this.schemaRejections++;
      this.intentsRejected++;

      logger.intentRejected(
        { id: "__schema_fail__", type: "__invalid__" as any, target: {}, priority: 1 as const, reason: "Schema validation failed" },
        schemaResult.errors.map((e) => ({
          field: e.path,
          message: e.message,
          severity: "critical" as const,
        })),
      );

      eventBus.emit("agent", "action_failed", {
        stage: "schema_validation",
        errors: schemaResult.errors,
      });

      return {
        success: false,
        results: [],
        schemaResult,
        rejectedIntents: [],
      };
    }

    // Zod validated — safe to cast to our interface types
    const agentOutput = schemaResult.data as unknown as AgentOutput;
    const rejectedIntents: PipelineResult["rejectedIntents"] = [];
    const results: ExecutionResult[] = [];
    let hasFailures = false;

    // ═══ STAGE 2: Process Speech (pass-through, no execution) ═══
    if (agentOutput.speech) {
      eventBus.emit("agent", "decision_made", {
        speech: agentOutput.speech,
        internal_state: agentOutput.internal_state,
      });
    }

    // ═══ STAGE 3: Validate + Dispatch Each Intent ═══
    for (const intent of agentOutput.actions) {
      if (this.state === "emergency" || this.state === "shutdown") {
        rejectedIntents.push({
          intent,
          errors: [{
            field: "*",
            message: this.state === "emergency"
              ? `Runtime in emergency state: ${this.safety.getEmergencyReason()}`
              : "Runtime is shut down",
            severity: "critical",
          }],
        });
        continue;
      }

      if (this.state === "paused") {
        // Paused: don't reject, but don't execute either
        // In a full implementation, these would be queued
        continue;
      }

      // Log intent received
      logger.intentReceived(intent);
      eventBus.emit("agent", "action_started", { intent, stage: "received" });

      // Stage 3a: Schema re-validate individual intent
      if (!intent.id || !intent.type) {
        this.intentsRejected++;
        rejectedIntents.push({
          intent,
          errors: [{
            field: "intent",
            message: "Intent missing required fields (id, type)",
            severity: "critical",
          }],
        });
        continue;
      }

      // Stage 3b: Safety validation
      const validation = this.safety.validate(intent);
      if (!validation.valid) {
        this.intentsRejected++;
        this.safetyRejections++;

        logger.intentRejected(intent, validation.errors);
        eventBus.emit("system", "safety_block", {
          intent,
          errors: validation.errors,
        });

        rejectedIntents.push({ intent, errors: validation.errors });
        hasFailures = true;
        continue;
      }

      // Log safety warnings (non-blocking)
      const warnings = validation.errors.filter((e) => e.severity === "warning");
      if (warnings.length > 0) {
        logger.safetyWarning(intent, warnings);
      }

      logger.intentValidated(intent);

      // Stage 3c: Dispatch through ActionDispatcher
      if (!this.dispatcher) {
        results.push({
          actionId: intent.id,
          success: false,
          message: "No ActionDispatcher set — call setDispatcher() first",
          interrupted: false,
          timedOut: false,
        });
        hasFailures = true;
        continue;
      }

      const actionStart = Date.now();
      const result = await this.dispatcher.dispatch(intent);
      const actionDuration = Date.now() - actionStart;

      // Track stats
      this.totalLatencyMs += actionDuration;
      this.latencySamples++;

      if (result.success) {
        this.intentsApproved++;
        this.actionsCompleted++;
        logger.actionCompleted(intent, result, actionDuration);
      } else {
        this.actionsFailed++;
        if (result.timedOut) {
          this.actionsTimedOut++;
          logger.actionTimeout(intent, intent.timeout || 5000);
        } else {
          logger.actionFailed(intent, result, actionDuration);
        }
        hasFailures = true;
      }

      results.push(result);
    }

    // Track memory/task signals (Phase 5/6 implementation)
    if (agentOutput.memory_save) {
      eventBus.emit("memory", "memory_stored", {
        candidate: agentOutput.memory_save,
        source: "llm_output",
      });
    }

    if (agentOutput.task_update) {
      const update = agentOutput.task_update;
      const eventType = update.action === "fail" ? "task_failed"
        : update.action === "complete" ? "task_completed"
        : "task_started";
      eventBus.emit("agent", eventType, { taskUpdate: update });
    }

    return {
      success: !hasFailures,
      results,
      schemaResult,
      rejectedIntents,
    };
  }

  // ─── Direct Intent (single) ────────────────────────

  /**
   * Process a single pre-validated IntentAction directly.
   * Used when the intent is generated programmatically, not from an LLM.
   */
  async processIntent(intent: IntentAction): Promise<ExecutionResult> {
    return this.processAgentOutput({
      actions: [intent],
    }).then((p) => p.results[0] ?? {
      actionId: intent.id,
      success: false,
      message: "No result produced",
      interrupted: false,
      timedOut: false,
    });
  }

  // ─── Stats ─────────────────────────────────────────

  getStats(): RuntimeStats {
    return {
      state: this.state,
      intentsReceived: this.intentsReceived,
      intentsApproved: this.intentsApproved,
      intentsRejected: this.intentsRejected,
      schemaRejections: this.schemaRejections,
      safetyRejections: this.safetyRejections,
      actionsCompleted: this.actionsCompleted,
      actionsFailed: this.actionsFailed,
      actionsTimedOut: this.actionsTimedOut,
      avgLatencyMs: this.latencySamples > 0
        ? Math.round(this.totalLatencyMs / this.latencySamples)
        : 0,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
      emergencyReason: this.state === "emergency" ? this.safety.getEmergencyReason() : null,
    };
  }

  getState(): RuntimeState {
    return this.state;
  }

  isRunning(): boolean {
    return this.state === "running";
  }
}

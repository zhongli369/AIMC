import { validateAgentOutput } from "./intent-schema.js";
import { SafetyGuard } from "./safety-guard.js";
import { eventBus } from "./event-bus.js";
import { logger } from "./logger.js";
// ─── RuntimeCore ─────────────────────────────────────
export class RuntimeCore {
    safety;
    state = "init";
    startedAt = 0;
    // Stats
    intentsReceived = 0;
    intentsApproved = 0;
    intentsRejected = 0;
    schemaRejections = 0;
    safetyRejections = 0;
    actionsCompleted = 0;
    actionsFailed = 0;
    actionsTimedOut = 0;
    totalLatencyMs = 0;
    latencySamples = 0;
    constructor(safety) {
        this.safety = safety || new SafetyGuard();
    }
    // ─── Lifecycle ─────────────────────────────────────
    /** Set the bot reference on SafetyGuard (needed for state-aware safety checks). */
    setBot(bot) {
        this.safety.setBot(bot);
    }
    start() {
        this.state = "running";
        this.startedAt = Date.now();
        logger.intentReceived({ id: "__runtime_start__", type: "__system__", target: {}, priority: 1, reason: "Runtime started" });
        console.log("[RuntimeCore] Validation pipeline running — schema + safety gate active.");
    }
    pause() {
        this.state = "paused";
        console.log("[RuntimeCore] Runtime paused — validation continues but intents flagged as paused.");
    }
    resume() {
        this.state = "running";
        console.log("[RuntimeCore] Runtime resumed.");
    }
    emergencyStop(reason) {
        this.state = "emergency";
        this.safety.emergencyStop(reason);
        logger.safetyEmergency(reason);
        eventBus.emit("system", "safety_block", {
            emergency: true,
            reason,
            allActionsBlocked: true,
        });
    }
    clearEmergency() {
        this.safety.clearEmergency();
        this.state = "running";
    }
    shutdown() {
        this.state = "shutdown";
        console.log("[RuntimeCore] Shutdown complete.");
    }
    // ─── Validation Pipeline ───────────────────────────
    // This is THE method that validates all LLM output.
    // It does NOT execute — SkillRouter handles execution.
    /**
     * Validate an AgentOutput from any LLM.
     *
     * Pipeline:
     * 1. Schema validation (Zod) — reject malformed JSON
     * 2. Safety validation per intent — reject dangerous actions
     *
     * Returns a ValidationResult with the validated + safety-filtered output.
     * Execution is handled downstream by SkillRouter.
     */
    validate(rawJson) {
        const startTime = Date.now();
        this.intentsReceived++;
        // ═══ STAGE 1: Schema Validation ═══
        const schemaResult = validateAgentOutput(rawJson);
        if (!schemaResult.valid || !schemaResult.data) {
            this.schemaRejections++;
            this.intentsRejected++;
            logger.intentRejected({ id: "__schema_fail__", type: "__invalid__", target: {}, priority: 1, reason: "Schema validation failed" }, schemaResult.errors.map((e) => ({
                field: e.path,
                message: e.message,
                severity: "critical",
            })));
            eventBus.emit("agent", "action_failed", {
                stage: "schema_validation",
                errors: schemaResult.errors,
            });
            return {
                success: false,
                output: null,
                schemaResult,
                rejectedIntents: [],
                speech: undefined,
                memorySave: undefined,
                taskUpdate: undefined,
            };
        }
        // Zod validated — safe to cast to our interface types
        const agentOutput = schemaResult.data;
        const rejectedIntents = [];
        let hasFailures = false;
        // ═══ STAGE 2: Process Speech (pass-through) ═══
        if (agentOutput.speech) {
            eventBus.emit("agent", "decision_made", {
                speech: agentOutput.speech,
                internal_state: agentOutput.internal_state,
            });
        }
        // ═══ STAGE 3: Safety Validate Each Intent ═══
        const validatedActions = [];
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
                continue;
            }
            // Log intent received
            logger.intentReceived(intent);
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
            this.intentsApproved++;
            validatedActions.push(intent);
        }
        // Track latency
        const elapsed = Date.now() - startTime;
        this.totalLatencyMs += elapsed;
        this.latencySamples++;
        // Build validated output (with safety-filtered actions)
        const validatedOutput = {
            ...agentOutput,
            actions: validatedActions,
        };
        return {
            success: !hasFailures && validatedActions.length > 0,
            output: validatedOutput,
            schemaResult,
            rejectedIntents,
            speech: agentOutput.speech,
            memorySave: agentOutput.memory_save,
            taskUpdate: agentOutput.task_update,
        };
    }
    // ─── Stats ─────────────────────────────────────────
    /** Record an action completion (called externally by SkillRouter after dispatch). */
    recordActionCompleted(latencyMs) {
        this.actionsCompleted++;
        this.totalLatencyMs += latencyMs;
        this.latencySamples++;
    }
    /** Record an action failure (called externally by SkillRouter after dispatch). */
    recordActionFailed(timedOut) {
        this.actionsFailed++;
        if (timedOut)
            this.actionsTimedOut++;
    }
    getStats() {
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
    getState() {
        return this.state;
    }
    isRunning() {
        return this.state === "running";
    }
}
//# sourceMappingURL=runtime-core.js.map
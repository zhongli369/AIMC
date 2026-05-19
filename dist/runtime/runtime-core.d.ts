/**
 * RuntimeCore — validation gate for the AIMC runtime pipeline.
 *
 * Pipeline: AgentOutput JSON → Schema Validation → SafetyGuard → ValidatedOutput
 *
 * RuntimeCore ONLY validates. It does NOT execute actions.
 * All execution flows through SkillRouter → ActionDispatcher → Mineflayer.
 *
 * This is the ONLY entry point for LLM outputs to be validated.
 * No LLM may bypass schema + safety validation.
 */
import type { AgentOutput, IntentAction, ValidationError } from "../interfaces/intent.js";
import { type SchemaValidationResult } from "./intent-schema.js";
import { SafetyGuard } from "./safety-guard.js";
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
export interface ValidationResult {
    success: boolean;
    /** Validated + safety-filtered AgentOutput (null if schema failed) */
    output: AgentOutput | null;
    schemaResult: SchemaValidationResult;
    /** Intents that failed safety validation */
    rejectedIntents: {
        intent: IntentAction;
        errors: ValidationError[];
    }[];
    /** Speech extracted from output (pass-through even if no actions) */
    speech: AgentOutput["speech"];
    /** Memory save candidate from LLM output */
    memorySave: AgentOutput["memory_save"];
    /** Task update from LLM output */
    taskUpdate: AgentOutput["task_update"];
}
export declare class RuntimeCore {
    private safety;
    private state;
    private startedAt;
    private intentsReceived;
    private intentsApproved;
    private intentsRejected;
    private schemaRejections;
    private safetyRejections;
    private actionsCompleted;
    private actionsFailed;
    private actionsTimedOut;
    private totalLatencyMs;
    private latencySamples;
    constructor(safety?: SafetyGuard);
    /** Set the bot reference on SafetyGuard (needed for state-aware safety checks). */
    setBot(bot: any): void;
    start(): void;
    pause(): void;
    resume(): void;
    emergencyStop(reason: string): void;
    clearEmergency(): void;
    shutdown(): void;
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
    validate(rawJson: unknown): ValidationResult;
    /** Record an action completion (called externally by SkillRouter after dispatch). */
    recordActionCompleted(latencyMs: number): void;
    /** Record an action failure (called externally by SkillRouter after dispatch). */
    recordActionFailed(timedOut: boolean): void;
    getStats(): RuntimeStats;
    getState(): RuntimeState;
    isRunning(): boolean;
}
//# sourceMappingURL=runtime-core.d.ts.map
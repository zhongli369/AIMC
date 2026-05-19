/**
 * RuntimeCore — central orchestrator for the AIMC runtime pipeline.
 *
 * Pipeline: AgentOutput JSON → Schema Validation → SafetyGuard → ActionDispatcher → Results
 *
 * This is the ONLY entry point for LLM outputs to reach Minecraft actions.
 * No LLM may bypass this pipeline.
 */
import type { IntentAction, ExecutionResult, ValidationError } from "../interfaces/intent.js";
import { type SchemaValidationResult } from "./intent-schema.js";
import { SafetyGuard } from "./safety-guard.js";
import { ActionDispatcher } from "./action-dispatcher.js";
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
export interface PipelineResult {
    success: boolean;
    results: ExecutionResult[];
    schemaResult: SchemaValidationResult;
    rejectedIntents: {
        intent: IntentAction;
        errors: ValidationError[];
    }[];
}
export declare class RuntimeCore {
    private safety;
    private dispatcher;
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
    setDispatcher(dispatcher: ActionDispatcher): void;
    start(): void;
    pause(): void;
    resume(): void;
    emergencyStop(reason: string): void;
    clearEmergency(): void;
    shutdown(): void;
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
    processAgentOutput(rawJson: unknown): Promise<PipelineResult>;
    /**
     * Process a single pre-validated IntentAction directly.
     * Used when the intent is generated programmatically, not from an LLM.
     */
    processIntent(intent: IntentAction): Promise<ExecutionResult>;
    getStats(): RuntimeStats;
    getState(): RuntimeState;
    isRunning(): boolean;
}
//# sourceMappingURL=runtime-core.d.ts.map
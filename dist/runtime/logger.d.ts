/**
 * StructuredLogger — JSON observability for the runtime pipeline.
 * Tracks: intent flow, safety rejections, action execution, latency.
 */
import type { IntentAction, ExecutionResult, ValidationError } from "../interfaces/intent.js";
export interface IntentLogEntry {
    ts: string;
    level: "info" | "warn" | "error";
    stage: "intent_received" | "intent_validated" | "intent_rejected";
    intentId: string;
    intentType: string;
    details?: unknown;
}
export interface SafetyLogEntry {
    ts: string;
    level: "warn" | "error" | "critical";
    stage: "safety_blocked" | "safety_warning" | "safety_emergency";
    intentId?: string;
    intentType?: string;
    errors: {
        field: string;
        message: string;
        severity: string;
    }[];
    emergencyReason?: string;
}
export interface ActionLogEntry {
    ts: string;
    level: "info" | "warn" | "error";
    stage: "action_started" | "action_completed" | "action_failed" | "action_retry" | "action_timeout";
    actionId: string;
    actionType: string;
    durationMs?: number;
    attempt?: number;
    willRetry?: boolean;
    error?: string;
}
export declare class StructuredLogger {
    private buffer;
    private maxBuffer;
    private logToConsole;
    private logToFile;
    private filePath;
    constructor(options?: {
        logToConsole?: boolean;
        logToFile?: string;
    });
    intentReceived(intent: IntentAction): void;
    intentValidated(intent: IntentAction): void;
    intentRejected(intent: IntentAction, errors: ValidationError[]): void;
    safetyBlocked(intent: IntentAction | null, errors: ValidationError[]): void;
    safetyWarning(intent: IntentAction, errors: ValidationError[]): void;
    safetyEmergency(reason: string): void;
    actionStarted(intent: IntentAction): void;
    actionCompleted(intent: IntentAction, result: ExecutionResult, durationMs: number): void;
    actionFailed(intent: IntentAction, result: ExecutionResult, durationMs: number, attempt?: number): void;
    actionRetry(intent: IntentAction, attempt: number, delayMs: number): void;
    actionTimeout(intent: IntentAction, timeoutMs: number): void;
    private write;
    private formatDetail;
    getRecent(limit?: number): (IntentLogEntry | SafetyLogEntry | ActionLogEntry)[];
    getByIntentId(intentId: string): (IntentLogEntry | SafetyLogEntry | ActionLogEntry)[];
    getFailures(): ActionLogEntry[];
    getSafetyBlocks(): SafetyLogEntry[];
    clearBuffer(): void;
    exportJSON(): string;
}
export declare const logger: StructuredLogger;
//# sourceMappingURL=logger.d.ts.map
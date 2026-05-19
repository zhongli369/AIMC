// ─── Logger ──────────────────────────────────────────
export class StructuredLogger {
    buffer = [];
    maxBuffer = 1000;
    logToConsole = true;
    logToFile = false;
    filePath = null;
    constructor(options) {
        if (options?.logToConsole !== undefined)
            this.logToConsole = options.logToConsole;
        if (options?.logToFile) {
            this.logToFile = true;
            this.filePath = options.logToFile;
        }
    }
    // ─── Intent Logging ────────────────────────────────
    intentReceived(intent) {
        this.write({
            ts: new Date().toISOString(),
            level: "info",
            stage: "intent_received",
            intentId: intent.id,
            intentType: intent.type,
            details: {
                priority: intent.priority,
                reason: intent.reason,
                cancelable: intent.cancelable,
            },
        });
    }
    intentValidated(intent) {
        this.write({
            ts: new Date().toISOString(),
            level: "info",
            stage: "intent_validated",
            intentId: intent.id,
            intentType: intent.type,
        });
    }
    intentRejected(intent, errors) {
        this.write({
            ts: new Date().toISOString(),
            level: "warn",
            stage: "intent_rejected",
            intentId: intent.id,
            intentType: intent.type,
            details: {
                errorCount: errors.length,
                errors: errors.map((e) => ({ field: e.field, message: e.message, severity: e.severity })),
            },
        });
    }
    // ─── Safety Logging ────────────────────────────────
    safetyBlocked(intent, errors) {
        this.write({
            ts: new Date().toISOString(),
            level: errors.some((e) => e.severity === "critical") ? "critical" : "error",
            stage: "safety_blocked",
            intentId: intent?.id,
            intentType: intent?.type,
            errors: errors.map((e) => ({ field: e.field, message: e.message, severity: e.severity })),
        });
    }
    safetyWarning(intent, errors) {
        this.write({
            ts: new Date().toISOString(),
            level: "warn",
            stage: "safety_warning",
            intentId: intent.id,
            intentType: intent.type,
            errors: errors.map((e) => ({ field: e.field, message: e.message, severity: e.severity })),
        });
    }
    safetyEmergency(reason) {
        this.write({
            ts: new Date().toISOString(),
            level: "critical",
            stage: "safety_emergency",
            errors: [{ field: "*", message: reason, severity: "critical" }],
            emergencyReason: reason,
        });
    }
    // ─── Action Logging ────────────────────────────────
    actionStarted(intent) {
        this.write({
            ts: new Date().toISOString(),
            level: "info",
            stage: "action_started",
            actionId: intent.id,
            actionType: intent.type,
        });
    }
    actionCompleted(intent, result, durationMs) {
        this.write({
            ts: new Date().toISOString(),
            level: "info",
            stage: "action_completed",
            actionId: intent.id,
            actionType: intent.type,
            durationMs,
        });
    }
    actionFailed(intent, result, durationMs, attempt) {
        this.write({
            ts: new Date().toISOString(),
            level: "error",
            stage: "action_failed",
            actionId: intent.id,
            actionType: intent.type,
            durationMs,
            attempt,
            error: result.message,
        });
    }
    actionRetry(intent, attempt, delayMs) {
        this.write({
            ts: new Date().toISOString(),
            level: "warn",
            stage: "action_retry",
            actionId: intent.id,
            actionType: intent.type,
            attempt,
            willRetry: true,
            durationMs: delayMs,
        });
    }
    actionTimeout(intent, timeoutMs) {
        this.write({
            ts: new Date().toISOString(),
            level: "error",
            stage: "action_timeout",
            actionId: intent.id,
            actionType: intent.type,
            durationMs: timeoutMs,
        });
    }
    // ─── Buffer Management ─────────────────────────────
    write(entry) {
        this.buffer.push(entry);
        if (this.buffer.length > this.maxBuffer) {
            this.buffer.shift();
        }
        if (this.logToConsole) {
            const prefix = `[${entry.level.toUpperCase()}] ${entry.stage}`;
            const detail = this.formatDetail(entry);
            const method = entry.level === "error" || entry.level === "critical"
                ? console.error
                : entry.level === "warn"
                    ? console.warn
                    : console.log;
            method(`${prefix} ${detail}`);
        }
    }
    formatDetail(entry) {
        switch (entry.stage) {
            case "intent_received":
            case "intent_validated":
                return `${entry.intentType} (id=${entry.intentId})`;
            case "intent_rejected":
                return `${entry.intentType} (id=${entry.intentId})`;
            case "safety_blocked":
            case "safety_warning":
                return `${entry.intentType ?? "?"} — ${entry.errors.map(e => e.message).join("; ")}`;
            case "safety_emergency":
                return `EMERGENCY: ${entry.emergencyReason}`;
            case "action_started":
                return `${entry.actionType} (id=${entry.actionId})`;
            case "action_completed":
                return `${entry.actionType} (id=${entry.actionId}) ${entry.durationMs}ms`;
            case "action_failed":
                return `${entry.actionType} (id=${entry.actionId}) ${entry.durationMs}ms — ${entry.error}`;
            case "action_retry":
                return `${entry.actionType} (id=${entry.actionId}) attempt=${entry.attempt} retry in ${entry.durationMs}ms`;
            case "action_timeout":
                return `${entry.actionType} (id=${entry.actionId}) timeout after ${entry.durationMs}ms`;
            default:
                return "";
        }
    }
    // ─── Query / Export ────────────────────────────────
    getRecent(limit = 100) {
        return this.buffer.slice(-limit);
    }
    getByIntentId(intentId) {
        return this.buffer.filter((e) => {
            if ("intentId" in e && e.intentId === intentId)
                return true;
            if ("actionId" in e && e.actionId === intentId)
                return true;
            return false;
        });
    }
    getFailures() {
        return this.buffer.filter((e) => e.stage === "action_failed" || e.stage === "action_timeout");
    }
    getSafetyBlocks() {
        return this.buffer.filter((e) => e.stage === "safety_blocked" || e.stage === "safety_emergency");
    }
    clearBuffer() {
        this.buffer = [];
    }
    exportJSON() {
        return JSON.stringify(this.buffer, null, 2);
    }
}
// Singleton
export const logger = new StructuredLogger();
//# sourceMappingURL=logger.js.map
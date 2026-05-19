/**
 * BehaviorTimeline — chronological record of ALL decisions (Phase 6).
 *
 * Append-only event log for behavioral auditing and replay.
 * Max 5000 entries, auto-prunes oldest.
 *
 * PURE OBSERVABILITY — NO behavior change, NO decision influence.
 */
import { randomUUID } from "node:crypto";
// ─── Timeline ────────────────────────────────────────────
export class BehaviorTimeline {
    entries = [];
    maxEntries;
    totalRecorded = 0;
    constructor(maxEntries = 5000) {
        this.maxEntries = maxEntries;
    }
    /**
     * Record a timeline event.
     * Non-blocking, never throws, auto-prunes oldest.
     */
    record(eventType, summary, detail, traceSessionId) {
        const entry = {
            entryId: randomUUID(),
            timestamp: Date.now(),
            eventType,
            summary,
            detail,
            traceSessionId,
            severity: eventType.includes("failed") || eventType.includes("stuck")
                ? "warn"
                : eventType.includes("complete") || eventType.includes("exit")
                    ? "info"
                    : "debug",
        };
        this.entries.push(entry);
        this.totalRecorded++;
        // Auto-prune oldest
        if (this.entries.length > this.maxEntries) {
            this.entries = this.entries.slice(-this.maxEntries);
        }
        return entry;
    }
    /** Convenience shorthand methods. */
    skillStart(skillName, params, traceId) {
        return this.record("skill_start", `Skill "${skillName}" started`, {
            skillName, ...params,
        }, traceId);
    }
    skillComplete(skillName, durationMs, traceId) {
        return this.record("skill_complete", `Skill "${skillName}" completed`, {
            skillName, durationMs,
        }, traceId);
    }
    skillFailed(skillName, error, traceId) {
        return this.record("skill_failed", `Skill "${skillName}" failed`, {
            skillName, error,
        }, traceId);
    }
    fallbackTriggered(fromSkill, toSkill, reason, traceId) {
        return this.record("fallback_triggered", `Fallback: "${fromSkill}" → "${toSkill}"`, {
            fromSkill, toSkill, reason,
        }, traceId);
    }
    safeModeEnter(reason, traceId) {
        return this.record("safe_mode_enter", `Safe mode entered: ${reason}`, { reason }, traceId);
    }
    safeModeExit(durationMs, traceId) {
        return this.record("safe_mode_exit", "Safe mode exited", { durationMs }, traceId);
    }
    loopDetected(actionType, count, traceId) {
        return this.record("loop_detected", `Action loop: ${actionType} × ${count}`, {
            actionType, repeatCount: count,
        }, traceId);
    }
    stuckRecovery(action, stuckDurationMs, traceId) {
        return this.record("stuck_recovery", `Stuck recovery: ${action}`, {
            recoveryAction: action, stuckDurationMs,
        }, traceId);
    }
    arbitrationOverride(rule, suppressedCount, traceId) {
        return this.record("arbitration_override", `Arbitration: ${rule}`, {
            rule, suppressedCount,
        }, traceId);
    }
    /** Query entries by type, time range, or keyword. */
    query(params) {
        let result = this.entries;
        if (params.eventType) {
            result = result.filter((e) => e.eventType === params.eventType);
        }
        const since = params.since;
        const until = params.until;
        if (since !== undefined) {
            result = result.filter((e) => e.timestamp >= since);
        }
        if (until !== undefined) {
            result = result.filter((e) => e.timestamp <= until);
        }
        if (params.keyword) {
            const kw = params.keyword.toLowerCase();
            result = result.filter((e) => e.summary.toLowerCase().includes(kw) ||
                JSON.stringify(e.detail || {}).toLowerCase().includes(kw));
        }
        return result.slice(-(params.limit ?? 100));
    }
    /** Get all entries. */
    getAll(limit) {
        return this.entries.slice(-(limit ?? 500));
    }
    /** Get recent entries (last N ms). */
    getRecent(ms) {
        const cutoff = Date.now() - ms;
        return this.entries.filter((e) => e.timestamp >= cutoff);
    }
    /** Export all timeline data. */
    export() {
        return {
            entries: [...this.entries],
            totalRecorded: this.totalRecorded,
            exportedAt: Date.now(),
        };
    }
    /** Reset timeline. */
    reset() {
        this.entries = [];
        this.totalRecorded = 0;
    }
    /** Entry count. */
    get count() {
        return this.entries.length;
    }
}
//# sourceMappingURL=behavior-timeline.js.map
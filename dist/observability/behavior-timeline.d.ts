/**
 * BehaviorTimeline — chronological record of ALL decisions (Phase 6).
 *
 * Append-only event log for behavioral auditing and replay.
 * Max 5000 entries, auto-prunes oldest.
 *
 * PURE OBSERVABILITY — NO behavior change, NO decision influence.
 */
export type TimelineEventType = "skill_start" | "skill_complete" | "skill_failed" | "fallback_triggered" | "safe_mode_enter" | "safe_mode_exit" | "loop_detected" | "stuck_recovery" | "arbitration_override" | "plan_step_start" | "plan_step_complete" | "plan_step_failed" | "voice_pressure_change" | "tactical_change" | "role_switch" | "cooldown_active" | "skill_disabled" | "skill_reenabled" | "chat_sent" | "proactive_action" | "heuristic_fast_path" | "recovery_watchdog" | "agent_state_change";
export interface TimelineEntry {
    entryId: string;
    timestamp: number;
    eventType: TimelineEventType;
    /** Human-readable summary */
    summary: string;
    /** Optional structured detail */
    detail?: Record<string, unknown>;
    /** Related trace session ID */
    traceSessionId?: string;
    /** Optional severity for filtering */
    severity?: "debug" | "info" | "warn";
}
export declare class BehaviorTimeline {
    private entries;
    private maxEntries;
    private totalRecorded;
    constructor(maxEntries?: number);
    /**
     * Record a timeline event.
     * Non-blocking, never throws, auto-prunes oldest.
     */
    record(eventType: TimelineEventType, summary: string, detail?: Record<string, unknown>, traceSessionId?: string): TimelineEntry;
    /** Convenience shorthand methods. */
    skillStart(skillName: string, params?: Record<string, unknown>, traceId?: string): TimelineEntry;
    skillComplete(skillName: string, durationMs?: number, traceId?: string): TimelineEntry;
    skillFailed(skillName: string, error?: string, traceId?: string): TimelineEntry;
    fallbackTriggered(fromSkill: string, toSkill: string, reason?: string, traceId?: string): TimelineEntry;
    safeModeEnter(reason: string, traceId?: string): TimelineEntry;
    safeModeExit(durationMs?: number, traceId?: string): TimelineEntry;
    loopDetected(actionType: string, count: number, traceId?: string): TimelineEntry;
    stuckRecovery(action: string, stuckDurationMs?: number, traceId?: string): TimelineEntry;
    arbitrationOverride(rule: string, suppressedCount: number, traceId?: string): TimelineEntry;
    /** Query entries by type, time range, or keyword. */
    query(params: {
        eventType?: TimelineEventType;
        since?: number;
        until?: number;
        keyword?: string;
        limit?: number;
    }): TimelineEntry[];
    /** Get all entries. */
    getAll(limit?: number): TimelineEntry[];
    /** Get recent entries (last N ms). */
    getRecent(ms: number): TimelineEntry[];
    /** Export all timeline data. */
    export(): {
        entries: TimelineEntry[];
        totalRecorded: number;
        exportedAt: number;
    };
    /** Reset timeline. */
    reset(): void;
    /** Entry count. */
    get count(): number;
}
//# sourceMappingURL=behavior-timeline.d.ts.map
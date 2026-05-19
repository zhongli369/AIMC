/**
 * EventCollector — central non-intrusive event sink (Phase 6).
 *
 * Single collection point for all observability data:
 *   - RuntimeTrace sessions
 *   - Timeline entries
 *   - Health metrics snapshots
 *
 * Async-only, non-blocking, NEVER throws, NEVER blocks execution.
 *
 * PURE OBSERVABILITY — NO behavior change, NO decision influence.
 */
import type { TraceSession } from "./runtime-trace.js";
import type { TimelineEntry } from "./behavior-timeline.js";
import type { SystemHealthSnapshot } from "./system-health.js";
export type CollectedEvent = {
    type: "trace_session";
    data: TraceSession;
} | {
    type: "timeline_entry";
    data: TimelineEntry;
} | {
    type: "health_snapshot";
    data: SystemHealthSnapshot;
} | {
    type: "export_request";
    data: {
        format: "json";
        requestedAt: number;
    };
    resolve: (result: unknown) => void;
};
export interface CollectorConfig {
    /** Max stored trace sessions */
    maxTraceSessions: number;
    /** Max stored timeline entries */
    maxTimelineEntries: number;
    /** Auto-flush interval (ms), 0 = disabled */
    autoFlushIntervalMs: number;
}
export declare class EventCollector {
    private config;
    private traceSessions;
    private timelineEntries;
    private healthSnapshots;
    private maxHealthSnapshots;
    private errorCount;
    private droppedCount;
    constructor(config?: Partial<CollectorConfig>);
    /**
     * Ingest a trace session.
     * Non-blocking. Never throws.
     */
    ingestTraceSession(session: TraceSession): void;
    /**
     * Ingest a timeline entry.
     * Non-blocking. Never throws.
     */
    ingestTimelineEntry(entry: TimelineEntry): void;
    /**
     * Ingest a health snapshot.
     * Non-blocking. Never throws.
     */
    ingestHealthSnapshot(snapshot: SystemHealthSnapshot): void;
    /**
     * Ingest a batch of events.
     * Non-blocking. Never throws.
     */
    ingestBatch(events: CollectedEvent[]): void;
    /** Get all stored trace sessions. */
    getTraceSessions(limit?: number): TraceSession[];
    /** Get all stored timeline entries. */
    getTimelineEntries(limit?: number): TimelineEntry[];
    /** Get health snapshots. */
    getHealthSnapshots(limit?: number): SystemHealthSnapshot[];
    /** Get the latest health snapshot. */
    getLatestHealth(): SystemHealthSnapshot | null;
    /** Export all collected data. */
    exportAll(): {
        traceSessions: TraceSession[];
        timelineEntries: TimelineEntry[];
        healthSnapshots: SystemHealthSnapshot[];
        stats: {
            errorCount: number;
            droppedCount: number;
        };
        exportedAt: number;
    };
    /** Get collector statistics. */
    getStats(): {
        traceSessionCount: number;
        timelineEntryCount: number;
        healthSnapshotCount: number;
        errorCount: number;
        droppedCount: number;
    };
    /** Reset all collected data. */
    reset(): void;
    /** Get count of total entries stored. */
    get totalEntries(): number;
}
export declare function getEventCollector(config?: Partial<CollectorConfig>): EventCollector;
export declare function resetEventCollector(): void;
//# sourceMappingURL=event-collector.d.ts.map
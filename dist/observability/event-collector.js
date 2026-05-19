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
const DEFAULT_CONFIG = {
    maxTraceSessions: 50,
    maxTimelineEntries: 5000,
    autoFlushIntervalMs: 0,
};
// ─── Collector ───────────────────────────────────────────
export class EventCollector {
    config;
    traceSessions = [];
    timelineEntries = [];
    healthSnapshots = [];
    maxHealthSnapshots = 200;
    errorCount = 0;
    droppedCount = 0;
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Ingest a trace session.
     * Non-blocking. Never throws.
     */
    ingestTraceSession(session) {
        try {
            this.traceSessions.push(session);
            if (this.traceSessions.length > this.config.maxTraceSessions) {
                this.traceSessions = this.traceSessions.slice(-this.config.maxTraceSessions);
            }
        }
        catch {
            this.errorCount++;
        }
    }
    /**
     * Ingest a timeline entry.
     * Non-blocking. Never throws.
     */
    ingestTimelineEntry(entry) {
        try {
            this.timelineEntries.push(entry);
            if (this.timelineEntries.length > this.config.maxTimelineEntries) {
                this.timelineEntries = this.timelineEntries.slice(-this.config.maxTimelineEntries);
            }
        }
        catch {
            this.errorCount++;
        }
    }
    /**
     * Ingest a health snapshot.
     * Non-blocking. Never throws.
     */
    ingestHealthSnapshot(snapshot) {
        try {
            this.healthSnapshots.push(snapshot);
            if (this.healthSnapshots.length > this.maxHealthSnapshots) {
                this.healthSnapshots = this.healthSnapshots.slice(-this.maxHealthSnapshots);
            }
        }
        catch {
            this.errorCount++;
        }
    }
    /**
     * Ingest a batch of events.
     * Non-blocking. Never throws.
     */
    ingestBatch(events) {
        for (const event of events) {
            switch (event.type) {
                case "trace_session":
                    this.ingestTraceSession(event.data);
                    break;
                case "timeline_entry":
                    this.ingestTimelineEntry(event.data);
                    break;
                case "health_snapshot":
                    this.ingestHealthSnapshot(event.data);
                    break;
                case "export_request":
                    try {
                        event.resolve(this.exportAll());
                    }
                    catch {
                        event.resolve({ error: "export_failed", errorCount: ++this.errorCount });
                    }
                    break;
            }
        }
    }
    /** Get all stored trace sessions. */
    getTraceSessions(limit) {
        try {
            return this.traceSessions.slice(-(limit ?? 50));
        }
        catch {
            return [];
        }
    }
    /** Get all stored timeline entries. */
    getTimelineEntries(limit) {
        try {
            return this.timelineEntries.slice(-(limit ?? 500));
        }
        catch {
            return [];
        }
    }
    /** Get health snapshots. */
    getHealthSnapshots(limit) {
        try {
            return this.healthSnapshots.slice(-(limit ?? 50));
        }
        catch {
            return [];
        }
    }
    /** Get the latest health snapshot. */
    getLatestHealth() {
        return this.healthSnapshots[this.healthSnapshots.length - 1] ?? null;
    }
    /** Export all collected data. */
    exportAll() {
        return {
            traceSessions: [...this.traceSessions],
            timelineEntries: [...this.timelineEntries],
            healthSnapshots: [...this.healthSnapshots],
            stats: {
                errorCount: this.errorCount,
                droppedCount: this.droppedCount,
            },
            exportedAt: Date.now(),
        };
    }
    /** Get collector statistics. */
    getStats() {
        return {
            traceSessionCount: this.traceSessions.length,
            timelineEntryCount: this.timelineEntries.length,
            healthSnapshotCount: this.healthSnapshots.length,
            errorCount: this.errorCount,
            droppedCount: this.droppedCount,
        };
    }
    /** Reset all collected data. */
    reset() {
        this.traceSessions = [];
        this.timelineEntries = [];
        this.healthSnapshots = [];
        this.errorCount = 0;
        this.droppedCount = 0;
    }
    /** Get count of total entries stored. */
    get totalEntries() {
        return this.traceSessions.length + this.timelineEntries.length + this.healthSnapshots.length;
    }
}
// ─── Singleton ───────────────────────────────────────────
let _collector = null;
export function getEventCollector(config) {
    if (!_collector) {
        _collector = new EventCollector(config);
    }
    return _collector;
}
export function resetEventCollector() {
    _collector?.reset();
    _collector = null;
}
//# sourceMappingURL=event-collector.js.map
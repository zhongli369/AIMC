/**
 * Exporter — visualization data export layer (Phase 6).
 *
 * Exports observability data for UI consumption:
 *   - JSON snapshot (full state dump)
 *   - Timeline dump (behavior history)
 *   - Trace replay file (single session playback)
 *   - Health report (current + historical)
 *
 * PURE OBSERVABILITY — NO behavior change, NO decision influence.
 */
import type { EventCollector } from "./event-collector.js";
import type { TraceSession } from "./runtime-trace.js";
import type { TimelineEntry } from "./behavior-timeline.js";
import type { SystemHealthSnapshot } from "./system-health.js";
export type ExportFormat = "json" | "compact";
export interface ExportResult {
    exportId: string;
    format: ExportFormat;
    exportedAt: number;
    data: unknown;
    dataSizeBytes: number;
}
/**
 * Full system state snapshot — all observability data at one point in time.
 */
export interface ObservabilitySnapshot {
    snapshotId: string;
    timestamp: number;
    traceSessions: TraceSession[];
    timelineEntries: TimelineEntry[];
    healthSnapshots: SystemHealthSnapshot[];
    latestHealth: SystemHealthSnapshot | null;
    stats: Record<string, unknown>;
}
export declare class ObservabilityExporter {
    private collector;
    constructor(collector: EventCollector);
    /**
     * Export full JSON snapshot — suitable for UI panels.
     */
    exportSnapshot(): ExportResult;
    /**
     * Export compact summary — key metrics only.
     */
    exportCompact(): ExportResult;
    /**
     * Export a single trace session as a replay file.
     */
    exportTraceReplay(sessionId: string): ExportResult | null;
    /**
     * Export health history — all snapshots for trend visualization.
     */
    exportHealthHistory(): ExportResult;
    /**
     * Export timeline as a flat JSON array for chart rendering.
     */
    exportTimelineDump(eventType?: string, limit?: number): ExportResult;
    /**
     * Run a full health check and return a report string.
     */
    healthReport(): string;
    private computeTrend;
}
//# sourceMappingURL=exporter.d.ts.map
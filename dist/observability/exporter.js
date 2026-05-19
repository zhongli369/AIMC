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
import { randomUUID } from "node:crypto";
// ─── Exporter ────────────────────────────────────────────
export class ObservabilityExporter {
    collector;
    constructor(collector) {
        this.collector = collector;
    }
    /**
     * Export full JSON snapshot — suitable for UI panels.
     */
    exportSnapshot() {
        const raw = this.collector.exportAll();
        const snapshot = {
            snapshotId: randomUUID(),
            timestamp: Date.now(),
            traceSessions: raw.traceSessions,
            timelineEntries: raw.timelineEntries,
            healthSnapshots: raw.healthSnapshots,
            latestHealth: raw.healthSnapshots[raw.healthSnapshots.length - 1] ?? null,
            stats: raw.stats,
        };
        const json = JSON.stringify(snapshot);
        return {
            exportId: snapshot.snapshotId,
            format: "json",
            exportedAt: Date.now(),
            data: snapshot,
            dataSizeBytes: json.length,
        };
    }
    /**
     * Export compact summary — key metrics only.
     */
    exportCompact() {
        const h = this.collector.getLatestHealth();
        const stats = this.collector.getStats();
        const compact = {
            exportId: randomUUID(),
            exportedAt: Date.now(),
            health: h,
            stats,
            recentTimeline: this.collector.getTimelineEntries(50),
        };
        const json = JSON.stringify(compact);
        return {
            exportId: compact.exportId,
            format: "compact",
            exportedAt: Date.now(),
            data: compact,
            dataSizeBytes: json.length,
        };
    }
    /**
     * Export a single trace session as a replay file.
     */
    exportTraceReplay(sessionId) {
        const sessions = this.collector.getTraceSessions(100);
        const session = sessions.find((s) => s.sessionId === sessionId);
        if (!session)
            return null;
        const replay = {
            replayId: randomUUID(),
            exportedAt: Date.now(),
            session,
            replayInstructions: "Play events in timestamp order. Each event.stage indicates the pipeline stage.",
        };
        const json = JSON.stringify(replay);
        return {
            exportId: replay.replayId,
            format: "json",
            exportedAt: Date.now(),
            data: replay,
            dataSizeBytes: json.length,
        };
    }
    /**
     * Export health history — all snapshots for trend visualization.
     */
    exportHealthHistory() {
        const snapshots = this.collector.getHealthSnapshots(200);
        const history = {
            exportId: randomUUID(),
            exportedAt: Date.now(),
            snapshots,
            trend: this.computeTrend(snapshots),
        };
        const json = JSON.stringify(history);
        return {
            exportId: history.exportId,
            format: "json",
            exportedAt: Date.now(),
            data: history,
            dataSizeBytes: json.length,
        };
    }
    /**
     * Export timeline as a flat JSON array for chart rendering.
     */
    exportTimelineDump(eventType, limit) {
        let entries = this.collector.getTimelineEntries(limit ?? 1000);
        if (eventType) {
            entries = entries.filter((e) => e.eventType === eventType);
        }
        const dump = {
            exportId: randomUUID(),
            exportedAt: Date.now(),
            entries,
            count: entries.length,
        };
        const json = JSON.stringify(dump);
        return {
            exportId: dump.exportId,
            format: "json",
            exportedAt: Date.now(),
            data: dump,
            dataSizeBytes: json.length,
        };
    }
    /**
     * Run a full health check and return a report string.
     */
    healthReport() {
        const h = this.collector.getLatestHealth();
        const stats = this.collector.getStats();
        if (!h)
            return "[Observability] No health data yet.";
        const lines = [
            `=== AIMC System Health Report ===`,
            `State:     ${h.currentState.toUpperCase()}`,
            `Uptime:    ${(h.uptimeMs / 1000).toFixed(0)}s`,
            `Ticks:     ${h.totalTicks} | Actions: ${h.totalActions} | Skills: ${h.totalSkills}`,
            `Stuck:     ${(h.stuckRate * 100).toFixed(1)}% | ` +
                `Loop: ${(h.loopRate * 100).toFixed(1)}% | ` +
                `Success: ${(h.skillSuccessRate * 100).toFixed(0)}% | ` +
                `Fallback: ${(h.fallbackRate * 100).toFixed(1)}%`,
            `Latency:   ${h.avgDecisionLatencyMs.toFixed(0)}ms avg`,
            `Storage:   ${stats.traceSessionCount} sessions | ` +
                `${stats.timelineEntryCount} timeline | ` +
                `${stats.healthSnapshotCount} health`,
            stats.errorCount > 0 ? `Errors:    ${stats.errorCount} (collector errors)` : null,
            `=================================`,
        ];
        return lines.filter(Boolean).join("\n");
    }
    // ─── Internal ──────────────────────────────────────────
    computeTrend(snapshots) {
        if (snapshots.length < 3) {
            return { stuckRateTrend: "stable", successRateTrend: "stable" };
        }
        const recent = snapshots.slice(-10);
        const firstHalf = recent.slice(0, 5);
        const secondHalf = recent.slice(-5);
        const avgFirstStuck = firstHalf.reduce((s, h) => s + h.stuckRate, 0) / firstHalf.length;
        const avgSecondStuck = secondHalf.reduce((s, h) => s + h.stuckRate, 0) / secondHalf.length;
        const avgFirstSuccess = firstHalf.reduce((s, h) => s + h.skillSuccessRate, 0) / firstHalf.length;
        const avgSecondSuccess = secondHalf.reduce((s, h) => s + h.skillSuccessRate, 0) / secondHalf.length;
        const stuckDiff = avgSecondStuck - avgFirstStuck;
        const successDiff = avgSecondSuccess - avgFirstSuccess;
        return {
            stuckRateTrend: stuckDiff > 0.02 ? "degrading" : stuckDiff < -0.02 ? "improving" : "stable",
            successRateTrend: successDiff > 0.02 ? "improving" : successDiff < -0.02 ? "degrading" : "stable",
        };
    }
}
//# sourceMappingURL=exporter.js.map
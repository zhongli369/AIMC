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

// ─── Collected Event Types ───────────────────────────────

export type CollectedEvent =
  | { type: "trace_session"; data: TraceSession }
  | { type: "timeline_entry"; data: TimelineEntry }
  | { type: "health_snapshot"; data: SystemHealthSnapshot }
  | { type: "export_request"; data: { format: "json"; requestedAt: number }; resolve: (result: unknown) => void };

// ─── Collector Config ────────────────────────────────────

export interface CollectorConfig {
  /** Max stored trace sessions */
  maxTraceSessions: number;
  /** Max stored timeline entries */
  maxTimelineEntries: number;
  /** Auto-flush interval (ms), 0 = disabled */
  autoFlushIntervalMs: number;
}

const DEFAULT_CONFIG: CollectorConfig = {
  maxTraceSessions: 50,
  maxTimelineEntries: 5000,
  autoFlushIntervalMs: 0,
};

// ─── Collector ───────────────────────────────────────────

export class EventCollector {
  private config: CollectorConfig;
  private traceSessions: TraceSession[] = [];
  private timelineEntries: TimelineEntry[] = [];
  private healthSnapshots: SystemHealthSnapshot[] = [];
  private maxHealthSnapshots = 200;
  private errorCount = 0;
  private droppedCount = 0;

  constructor(config?: Partial<CollectorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Ingest a trace session.
   * Non-blocking. Never throws.
   */
  ingestTraceSession(session: TraceSession): void {
    try {
      this.traceSessions.push(session);
      if (this.traceSessions.length > this.config.maxTraceSessions) {
        this.traceSessions = this.traceSessions.slice(-this.config.maxTraceSessions);
      }
    } catch {
      this.errorCount++;
    }
  }

  /**
   * Ingest a timeline entry.
   * Non-blocking. Never throws.
   */
  ingestTimelineEntry(entry: TimelineEntry): void {
    try {
      this.timelineEntries.push(entry);
      if (this.timelineEntries.length > this.config.maxTimelineEntries) {
        this.timelineEntries = this.timelineEntries.slice(-this.config.maxTimelineEntries);
      }
    } catch {
      this.errorCount++;
    }
  }

  /**
   * Ingest a health snapshot.
   * Non-blocking. Never throws.
   */
  ingestHealthSnapshot(snapshot: SystemHealthSnapshot): void {
    try {
      this.healthSnapshots.push(snapshot);
      if (this.healthSnapshots.length > this.maxHealthSnapshots) {
        this.healthSnapshots = this.healthSnapshots.slice(-this.maxHealthSnapshots);
      }
    } catch {
      this.errorCount++;
    }
  }

  /**
   * Ingest a batch of events.
   * Non-blocking. Never throws.
   */
  ingestBatch(events: CollectedEvent[]): void {
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
          } catch {
            event.resolve({ error: "export_failed", errorCount: ++this.errorCount });
          }
          break;
      }
    }
  }

  /** Get all stored trace sessions. */
  getTraceSessions(limit?: number): TraceSession[] {
    try {
      return this.traceSessions.slice(-(limit ?? 50));
    } catch {
      return [];
    }
  }

  /** Get all stored timeline entries. */
  getTimelineEntries(limit?: number): TimelineEntry[] {
    try {
      return this.timelineEntries.slice(-(limit ?? 500));
    } catch {
      return [];
    }
  }

  /** Get health snapshots. */
  getHealthSnapshots(limit?: number): SystemHealthSnapshot[] {
    try {
      return this.healthSnapshots.slice(-(limit ?? 50));
    } catch {
      return [];
    }
  }

  /** Get the latest health snapshot. */
  getLatestHealth(): SystemHealthSnapshot | null {
    return this.healthSnapshots[this.healthSnapshots.length - 1] ?? null;
  }

  /** Export all collected data. */
  exportAll(): {
    traceSessions: TraceSession[];
    timelineEntries: TimelineEntry[];
    healthSnapshots: SystemHealthSnapshot[];
    stats: { errorCount: number; droppedCount: number };
    exportedAt: number;
  } {
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
  getStats(): {
    traceSessionCount: number;
    timelineEntryCount: number;
    healthSnapshotCount: number;
    errorCount: number;
    droppedCount: number;
  } {
    return {
      traceSessionCount: this.traceSessions.length,
      timelineEntryCount: this.timelineEntries.length,
      healthSnapshotCount: this.healthSnapshots.length,
      errorCount: this.errorCount,
      droppedCount: this.droppedCount,
    };
  }

  /** Reset all collected data. */
  reset(): void {
    this.traceSessions = [];
    this.timelineEntries = [];
    this.healthSnapshots = [];
    this.errorCount = 0;
    this.droppedCount = 0;
  }

  /** Get count of total entries stored. */
  get totalEntries(): number {
    return this.traceSessions.length + this.timelineEntries.length + this.healthSnapshots.length;
  }
}

// ─── Singleton ───────────────────────────────────────────

let _collector: EventCollector | null = null;

export function getEventCollector(config?: Partial<CollectorConfig>): EventCollector {
  if (!_collector) {
    _collector = new EventCollector(config);
  }
  return _collector;
}

export function resetEventCollector(): void {
  _collector?.reset();
  _collector = null;
}

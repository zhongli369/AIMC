/**
 * Observability Layer — Phase 6 (P0).
 *
 * Pure observability infrastructure. Every decision, action, failure, and recovery
 * is traceable and replayable. Zero behavior influence, zero execution impact.
 *
 * PURE OBSERVABILITY — NO behavior change, NO decision influence.
 */
export { RuntimeTraceRecorder, type TraceStage, type TraceEvent, type TraceSession, } from "./runtime-trace.js";
export { BehaviorTimeline, type TimelineEventType, type TimelineEntry, } from "./behavior-timeline.js";
export { SystemHealthTracker, type HealthState, type SystemHealthSnapshot, } from "./system-health.js";
export { EventCollector, getEventCollector, resetEventCollector, type CollectedEvent, type CollectorConfig, } from "./event-collector.js";
export { ObservabilityExporter, type ExportFormat, type ExportResult, type ObservabilitySnapshot, } from "./exporter.js";
//# sourceMappingURL=index.d.ts.map
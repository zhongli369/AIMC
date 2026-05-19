/**
 * Observability Layer — Phase 6 (P0).
 *
 * Pure observability infrastructure. Every decision, action, failure, and recovery
 * is traceable and replayable. Zero behavior influence, zero execution impact.
 *
 * PURE OBSERVABILITY — NO behavior change, NO decision influence.
 */
// Runtime trace
export { RuntimeTraceRecorder, } from "./runtime-trace.js";
// Behavior timeline
export { BehaviorTimeline, } from "./behavior-timeline.js";
// System health
export { SystemHealthTracker, } from "./system-health.js";
// Event collector
export { EventCollector, getEventCollector, resetEventCollector, } from "./event-collector.js";
// Exporter
export { ObservabilityExporter, } from "./exporter.js";
//# sourceMappingURL=index.js.map
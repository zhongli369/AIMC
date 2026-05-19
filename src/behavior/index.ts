export { ProactiveEngine } from "./proactive-engine.js";
export type { ProactiveIntent, ProactiveConfig } from "./proactive-engine.js";

export { TaskPlanner } from "./task-planner.js";
export type { PlannedTask, TaskStatus, TaskCategory } from "./task-planner.js";

// Phase 4-G: Behavior Arbitration
export { BehaviorArbitrator } from "./arbitration/behavior-arbitrator.js";
export type {
  MemoryUrgencySignal,
  CooperativeStateSignal,
  ArbitrationInput,
  ArbitrationResult,
  ArbitrationWeights,
  ArbitrationConfig,
  SuppressedAction,
} from "./arbitration/behavior-arbitrator.js";

// Phase 5: Stability & Recovery
export {
  StuckDetector,
  ActionLoopDetector,
  SafeModeManager,
  StabilityMonitor,
  SkillFailureTracker,
} from "./stability/stuck-detector.js";
export type {
  StabilityConfig,
  StabilityState,
  ProgressType,
  ProgressEvent,
  ActionRecord,
} from "./stability/stuck-detector.js";

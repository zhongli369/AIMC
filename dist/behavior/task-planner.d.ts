/**
 * TaskPlanner — goal generation, task queue, pausing/resuming,
 * priority-based scheduling.
 *
 * Example goals: mine iron, return home, protect player, gather food, organize inventory.
 *
 * Phase 4-B: Voice-driven urgency bias scales step timeouts.
 * Structural invariant: NO schema changes, NO new execution paths.
 */
import { EventEmitter } from "node:events";
import type { VoicePressureSignal } from "../voice/voice-pressure.js";
export type TaskStatus = "pending" | "active" | "paused" | "completed" | "failed" | "cancelled";
export type TaskCategory = "survival" | "gathering" | "building" | "combat" | "exploration" | "social" | "maintenance";
/** Per-step execution status (Phase 3-A). Mirrors skill PlanStepState. */
export type TaskStepState = "pending" | "running" | "success" | "failed" | "retrying" | "skipped";
export interface TaskStepResult {
    step: number;
    action: string;
    skill?: string;
    state: TaskStepState;
    retryCount: number;
    durationMs?: number;
    error?: string;
    fallbackUsed: boolean;
}
export interface PlannedTask {
    id: string;
    /** Human-readable goal description */
    description: string;
    /** Task category */
    category: TaskCategory;
    /** Priority 1–5 */
    priority: number;
    /** Current status */
    status: TaskStatus;
    /** Subtask descriptions (action plan) */
    steps: string[];
    /** Phase 3-A: per-step execution results */
    stepResults: TaskStepResult[];
    /** Current step index */
    currentStep: number;
    /** When the task was created */
    createdAt: number;
    /** When the task was last updated */
    updatedAt: number;
    /** Estimated number of steps to completion */
    estimatedSteps: number;
    /** How many times execution was attempted (task-level) */
    attempts: number;
    /** Total step-level retries across all steps */
    totalStepRetries: number;
    /** Why the task was paused/failed (if applicable) */
    interruptionReason?: string;
    /** Location context */
    location?: {
        x: number;
        y: number;
        z: number;
        dimension?: string;
    };
    /** Dependencies (other task IDs that must complete first) */
    dependencies: string[];
}
interface TaskPlannerConfig {
    /** Max concurrent active tasks */
    maxConcurrent: number;
    /** Max total tasks in queue */
    maxQueueSize: number;
    /** Max retry attempts before marking failed */
    maxRetries: number;
    /** Whether to auto-generate tasks */
    autoGenerate: boolean;
}
export declare class TaskPlanner extends EventEmitter {
    private config;
    private tasks;
    private taskQueue;
    private activeTaskId;
    private voicePressure;
    constructor(config?: Partial<TaskPlannerConfig>);
    /** Set voice pressure signal for step timeout scaling (Phase 4-B). */
    setVoicePressure(signal: VoicePressureSignal): void;
    /** Create a new task from a template or custom description. */
    createTask(params: {
        description: string;
        category?: TaskCategory;
        priority?: number;
        steps?: string[];
        location?: {
            x: number;
            y: number;
            z: number;
            dimension?: string;
        };
        dependencies?: string[];
    }): PlannedTask;
    /** Get the next task to work on. */
    getNextTask(): PlannedTask | null;
    /** Activate the next task in the queue. */
    activateNext(): PlannedTask | null;
    /** Mark the current step as complete and advance. */
    advanceStep(taskId: string): PlannedTask | null;
    /** Pause a task (e.g., combat interrupted gathering). */
    pauseTask(taskId: string, reason: string): PlannedTask | null;
    /** Resume a paused task. */
    resumeTask(taskId: string): PlannedTask | null;
    /** Mark a task as failed. */
    failTask(taskId: string, reason: string): PlannedTask | null;
    /** Cancel a task entirely. */
    cancelTask(taskId: string): void;
    /**
     * Auto-generate goals based on bot state and context.
     */
    autoGenerate(context: {
        lowResources?: string[];
        playerRequest?: string;
        healthLow?: boolean;
        idleTimeMs?: number;
        nearbyHostiles?: number;
    }): PlannedTask[];
    /**
     * Sync step-level execution results back from SkillRouter.
     *
     * Called after SkillRouter.executePlan() completes.
     * Does NOT modify execution flow — this is state reconciliation only.
     *
     * Failure isolation: a failed step does NOT cascade to other steps.
     * The task continues with remaining steps; AgentCore decides re-planning.
     */
    syncFromPlanExecution(taskId: string, stepStatuses: Array<{
        step: number;
        action: string;
        skill?: string;
        state: TaskStepState;
        retryCount: number;
        durationMs?: number;
        error?: string;
        fallbackUsed: boolean;
    }>): PlannedTask | null;
    /** Calculate per-step timeout based on priority, scaled by voice pressure (Phase 4-B). */
    getStepTimeout(priority: number): number;
    private insertIntoQueue;
    private removeFromQueue;
    /**
     * Convert a PlannedTask to a TaskPlan for LLM consumption / SkillRouter.
     */
    toPlan(): import("../interfaces/intent.js").TaskPlan | null;
    /**
     * Create tasks from a TaskPlan (LLM-generated plan).
     */
    createFromPlan(plan: import("../interfaces/intent.js").TaskPlan): PlannedTask[];
    /** Heuristic: map a skill name or description to a task category. */
    private inferCategory;
    /** Heuristic: infer which skill to use for a task step. */
    private inferSkill;
    getTask(taskId: string): PlannedTask | null;
    getActiveTask(): PlannedTask | null;
    getAllTasks(): PlannedTask[];
    getTasksByStatus(status: TaskStatus): PlannedTask[];
    getQueueLength(): number;
    clear(): void;
}
export {};
//# sourceMappingURL=task-planner.d.ts.map
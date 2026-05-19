/**
 * TaskPlanner — goal generation, task queue, pausing/resuming,
 * priority-based scheduling.
 *
 * Example goals: mine iron, return home, protect player, gather food, organize inventory.
 */
import { EventEmitter } from "node:events";
export type TaskStatus = "pending" | "active" | "paused" | "completed" | "failed" | "cancelled";
export type TaskCategory = "survival" | "gathering" | "building" | "combat" | "exploration" | "social" | "maintenance";
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
    /** Current step index */
    currentStep: number;
    /** When the task was created */
    createdAt: number;
    /** When the task was last updated */
    updatedAt: number;
    /** Estimated number of steps to completion */
    estimatedSteps: number;
    /** How many times execution was attempted */
    attempts: number;
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
    constructor(config?: Partial<TaskPlannerConfig>);
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
    private insertIntoQueue;
    private removeFromQueue;
    getTask(taskId: string): PlannedTask | null;
    getActiveTask(): PlannedTask | null;
    getAllTasks(): PlannedTask[];
    getTasksByStatus(status: TaskStatus): PlannedTask[];
    getQueueLength(): number;
    clear(): void;
}
export {};
//# sourceMappingURL=task-planner.d.ts.map
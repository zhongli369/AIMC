/**
 * TaskPlanner — goal generation, task queue, pausing/resuming,
 * priority-based scheduling.
 *
 * Example goals: mine iron, return home, protect player, gather food, organize inventory.
 */
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

// ─── Task Types ──────────────────────────────────────

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
  location?: { x: number; y: number; z: number; dimension?: string };
  /** Dependencies (other task IDs that must complete first) */
  dependencies: string[];
}

// ─── Config ──────────────────────────────────────────

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

const DEFAULT_CONFIG: TaskPlannerConfig = {
  maxConcurrent: 1,
  maxQueueSize: 10,
  maxRetries: 3,
  autoGenerate: true,
};

// ─── Goal Templates ──────────────────────────────────

interface GoalTemplate {
  category: TaskCategory;
  description: string;
  priority: number;
  steps: string[];
  /** Conditions that trigger this goal */
  triggers: {
    lowResource?: string;
    playerRequest?: string;
    lowHealth?: boolean;
    idle?: boolean;
    exploration?: boolean;
    combatImminent?: boolean;
  };
}

const GOAL_TEMPLATES: GoalTemplate[] = [
  {
    category: "survival",
    description: "Secure food supply",
    priority: 4,
    steps: ["Find food source", "Collect food items", "Consume if hungry", "Store extras"],
    triggers: { lowResource: "food", lowHealth: true },
  },
  {
    category: "gathering",
    description: "Collect wood for basic supplies",
    priority: 3,
    steps: ["Find nearest tree", "Chop logs", "Collect drops", "Return to player"],
    triggers: { lowResource: "wood", idle: true },
  },
  {
    category: "gathering",
    description: "Mine for iron ore",
    priority: 3,
    steps: ["Find cave or dig down safely", "Identify iron ore", "Mine with stone pickaxe+", "Collect ore", "Return to surface"],
    triggers: { exploration: true },
  },
  {
    category: "combat",
    description: "Protect the player from hostiles",
    priority: 5,
    steps: ["Identify hostile entity", "Assess danger level", "Attack or defend based on health", "Confirm area is clear"],
    triggers: { combatImminent: true },
  },
  {
    category: "building",
    description: "Light up the area around base",
    priority: 3,
    steps: ["Check torch supply", "Navigate to dark areas", "Place torches every 8 blocks", "Ensure coverage"],
    triggers: { idle: true },
  },
  {
    category: "maintenance",
    description: "Organize inventory and drop junk",
    priority: 2,
    steps: ["Review inventory slots", "Identify low-value items", "Drop or store junk", "Keep essentials accessible"],
    triggers: { idle: true },
  },
  {
    category: "exploration",
    description: "Scout the surrounding area",
    priority: 2,
    steps: ["Pick a cardinal direction", "Walk 32 blocks", "Note structures or resources", "Return to player"],
    triggers: { idle: true, exploration: true },
  },
];

// ─── Planner ────────────────────────────────────────

export class TaskPlanner extends EventEmitter {
  private config: TaskPlannerConfig;
  private tasks: Map<string, PlannedTask> = new Map();
  private taskQueue: string[] = []; // Task IDs in priority order
  private activeTaskId: string | null = null;

  constructor(config?: Partial<TaskPlannerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Task CRUD ─────────────────────────────────────

  /** Create a new task from a template or custom description. */
  createTask(params: {
    description: string;
    category?: TaskCategory;
    priority?: number;
    steps?: string[];
    location?: { x: number; y: number; z: number; dimension?: string };
    dependencies?: string[];
  }): PlannedTask {
    const task: PlannedTask = {
      id: randomUUID(),
      description: params.description,
      category: params.category || "maintenance",
      priority: params.priority || 3,
      status: "pending",
      steps: params.steps || [params.description],
      currentStep: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      estimatedSteps: params.steps?.length || 1,
      attempts: 0,
      location: params.location,
      dependencies: params.dependencies || [],
    };

    this.tasks.set(task.id, task);
    this.insertIntoQueue(task);

    this.emit("task_created", task);
    return task;
  }

  /** Get the next task to work on. */
  getNextTask(): PlannedTask | null {
    // Filter out tasks with unsatisfied dependencies, completed, failed
    const available = this.taskQueue
      .map((id) => this.tasks.get(id)!)
      .filter((t) =>
        t &&
        t.status === "pending" &&
        t.dependencies.every((depId) => {
          const dep = this.tasks.get(depId);
          return dep?.status === "completed";
        }),
      );

    if (available.length === 0) return null;
    return available[0];
  }

  /** Activate the next task in the queue. */
  activateNext(): PlannedTask | null {
    if (this.activeTaskId) {
      const current = this.tasks.get(this.activeTaskId);
      if (current && current.status === "active") {
        return current; // Still working on it
      }
    }

    const next = this.getNextTask();
    if (!next) return null;

    next.status = "active";
    next.updatedAt = Date.now();
    next.attempts++;
    this.activeTaskId = next.id;
    this.emit("task_activated", next);
    return next;
  }

  /** Mark the current step as complete and advance. */
  advanceStep(taskId: string): PlannedTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    task.currentStep++;
    task.updatedAt = Date.now();

    if (task.currentStep >= task.steps.length) {
      task.status = "completed";
      task.updatedAt = Date.now();
      if (this.activeTaskId === task.id) this.activeTaskId = null;
      this.emit("task_completed", task);
      this.removeFromQueue(task.id);
    }

    return task;
  }

  /** Pause a task (e.g., combat interrupted gathering). */
  pauseTask(taskId: string, reason: string): PlannedTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    if (task.status !== "active") return task;

    task.status = "paused";
    task.interruptionReason = reason;
    task.updatedAt = Date.now();
    if (this.activeTaskId === task.id) this.activeTaskId = null;

    this.emit("task_paused", task);
    return task;
  }

  /** Resume a paused task. */
  resumeTask(taskId: string): PlannedTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    if (task.status !== "paused") return task;

    task.status = "pending";
    task.interruptionReason = undefined;
    task.updatedAt = Date.now();
    this.insertIntoQueue(task);

    this.emit("task_resumed", task);
    return task;
  }

  /** Mark a task as failed. */
  failTask(taskId: string, reason: string): PlannedTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    if (task.attempts < this.config.maxRetries) {
      // Re-queue for retry
      task.status = "pending";
      task.currentStep = 0;
      task.interruptionReason = reason;
      this.insertIntoQueue(task);
      if (this.activeTaskId === task.id) this.activeTaskId = null;
    } else {
      task.status = "failed";
      task.interruptionReason = reason;
      if (this.activeTaskId === task.id) this.activeTaskId = null;
      this.removeFromQueue(task.id);
      this.emit("task_failed", task);
    }

    task.updatedAt = Date.now();
    return task;
  }

  /** Cancel a task entirely. */
  cancelTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = "cancelled";
    if (this.activeTaskId === task.id) this.activeTaskId = null;
    this.removeFromQueue(taskId);
    this.emit("task_cancelled", task);
  }

  // ─── Auto-Generation ───────────────────────────────

  /**
   * Auto-generate goals based on bot state and context.
   */
  autoGenerate(context: {
    lowResources?: string[];
    playerRequest?: string;
    healthLow?: boolean;
    idleTimeMs?: number;
    nearbyHostiles?: number;
  }): PlannedTask[] {
    if (!this.config.autoGenerate) return [];

    const generated: PlannedTask[] = [];

    for (const template of GOAL_TEMPLATES) {
      const triggers = template.triggers;

      // Check triggers
      let matches = false;
      if (triggers.lowResource && context.lowResources?.includes(triggers.lowResource)) matches = true;
      if (triggers.lowHealth && context.healthLow) matches = true;
      if (triggers.idle && (context.idleTimeMs || 0) > 30_000) matches = true;
      if (triggers.combatImminent && (context.nearbyHostiles || 0) > 0) matches = true;

      if (matches) {
        // Avoid duplicates
        const exists = [...this.tasks.values()].some(
          (t) => t.description === template.description && (t.status === "pending" || t.status === "active"),
        );
        if (exists) continue;

        const task = this.createTask({
          description: template.description,
          category: template.category,
          priority: template.priority,
          steps: template.steps,
        });
        generated.push(task);
      }
    }

    return generated;
  }

  // ─── Queue Management ──────────────────────────────

  private insertIntoQueue(task: PlannedTask): void {
    if (this.taskQueue.includes(task.id)) return;
    this.taskQueue.push(task.id);
    // Sort by priority descending, then creation time ascending
    this.taskQueue.sort((a, b) => {
      const ta = this.tasks.get(a)!;
      const tb = this.tasks.get(b)!;
      if (tb.priority !== ta.priority) return tb.priority - ta.priority;
      return ta.createdAt - tb.createdAt;
    });
    // Trim queue
    while (this.taskQueue.length > this.config.maxQueueSize) {
      const removed = this.taskQueue.pop()!;
      if (this.activeTaskId === removed) this.activeTaskId = null;
    }
  }

  private removeFromQueue(taskId: string): void {
    this.taskQueue = this.taskQueue.filter((id) => id !== taskId);
  }

  // ─── Query ─────────────────────────────────────────

  getTask(taskId: string): PlannedTask | null {
    return this.tasks.get(taskId) || null;
  }

  getActiveTask(): PlannedTask | null {
    if (!this.activeTaskId) return null;
    return this.tasks.get(this.activeTaskId) || null;
  }

  getAllTasks(): PlannedTask[] {
    return [...this.tasks.values()];
  }

  getTasksByStatus(status: TaskStatus): PlannedTask[] {
    return [...this.tasks.values()].filter((t) => t.status === status);
  }

  getQueueLength(): number {
    return this.taskQueue.filter((id) => {
      const t = this.tasks.get(id);
      return t && t.status === "pending";
    }).length;
  }

  // ─── Reset ─────────────────────────────────────────

  clear(): void {
    this.tasks.clear();
    this.taskQueue = [];
    this.activeTaskId = null;
  }
}

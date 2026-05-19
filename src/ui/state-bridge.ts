/**
 * UIStateBridge — telemetry → UI-safe state snapshot (P1).
 *
 * Polls EventCollector and __botState__ periodically, builds lightweight
 * UI-safe snapshots, and emits them via AIMC_UI_STATE stdout lines.
 * Electron main process parses these and forwards them to the dashboard.
 *
 * READ-ONLY — NO execution, NO behavior change, NO architecture impact.
 * All data paths are one-way: telemetry → bridge → stdout → IPC → renderer.
 */
import { getEventCollector } from "../observability/event-collector.js";

// ─── UI State Types ─────────────────────────────────────

export interface UIGameState {
  running: boolean;
  health: number;
  maxHealth: number;
  food: number;
  saturation: number;
  position: { x: number; y: number; z: number } | null;
  dimension: string;
  inventoryCount: number;
  equippedItem: string | null;
}

export interface UIAIFlow {
  currentIntent: string | null;
  lastSkill: string | null;
  lastActionResult: string | null;
  lastSpeech: string | null;
  recentTimeline: Array<{
    type: string;
    timestamp: number;
    detail?: string;
  }>;
}

export interface UISystemHealth {
  stuckRate: number;
  loopRate: number;
  skillSuccessRate: number;
  fallbackRate: number;
  healthState: string;
  isSafeMode: boolean;
  totalActions: number;
}

export interface UIStateSnapshot {
  type: "ui_state";
  timestamp: number;
  gameState: UIGameState;
  aiFlow: UIAIFlow;
  systemHealth: UISystemHealth;
}

// ─── Bridge ─────────────────────────────────────────────

export class UIStateBridge {
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private enabled = false;

  constructor(intervalMs = 1000) {
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.timer = setInterval(() => this.poll(), this.intervalMs);
  }

  stop(): void {
    this.enabled = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  get isRunning(): boolean {
    return this.enabled;
  }

  private poll(): void {
    try {
      const snapshot = this.buildSnapshot();
      console.log(`AIMC_UI_STATE:${JSON.stringify(snapshot)}`);
    } catch {
      // Never throw — UI bridge must not affect runtime
    }
  }

  private buildSnapshot(): UIStateSnapshot {
    const collector = getEventCollector();
    const botState = (globalThis as any).__botState__;

    return {
      type: "ui_state",
      timestamp: Date.now(),
      gameState: this.buildGameState(botState),
      aiFlow: this.buildAIFlow(collector),
      systemHealth: this.buildSystemHealth(collector),
    };
  }

  private buildGameState(botState: any): UIGameState {
    if (!botState) {
      return {
        running: false,
        health: 0,
        maxHealth: 20,
        food: 0,
        saturation: 0,
        position: null,
        dimension: "unknown",
        inventoryCount: 0,
        equippedItem: null,
      };
    }

    try {
      return {
        running: !!(globalThis as any).__BOT__?.player,
        health: botState.health ?? 0,
        maxHealth: botState.maxHealth ?? 20,
        food: botState.food ?? 0,
        saturation: botState.saturation ?? 0,
        position: botState.position
          ? { x: Math.round(botState.position.x), y: Math.round(botState.position.y), z: Math.round(botState.position.z) }
          : null,
        dimension: botState.dimension || "unknown",
        inventoryCount: Array.isArray(botState.inventory) ? botState.inventory.length : 0,
        equippedItem: botState.equippedItem?.name ?? null,
      };
    } catch {
      return {
        running: false,
        health: 0,
        maxHealth: 20,
        food: 0,
        saturation: 0,
        position: null,
        dimension: "unknown",
        inventoryCount: 0,
        equippedItem: null,
      };
    }
  }

  private buildAIFlow(collector: any): UIAIFlow {
    try {
      const timeline = collector.getTimelineEntries(20);
      const recentTimeline = timeline.slice(-10).map((e: any) => ({
        type: e.type || e.eventType || "unknown",
        timestamp: e.timestamp || 0,
        detail: e.detail || e.skillName || undefined,
      }));

      const latestHealth = collector.getLatestHealth();

      // Derive last skill and intent from timeline
      let lastSkill: string | null = null;
      let lastActionResult: string | null = null;
      let lastSpeech: string | null = null;
      let currentIntent: string | null = null;

      for (let i = timeline.length - 1; i >= 0; i--) {
        const e = timeline[i];
        if (!lastSkill && (e.type === "skill_start" || e.type === "skill_complete")) {
          lastSkill = e.skillName || e.detail || null;
        }
        if (!lastActionResult && (e.type === "skill_complete" || e.type === "skill_failed" || e.type === "fallback_activated")) {
          lastActionResult = e.type;
        }
        if (!lastSpeech && e.type === "chat_response") {
          lastSpeech = e.detail || e.text || null;
        }
        if (!currentIntent && e.type === "route_skill") {
          currentIntent = e.detail || e.skillName || null;
        }
      }

      return {
        currentIntent,
        lastSkill,
        lastActionResult,
        lastSpeech,
        recentTimeline: recentTimeline.reverse(),
      };
    } catch {
      return {
        currentIntent: null,
        lastSkill: null,
        lastActionResult: null,
        lastSpeech: null,
        recentTimeline: [],
      };
    }
  }

  private buildSystemHealth(collector: any): UISystemHealth {
    try {
      const latest = collector.getLatestHealth();
      if (!latest) {
        return {
          stuckRate: 0,
          loopRate: 0,
          skillSuccessRate: 0,
          fallbackRate: 0,
          healthState: "starting",
          isSafeMode: false,
          totalActions: 0,
        };
      }

      return {
        stuckRate: Math.round((latest.stuckRate ?? 0) * 100),
        loopRate: Math.round((latest.loopRate ?? 0) * 100),
        skillSuccessRate: Math.round((latest.skillSuccessRate ?? 0) * 100),
        fallbackRate: Math.round((latest.fallbackRate ?? 0) * 100),
        healthState: latest.healthState ?? "unknown",
        isSafeMode: latest.isSafeMode ?? false,
        totalActions: latest.totalActions ?? 0,
      };
    } catch {
      return {
        stuckRate: 0,
        loopRate: 0,
        skillSuccessRate: 0,
        fallbackRate: 0,
        healthState: "error",
        isSafeMode: false,
        totalActions: 0,
      };
    }
  }

  /** Build and return a snapshot without emitting (for direct API use). */
  getSnapshot(): UIStateSnapshot {
    return this.buildSnapshot();
  }
}

// ─── Singleton ──────────────────────────────────────────

let _bridge: UIStateBridge | null = null;

export function initUIStateBridge(intervalMs?: number): UIStateBridge {
  if (_bridge) _bridge.stop();
  _bridge = new UIStateBridge(intervalMs ?? 1000);
  _bridge.start();
  return _bridge;
}

export function getUIStateBridge(): UIStateBridge | null {
  return _bridge;
}

export function stopUIStateBridge(): void {
  _bridge?.stop();
  _bridge = null;
}

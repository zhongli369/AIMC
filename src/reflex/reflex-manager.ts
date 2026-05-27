/**
 * ReflexManager — lightweight non-LLM reaction layer.
 *
 * Behaviors are checked in registration order on every PerceptionEvent.
 * Each behavior returns { consumed } — if true, downstream handlers
 * (handleChat / AgentCore) are skipped for this event.
 *
 * Design constraints:
 *   - No physicsTick subscription
 *   - No long-running loops
 *   - Behaviors must be idempotent and rate-limited internally
 *   - Reflex NEVER replaces AgentCore — only intercepts before it
 */

import type { PerceptionEvent } from "../perception/event-types.js";

// ─── Types ────────────────────────────────────────────────────

export interface ReflexContext {
  bot: any;
  safeBotChat: (text: string) => boolean;
  /** mineflayer-pathfinder namespace (goals, Movements) */
  pf?: any;
}

export interface ReflexResult {
  /** Whether downstream dispatch (handleChat) should be skipped */
  consumed: boolean;
  /** Human-readable action label for logging */
  action?: string;
  /** Why the behavior decided to act or skip */
  reason?: string;
  /** Error message if the action failed */
  error?: string;
}

export interface ReflexBehavior {
  /** Unique name for logging and config */
  name: string;
  /** Runtime toggle — set to false to disable without unregistering */
  enabled: boolean;
  /** Quick sync check — return true if this behavior might act */
  canHandle(event: PerceptionEvent): boolean;
  /** Execute the behavior. MUST NOT throw. */
  handle(event: PerceptionEvent, ctx: ReflexContext): Promise<ReflexResult>;
}

// ─── Manager ──────────────────────────────────────────────────

export class ReflexManager {
  private behaviors: ReflexBehavior[] = [];
  private ctx: ReflexContext;
  private _enabled: boolean;
  private _stopped = false;

  constructor(ctx: ReflexContext, enabled = true) {
    this.ctx = ctx;
    this._enabled = enabled;
  }

  get enabled(): boolean {
    return this._enabled && !this._stopped;
  }

  registerBehavior(behavior: ReflexBehavior): void {
    this.behaviors.push(behavior);
    console.log(
      `[REFLEX] registered behavior: ${behavior.name} enabled=${behavior.enabled}`
    );
  }

  /**
   * Run all enabled behaviors against a PerceptionEvent.
   * First behavior that returns consumed=true short-circuits the rest.
   * Returns { consumed } so the caller knows whether to skip downstream dispatch.
   */
  async handleEvent(
    event: PerceptionEvent
  ): Promise<{ consumed: boolean }> {
    if (!this.enabled) return { consumed: false };

    for (const behavior of this.behaviors) {
      if (!behavior.enabled) continue;
      if (!behavior.canHandle(event)) continue;

      try {
        const result = await behavior.handle(event, this.ctx);
        if (result.consumed) {
          console.log(
            `[REFLEX] ${behavior.name} consumed event traceId=${event.traceId}`
          );
          return { consumed: true };
        }
      } catch (err: any) {
        console.error(
          `[REFLEX] ${behavior.name} threw: ${err.message}`
        );
        // Never let a reflex failure block the chat pipeline
      }
    }

    return { consumed: false };
  }

  stop(): void {
    this._stopped = true;
    console.log("[REFLEX] stopped — all behaviors inactive");
  }
}

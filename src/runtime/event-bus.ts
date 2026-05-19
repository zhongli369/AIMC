/**
 * EventBus — central async event system.
 * Decouples all modules: Minecraft events, voice events, agent events.
 * Non-blocking by design: handlers execute asynchronously.
 */
import type {
  GameEvent,
  GameEventType,
  EventCategory,
  EventHandler,
  EventPriority,
  EventSubscription,
} from "../interfaces/event.js";

let nextSequence = 0;

export class EventBus {
  private subscriptions: Map<string, EventSubscription[]> = new Map();
  private eventHistory: GameEvent[] = [];
  private maxHistory = 500;

  // ─── Subscribe ──────────────────────────────────────

  subscribe<T = unknown>(
    pattern: string,
    handler: EventHandler<T>,
    priorityMin?: EventPriority,
  ): () => void {
    const sub: EventSubscription = {
      pattern,
      handler: handler as EventHandler,
      priorityMin,
      unsubscribe: () => this.unsubscribe(sub),
    };

    const existing = this.subscriptions.get(pattern) || [];
    existing.push(sub);
    this.subscriptions.set(pattern, existing);

    return sub.unsubscribe;
  }

  // ─── Convenience Subscribers ────────────────────────

  on<T = unknown>(
    category: EventCategory,
    type: GameEventType,
    handler: EventHandler<T>,
    priorityMin?: EventPriority,
  ): () => void {
    return this.subscribe(`${category}:${type}`, handler, priorityMin);
  }

  onAny<T = unknown>(handler: EventHandler<T>): () => void {
    return this.subscribe("*", handler);
  }

  // ─── Emit ───────────────────────────────────────────

  async emit<T = unknown>(
    category: EventCategory,
    type: GameEventType,
    data: T,
    priority: EventPriority = 2,
    source?: string,
  ): Promise<void> {
    const event: GameEvent<T> = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      sequence: ++nextSequence,
      category,
      type,
      priority,
      timestamp: Date.now(),
      data,
      source,
    };

    // Store in history
    this.eventHistory.push(event as GameEvent);
    if (this.eventHistory.length > this.maxHistory) {
      this.eventHistory.shift();
    }

    // Collect matching handlers
    const patterns = [
      `${category}:${type}`,
      `${category}:*`,
      `*:${type}`,
      "*",
    ];

    const handlers: EventHandler[] = [];
    for (const pattern of patterns) {
      const subs = this.subscriptions.get(pattern) || [];
      for (const sub of subs) {
        if (!sub.priorityMin || priority >= sub.priorityMin) {
          handlers.push(sub.handler);
        }
      }
    }

    // Execute all handlers concurrently (non-blocking)
    if (handlers.length > 0) {
      await Promise.allSettled(
        handlers.map((handler) =>
          Promise.resolve(handler(event as GameEvent)).catch((err) => {
            console.error(
              `[EventBus] Handler error for ${category}:${type}:`,
              err,
            );
          }),
        ),
      );
    }
  }

  // ─── History ────────────────────────────────────────

  getHistory(limit = 100): GameEvent[] {
    return this.eventHistory.slice(-limit);
  }

  getRecentEvents(windowMs: number, limit = 50): GameEvent[] {
    const cutoff = Date.now() - windowMs;
    return this.eventHistory
      .filter((e) => e.timestamp >= cutoff)
      .slice(-limit);
  }

  clearHistory(): void {
    this.eventHistory = [];
  }

  // ─── Cleanup ────────────────────────────────────────

  private unsubscribe(sub: EventSubscription): void {
    const subs = this.subscriptions.get(sub.pattern);
    if (subs) {
      const idx = subs.indexOf(sub);
      if (idx !== -1) subs.splice(idx, 1);
      if (subs.length === 0) this.subscriptions.delete(sub.pattern);
    }
  }

  removeAllListeners(): void {
    this.subscriptions.clear();
  }

  getSubscriberCount(): number {
    let count = 0;
    for (const subs of this.subscriptions.values()) count += subs.length;
    return count;
  }

  getPatterns(): string[] {
    return Array.from(this.subscriptions.keys());
  }
}

// Singleton instance
export const eventBus = new EventBus();

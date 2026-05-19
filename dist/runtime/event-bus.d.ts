/**
 * EventBus — central async event system.
 * Decouples all modules: Minecraft events, voice events, agent events.
 * Non-blocking by design: handlers execute asynchronously.
 */
import type { GameEvent, GameEventType, EventCategory, EventHandler, EventPriority } from "../interfaces/event.js";
export declare class EventBus {
    private subscriptions;
    private eventHistory;
    private maxHistory;
    subscribe<T = unknown>(pattern: string, handler: EventHandler<T>, priorityMin?: EventPriority): () => void;
    on<T = unknown>(category: EventCategory, type: GameEventType, handler: EventHandler<T>, priorityMin?: EventPriority): () => void;
    onAny<T = unknown>(handler: EventHandler<T>): () => void;
    emit<T = unknown>(category: EventCategory, type: GameEventType, data: T, priority?: EventPriority, source?: string): Promise<void>;
    getHistory(limit?: number): GameEvent[];
    getRecentEvents(windowMs: number, limit?: number): GameEvent[];
    clearHistory(): void;
    private unsubscribe;
    removeAllListeners(): void;
    getSubscriberCount(): number;
    getPatterns(): string[];
}
export declare const eventBus: EventBus;
//# sourceMappingURL=event-bus.d.ts.map
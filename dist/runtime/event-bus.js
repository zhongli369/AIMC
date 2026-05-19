let nextSequence = 0;
export class EventBus {
    subscriptions = new Map();
    eventHistory = [];
    maxHistory = 500;
    // ─── Subscribe ──────────────────────────────────────
    subscribe(pattern, handler, priorityMin) {
        const sub = {
            pattern,
            handler: handler,
            priorityMin,
            unsubscribe: () => this.unsubscribe(sub),
        };
        const existing = this.subscriptions.get(pattern) || [];
        existing.push(sub);
        this.subscriptions.set(pattern, existing);
        return sub.unsubscribe;
    }
    // ─── Convenience Subscribers ────────────────────────
    on(category, type, handler, priorityMin) {
        return this.subscribe(`${category}:${type}`, handler, priorityMin);
    }
    onAny(handler) {
        return this.subscribe("*", handler);
    }
    // ─── Emit ───────────────────────────────────────────
    async emit(category, type, data, priority = 2, source) {
        const event = {
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
        this.eventHistory.push(event);
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
        const handlers = [];
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
            await Promise.allSettled(handlers.map((handler) => Promise.resolve(handler(event)).catch((err) => {
                console.error(`[EventBus] Handler error for ${category}:${type}:`, err);
            })));
        }
    }
    // ─── History ────────────────────────────────────────
    getHistory(limit = 100) {
        return this.eventHistory.slice(-limit);
    }
    getRecentEvents(windowMs, limit = 50) {
        const cutoff = Date.now() - windowMs;
        return this.eventHistory
            .filter((e) => e.timestamp >= cutoff)
            .slice(-limit);
    }
    clearHistory() {
        this.eventHistory = [];
    }
    // ─── Cleanup ────────────────────────────────────────
    unsubscribe(sub) {
        const subs = this.subscriptions.get(sub.pattern);
        if (subs) {
            const idx = subs.indexOf(sub);
            if (idx !== -1)
                subs.splice(idx, 1);
            if (subs.length === 0)
                this.subscriptions.delete(sub.pattern);
        }
    }
    removeAllListeners() {
        this.subscriptions.clear();
    }
    getSubscriberCount() {
        let count = 0;
        for (const subs of this.subscriptions.values())
            count += subs.length;
        return count;
    }
    getPatterns() {
        return Array.from(this.subscriptions.keys());
    }
}
// Singleton instance
export const eventBus = new EventBus();
//# sourceMappingURL=event-bus.js.map
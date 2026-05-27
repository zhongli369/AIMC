/**
 * PerceptionPipeline — thin typed wrapper over raw Mineflayer bot events.
 *
 * Responsibilities:
 *   1. Register Mineflayer event listeners (chat, messagestr, spawn)
 *   2. Normalize heterogeneous event signatures → PerceptionEvent
 *   3. Deduplicate chat/message events (2-second window)
 *   4. Filter system messages (chat only)
 *   5. Dispatch validated chat messages to handler.onChatMessage
 *
 * Non-goals: EventBus, AsyncLocalStorage, pattern matching, physics ticks.
 */
import type { PerceptionHandlers } from "./event-types.js";
export declare class PerceptionPipeline {
    private bot;
    private handlers;
    private started;
    private _onChat;
    private _onMessagestr;
    private _onSpawn;
    private _recent;
    private _cleanupTimer;
    constructor(bot: any, handlers: PerceptionHandlers);
    start(): void;
    stop(): void;
    private _isDuplicate;
    private _makeEvent;
}
//# sourceMappingURL=perception-pipeline.d.ts.map
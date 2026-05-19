/**
 * BotCore — stable Mineflayer bot lifecycle wrapper.
 * Handles: connect, reconnect with exponential backoff, crash recovery, state tracking.
 * Wraps the legacy initBot from Mindcraft for backward compatibility.
 */
import type { BotRef, BotState, BotLifecycleState } from "../interfaces/minecraft.js";
interface BotCoreConfig {
    host: string;
    port: number;
    username: string;
    auth: "offline" | "microsoft";
    version?: string;
    maxReconnectAttempts: number;
    reconnectBaseDelayMs: number;
    reconnectMaxDelayMs: number;
    spawnTimeoutMs: number;
}
export declare class BotCore {
    config: BotCoreConfig;
    bot: BotRef | null;
    state: BotLifecycleState;
    private reconnectAttempt;
    private initBotFn;
    private spawnResolve;
    private spawnTimer;
    private disconnectHandled;
    constructor(config: BotCoreConfig);
    /** Register the legacy initBot function from Mindcraft utils/mcdata.js */
    setBotFactory(factory: (username: string) => BotRef): void;
    connect(): Promise<BotRef>;
    disconnect(reason?: string): Promise<void>;
    reconnect(reason?: string): Promise<BotRef | null>;
    private setupEventHandlers;
    getBotState(): BotState | null;
    isConnected(): boolean;
    isAlive(): boolean;
    private emit;
}
export {};
//# sourceMappingURL=bot-core.d.ts.map
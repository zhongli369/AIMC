export interface UIGameState {
    running: boolean;
    health: number;
    maxHealth: number;
    food: number;
    saturation: number;
    position: {
        x: number;
        y: number;
        z: number;
    } | null;
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
export declare class UIStateBridge {
    private intervalMs;
    private timer;
    private enabled;
    constructor(intervalMs?: number);
    start(): void;
    stop(): void;
    get isRunning(): boolean;
    private poll;
    private buildSnapshot;
    private buildGameState;
    private buildAIFlow;
    private buildSystemHealth;
    /** Build and return a snapshot without emitting (for direct API use). */
    getSnapshot(): UIStateSnapshot;
}
export declare function initUIStateBridge(intervalMs?: number): UIStateBridge;
export declare function getUIStateBridge(): UIStateBridge | null;
export declare function stopUIStateBridge(): void;
//# sourceMappingURL=state-bridge.d.ts.map
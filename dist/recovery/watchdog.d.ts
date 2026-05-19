/**
 * Watchdog — subsystem health monitoring with heartbeat + timeout detection.
 *
 * Each subsystem registers a watchdog. It must "kick" (heartbeat) within
 * its timeout window. If a timeout fires, the watchdog emits a "timeout"
 * event that the RecoveryManager handles.
 *
 * Subsystems tracked: runtime, agent, voice, memory, llm, bot
 */
import { EventEmitter } from "node:events";
export type SubsystemId = "runtime" | "agent" | "voice" | "memory" | "llm" | "bot" | "heuristics";
export interface SubsystemWatchdog {
    id: SubsystemId;
    name: string;
    timeoutMs: number;
    lastKick: number;
    enabled: boolean;
    consecutiveTimeouts: number;
}
export interface WatchdogAlert {
    subsystem: SubsystemId;
    name: string;
    lastKick: number;
    overdueMs: number;
    consecutiveTimeouts: number;
    timestamp: number;
}
export interface WatchdogConfig {
    /** Default timeout for subsystems without explicit config */
    defaultTimeoutMs: number;
    /** Check interval (ms) */
    checkIntervalMs: number;
    /** Max consecutive timeouts before escalating */
    maxConsecutiveTimeouts: number;
    /** Whether watchdog is active */
    enabled: boolean;
}
export declare class Watchdog extends EventEmitter {
    private config;
    private subsystems;
    private timer;
    private paused;
    constructor(config?: Partial<WatchdogConfig>);
    /** Enable a subsystem and start watching it. */
    enable(id: SubsystemId): void;
    /** Disable a subsystem (e.g., during maintenance). */
    disable(id: SubsystemId): void;
    /** Start the watchdog timer. */
    start(): void;
    /** Stop the watchdog timer. */
    stop(): void;
    /** Pause checks without stopping the timer (for debugging). */
    pause(): void;
    resume(): void;
    /** Kick a subsystem — signals "I'm alive." Call frequently. */
    kick(id: SubsystemId): void;
    /** Get time since last kick for a subsystem. */
    sinceLastKick(id: SubsystemId): number;
    private check;
    /** Get status of all subsystems. */
    getAllStatus(): Array<{
        id: SubsystemId;
        name: string;
        enabled: boolean;
        lastKick: number;
        ago: number;
        healthy: boolean;
        consecutiveTimeouts: number;
    }>;
    /** Get unhealthy subsystems. */
    getUnhealthy(): Array<{
        id: SubsystemId;
        name: string;
        overdue: number;
    }>;
}
//# sourceMappingURL=watchdog.d.ts.map
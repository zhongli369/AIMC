/**
 * Coordinator — multi-agent coordination foundation.
 *
 * Architecture for:
 *   - multiple AIMC agents
 *   - shared task coordination
 *   - role specialization
 *   - shared memory/event bus
 *
 * Phase 6: FOUNDATION ONLY (no full swarm implementation).
 */
import { EventEmitter } from "node:events";
import type { PlannedTask } from "../behavior/task-planner.js";
import type { PersonalityProfile } from "../personality/personality-profile.js";
export interface AgentDescriptor {
    id: string;
    name: string;
    role: AgentRole;
    profile: PersonalityProfile;
    status: "online" | "busy" | "idle" | "offline";
    currentTask?: string;
    lastHeartbeat: number;
}
export type AgentRole = "leader" | "miner" | "guard" | "builder" | "gatherer" | "explorer";
export interface RoleDefinition {
    role: AgentRole;
    description: string;
    preferredTasks: string[];
    complementaryRoles: AgentRole[];
}
export interface CoordinationMessage {
    from: string;
    to: string | "*";
    type: "task_offer" | "task_accept" | "task_decline" | "status_update" | "help_request" | "role_assign";
    payload: Record<string, unknown>;
    timestamp: number;
}
export declare class Coordinator extends EventEmitter {
    private agents;
    private messages;
    private maxMessages;
    registerAgent(descriptor: AgentDescriptor): void;
    unregisterAgent(agentId: string): void;
    updateHeartbeat(agentId: string): void;
    setAgentStatus(agentId: string, status: AgentDescriptor["status"]): void;
    getAgent(agentId: string): AgentDescriptor | null;
    getAllAgents(): AgentDescriptor[];
    getOnlineAgents(): AgentDescriptor[];
    /** Assign roles to maximize complementary coverage. */
    assignRoles(agents: AgentDescriptor[]): Map<string, AgentRole>;
    /** Recommend a role based on personality profile. */
    recommendRole(profile: PersonalityProfile): AgentRole;
    /** Broadcast a task offer to agents that could handle it. */
    broadcastTaskOffer(task: PlannedTask, offeredBy: string): void;
    /** Request help from a specific agent or broadcast. */
    requestHelp(fromAgent: string, need: string, priority?: number): void;
    private send;
    getRecentMessages(limit?: number): CoordinationMessage[];
    /**
     * Build a shared context summary for multi-agent awareness.
     * Each agent receives this in addition to its own context.
     */
    buildSharedContext(): string;
}
//# sourceMappingURL=coordinator.d.ts.map
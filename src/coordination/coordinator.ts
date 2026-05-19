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

// ─── Agent Descriptor ────────────────────────────────

export interface AgentDescriptor {
  id: string;
  name: string;
  role: AgentRole;
  profile: PersonalityProfile;
  status: "online" | "busy" | "idle" | "offline";
  currentTask?: string;
  lastHeartbeat: number;
}

// ─── Agent Role ──────────────────────────────────────

export type AgentRole = "leader" | "miner" | "guard" | "builder" | "gatherer" | "explorer";

export interface RoleDefinition {
  role: AgentRole;
  description: string;
  preferredTasks: string[];
  complementaryRoles: AgentRole[];
}

const ROLE_DEFINITIONS: Record<AgentRole, RoleDefinition> = {
  leader: {
    role: "leader",
    description: "Coordinates team, follows player, makes strategic decisions",
    preferredTasks: ["follow_player", "speak_chat", "assess_situation"],
    complementaryRoles: ["miner", "guard", "builder", "gatherer"],
  },
  miner: {
    role: "miner",
    description: "Mines ores, digs tunnels, collects stone and minerals",
    preferredTasks: ["mine_block", "dig_down", "collect_block"],
    complementaryRoles: ["guard", "leader"],
  },
  guard: {
    role: "guard",
    description: "Protects team from hostile mobs, patrols perimeter",
    preferredTasks: ["attack_entity", "defend_self", "patrol"],
    complementaryRoles: ["miner", "builder", "gatherer", "leader"],
  },
  builder: {
    role: "builder",
    description: "Constructs buildings, farms, redstone contraptions",
    preferredTasks: ["place_block", "craft_item", "use_block"],
    complementaryRoles: ["gatherer", "guard"],
  },
  gatherer: {
    role: "gatherer",
    description: "Collects resources, harvests crops, hunts for food",
    preferredTasks: ["collect_nearby_items", "collect_block", "consume"],
    complementaryRoles: ["guard", "builder"],
  },
  explorer: {
    role: "explorer",
    description: "Scouts new areas, maps terrain, finds structures",
    preferredTasks: ["move_to", "collect_block", "speak_chat"],
    complementaryRoles: ["guard"],
  },
};

// ─── Coordination Message ────────────────────────────

export interface CoordinationMessage {
  from: string;
  to: string | "*"; // Agent ID or broadcast
  type: "task_offer" | "task_accept" | "task_decline" | "status_update" | "help_request" | "role_assign";
  payload: Record<string, unknown>;
  timestamp: number;
}

// ─── Coordinator ─────────────────────────────────────

export class Coordinator extends EventEmitter {
  private agents: Map<string, AgentDescriptor> = new Map();
  private messages: CoordinationMessage[] = [];
  private maxMessages = 100;

  // ─── Agent Registry ────────────────────────────────

  registerAgent(descriptor: AgentDescriptor): void {
    this.agents.set(descriptor.id, descriptor);
    this.emit("agent_registered", descriptor);
    console.log(`[Coordinator] Agent registered: ${descriptor.name} (${descriptor.role})`);
  }

  unregisterAgent(agentId: string): void {
    this.agents.delete(agentId);
    this.emit("agent_unregistered", agentId);
  }

  updateHeartbeat(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.lastHeartbeat = Date.now();
      if (agent.status === "offline") agent.status = "idle";
    }
  }

  setAgentStatus(agentId: string, status: AgentDescriptor["status"]): void {
    const agent = this.agents.get(agentId);
    if (agent) agent.status = status;
  }

  getAgent(agentId: string): AgentDescriptor | null {
    return this.agents.get(agentId) || null;
  }

  getAllAgents(): AgentDescriptor[] {
    return [...this.agents.values()];
  }

  getOnlineAgents(): AgentDescriptor[] {
    return [...this.agents.values()].filter((a) => a.status !== "offline");
  }

  // ─── Role Assignment ───────────────────────────────

  /** Assign roles to maximize complementary coverage. */
  assignRoles(agents: AgentDescriptor[]): Map<string, AgentRole> {
    const assignments = new Map<string, AgentRole>();
    const takenRoles = new Set<AgentRole>();

    // Sort agents to assign leader first
    const sorted = [...agents].sort((a, b) => {
      if (a.profile.traits.helpfulness > 0.8) return -1;
      if (b.profile.traits.helpfulness > 0.8) return 1;
      return 0;
    });

    for (const agent of sorted) {
      const profile = agent.profile;

      // Determine best role from personality
      let role: AgentRole = "gatherer";

      if (profile.traits.helpfulness > 0.7 && profile.traits.sociability > 0.6) {
        role = takenRoles.has("leader") ? "gatherer" : "leader";
      } else if (profile.traits.aggressiveness > 0.7) {
        role = "guard";
      } else if (profile.traits.curiosity > 0.7 && profile.traits.independence > 0.6) {
        role = "explorer";
      } else if (profile.traits.helpfulness > 0.6 && profile.traits.cautiousness > 0.5) {
        role = "builder";
      } else if (profile.traits.curiosity > 0.5) {
        role = "miner";
      }

      takenRoles.add(role);
      assignments.set(agent.id, role);
    }

    return assignments;
  }

  /** Recommend a role based on personality profile. */
  recommendRole(profile: PersonalityProfile): AgentRole {
    // Score each role against personality traits
    const scores: [AgentRole, number][] = Object.keys(ROLE_DEFINITIONS).map((role) => {
      const def = ROLE_DEFINITIONS[role as AgentRole];
      let score = 0;

      switch (role) {
        case "leader":
          score = profile.traits.helpfulness * 0.4 + profile.traits.sociability * 0.4 + profile.traits.independence * 0.2;
          break;
        case "guard":
          score = profile.traits.aggressiveness * 0.5 + profile.traits.helpfulness * 0.3 + profile.traits.cautiousness * 0.2;
          break;
        case "miner":
          score = profile.traits.curiosity * 0.4 + profile.traits.independence * 0.3 + profile.traits.cautiousness * 0.1;
          break;
        case "builder":
          score = profile.traits.helpfulness * 0.3 + profile.traits.cautiousness * 0.4 + profile.traits.independence * 0.1;
          break;
        case "gatherer":
          score = profile.traits.helpfulness * 0.3 + profile.traits.independence * 0.3 + profile.traits.curiosity * 0.2;
          break;
        case "explorer":
          score = profile.traits.curiosity * 0.5 + profile.traits.independence * 0.3 + profile.traits.aggressiveness * 0.1;
          break;
        default:
          score = 0.3;
      }

      return [role as AgentRole, score];
    });

    scores.sort((a, b) => b[1] - a[1]);
    return scores[0][0];
  }

  // ─── Task Coordination ─────────────────────────────

  /** Broadcast a task offer to agents that could handle it. */
  broadcastTaskOffer(task: PlannedTask, offeredBy: string): void {
    const msg: CoordinationMessage = {
      from: offeredBy,
      to: "*",
      type: "task_offer",
      payload: {
        taskId: task.id,
        description: task.description,
        category: task.category,
        priority: task.priority,
      },
      timestamp: Date.now(),
    };

    this.send(msg);
  }

  /** Request help from a specific agent or broadcast. */
  requestHelp(fromAgent: string, need: string, priority: number = 3): void {
    const msg: CoordinationMessage = {
      from: fromAgent,
      to: "*",
      type: "help_request",
      payload: { need, priority },
      timestamp: Date.now(),
    };

    this.send(msg);
  }

  // ─── Messaging ─────────────────────────────────────

  private send(msg: CoordinationMessage): void {
    this.messages.push(msg);
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages);
    }
    this.emit("message", msg);
  }

  getRecentMessages(limit: number = 20): CoordinationMessage[] {
    return this.messages.slice(-limit);
  }

  // ─── Shared Context ────────────────────────────────

  /**
   * Build a shared context summary for multi-agent awareness.
   * Each agent receives this in addition to its own context.
   */
  buildSharedContext(): string {
    const online = this.getOnlineAgents();
    if (online.length <= 1) return "";

    const lines = ["[TEAM STATUS]"];
    for (const agent of online) {
      lines.push(`- ${agent.name} [${agent.role}] — ${agent.status}${agent.currentTask ? ` (task: ${agent.currentTask})` : ""}`);
    }
    return lines.join("\n");
  }
}

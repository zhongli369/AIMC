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
const ROLE_DEFINITIONS = {
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
// ─── Coordinator ─────────────────────────────────────
export class Coordinator extends EventEmitter {
    agents = new Map();
    messages = [];
    maxMessages = 100;
    // ─── Agent Registry ────────────────────────────────
    registerAgent(descriptor) {
        this.agents.set(descriptor.id, descriptor);
        this.emit("agent_registered", descriptor);
        console.log(`[Coordinator] Agent registered: ${descriptor.name} (${descriptor.role})`);
    }
    unregisterAgent(agentId) {
        this.agents.delete(agentId);
        this.emit("agent_unregistered", agentId);
    }
    updateHeartbeat(agentId) {
        const agent = this.agents.get(agentId);
        if (agent) {
            agent.lastHeartbeat = Date.now();
            if (agent.status === "offline")
                agent.status = "idle";
        }
    }
    setAgentStatus(agentId, status) {
        const agent = this.agents.get(agentId);
        if (agent)
            agent.status = status;
    }
    getAgent(agentId) {
        return this.agents.get(agentId) || null;
    }
    getAllAgents() {
        return [...this.agents.values()];
    }
    getOnlineAgents() {
        return [...this.agents.values()].filter((a) => a.status !== "offline");
    }
    // ─── Role Assignment ───────────────────────────────
    /** Assign roles to maximize complementary coverage. */
    assignRoles(agents) {
        const assignments = new Map();
        const takenRoles = new Set();
        // Sort agents to assign leader first
        const sorted = [...agents].sort((a, b) => {
            if (a.profile.traits.helpfulness > 0.8)
                return -1;
            if (b.profile.traits.helpfulness > 0.8)
                return 1;
            return 0;
        });
        for (const agent of sorted) {
            const profile = agent.profile;
            // Determine best role from personality
            let role = "gatherer";
            if (profile.traits.helpfulness > 0.7 && profile.traits.sociability > 0.6) {
                role = takenRoles.has("leader") ? "gatherer" : "leader";
            }
            else if (profile.traits.aggressiveness > 0.7) {
                role = "guard";
            }
            else if (profile.traits.curiosity > 0.7 && profile.traits.independence > 0.6) {
                role = "explorer";
            }
            else if (profile.traits.helpfulness > 0.6 && profile.traits.cautiousness > 0.5) {
                role = "builder";
            }
            else if (profile.traits.curiosity > 0.5) {
                role = "miner";
            }
            takenRoles.add(role);
            assignments.set(agent.id, role);
        }
        return assignments;
    }
    /** Recommend a role based on personality profile. */
    recommendRole(profile) {
        // Score each role against personality traits
        const scores = Object.keys(ROLE_DEFINITIONS).map((role) => {
            const def = ROLE_DEFINITIONS[role];
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
            return [role, score];
        });
        scores.sort((a, b) => b[1] - a[1]);
        return scores[0][0];
    }
    // ─── Task Coordination ─────────────────────────────
    /** Broadcast a task offer to agents that could handle it. */
    broadcastTaskOffer(task, offeredBy) {
        const msg = {
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
    requestHelp(fromAgent, need, priority = 3) {
        const msg = {
            from: fromAgent,
            to: "*",
            type: "help_request",
            payload: { need, priority },
            timestamp: Date.now(),
        };
        this.send(msg);
    }
    // ─── Messaging ─────────────────────────────────────
    send(msg) {
        this.messages.push(msg);
        if (this.messages.length > this.maxMessages) {
            this.messages = this.messages.slice(-this.maxMessages);
        }
        this.emit("message", msg);
    }
    getRecentMessages(limit = 20) {
        return this.messages.slice(-limit);
    }
    // ─── Shared Context ────────────────────────────────
    /**
     * Build a shared context summary for multi-agent awareness.
     * Each agent receives this in addition to its own context.
     */
    buildSharedContext() {
        const online = this.getOnlineAgents();
        if (online.length <= 1)
            return "";
        const lines = ["[TEAM STATUS]"];
        for (const agent of online) {
            lines.push(`- ${agent.name} [${agent.role}] — ${agent.status}${agent.currentTask ? ` (task: ${agent.currentTask})` : ""}`);
        }
        return lines.join("\n");
    }
}
//# sourceMappingURL=coordinator.js.map
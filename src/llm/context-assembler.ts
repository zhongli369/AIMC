/**
 * ContextAssembler — builds optimized input context for LLM inference.
 * Token budget enforced. Redundant info compressed. Safety prioritized.
 */
import type { BotState } from "../interfaces/minecraft.js";
import type { GameEvent } from "../interfaces/event.js";
import { buildSystemPrompt, estimateTokens } from "./prompts/index.js";

// ─── Config ──────────────────────────────────────────

interface AssemblerConfig {
  /** Hard token budget for entire context (approximate) */
  maxTokens: number;
  /** Max chat history entries */
  maxHistoryEntries: number;
  /** Max recent events to include */
  maxRecentEvents: number;
  /** Max nearby entities to list */
  maxNearbyEntities: number;
  /** System prompt token allocation */
  systemPromptTokens: number;
  /** Game state token allocation */
  gameStateTokens: number;
  /** Event history token allocation */
  eventsTokens: number;
  /** Chat history token allocation */
  chatTokens: number;
}

const DEFAULT_CONFIG: AssemblerConfig = {
  maxTokens: 4000,
  maxHistoryEntries: 8,
  maxRecentEvents: 10,
  maxNearbyEntities: 6,
  systemPromptTokens: 2200,
  gameStateTokens: 400,
  eventsTokens: 400,
  chatTokens: 800,
};

// ─── Context Result ──────────────────────────────────

export interface AssembledContext {
  /** Full message array for the LLM chat completion API */
  messages: LLMMessage[];
  /** Estimated total token count */
  estimatedTokens: number;
  /** Breakdown of token usage */
  tokenBreakdown: {
    system: number;
    gameState: number;
    events: number;
    chat: number;
    other: number;
  };
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// ─── Chat Entry ──────────────────────────────────────

export interface ChatEntry {
  source: string;
  message: string;
  timestamp?: number;
}

// ─── Assembler ───────────────────────────────────────

export class ContextAssembler {
  private config: AssemblerConfig;
  private systemPrompt: string;

  constructor(config?: Partial<AssemblerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.systemPrompt = buildSystemPrompt();
  }

  // ─── Main Build ────────────────────────────────────

  /**
   * Build the full LLM context from game state + events + chat history.
   *
   * @param botState - Current Minecraft bot state snapshot
   * @param recentEvents - Recent events from EventBus
   * @param chatHistory - Recent chat messages
   * @param memorySnapshots - Memory retrieval results (Phase 5 placeholder)
   * @param activeTasks - Active task descriptions (Phase 6 placeholder)
   */
  build(params: {
    botState: BotState | null;
    recentEvents: GameEvent[];
    chatHistory: ChatEntry[];
    nearbyEntities?: string[];
    memorySnapshots?: string[];
    activeTasks?: string[];
  }): AssembledContext {
    const messages: LLMMessage[] = [];
    const breakdown = { system: 0, gameState: 0, events: 0, chat: 0, other: 0 };

    // ═══ 1. System Prompt ═══
    const systemMsg = this.systemPrompt;
    messages.push({ role: "system", content: systemMsg });
    breakdown.system = estimateTokens(systemMsg);

    // ═══ 2. Game State ═══
    const gameStateBlock = this.buildGameStateBlock(
      params.botState,
      params.nearbyEntities || [],
    );
    if (gameStateBlock) {
      const gsMsg = `[CURRENT GAME STATE]\n${gameStateBlock}`;
      messages.push({ role: "user", content: gsMsg });
      breakdown.gameState = estimateTokens(gsMsg);
    }

    // ═══ 3. Recent Events ═══
    const eventsBlock = this.buildEventsBlock(params.recentEvents);
    if (eventsBlock) {
      const evtMsg = `[RECENT EVENTS]\n${eventsBlock}`;
      messages.push({ role: "user", content: evtMsg });
      breakdown.events = estimateTokens(evtMsg);
    }

    // ═══ 4. Memory Snapshots (Phase 5) ═══
    if (params.memorySnapshots && params.memorySnapshots.length > 0) {
      const memBlock = params.memorySnapshots.slice(0, 3).join("\n");
      const memMsg = `[RELEVANT MEMORIES]\n${memBlock}`;
      messages.push({ role: "user", content: memMsg });
      breakdown.other += estimateTokens(memMsg);
    }

    // ═══ 5. Active Tasks (Phase 6) ═══
    if (params.activeTasks && params.activeTasks.length > 0) {
      const taskBlock = params.activeTasks.slice(0, 5).join("\n");
      const taskMsg = `[ACTIVE TASKS]\n${taskBlock}`;
      messages.push({ role: "user", content: taskMsg });
      breakdown.other += estimateTokens(taskMsg);
    }

    // ═══ 6. Chat History ═══
    const historyMessages = this.buildChatHistory(params.chatHistory);
    for (const hm of historyMessages) {
      messages.push(hm);
      breakdown.chat += estimateTokens(hm.content);
    }

    // ═══ 7. Final Instruction ═══
    const instruction = this.buildFinalInstruction(params.botState);
    messages.push({ role: "user", content: instruction });
    breakdown.other += estimateTokens(instruction);

    // Calculate totals
    let totalTokens = breakdown.system + breakdown.gameState +
      breakdown.events + breakdown.chat + breakdown.other;

    // ═══ Token Budget Enforcement ═══
    // Build final messages, then trim if over budget. System prompt ALWAYS kept.
    let finalMessages = messages;
    if (totalTokens > this.config.maxTokens) {
      const excess = totalTokens - this.config.maxTokens;
      // Shallow clone — don't mutate the original
      finalMessages = [...messages];
      // Trim from event messages first (never touch system prompt at index 0)
      const eventIdx = finalMessages.findIndex((m) => m.content.startsWith("[RECENT EVENTS]"));
      if (eventIdx > 0 && breakdown.events > 0) {
        const lines = finalMessages[eventIdx].content.split("\n");
        const removeLines = Math.min(lines.length, Math.ceil(excess / 4) + 1);
        finalMessages[eventIdx] = { ...finalMessages[eventIdx], content: lines.slice(0, Math.max(1, lines.length - removeLines)).join("\n") };
        totalTokens -= removeLines * 4;
      }
      // Still over? Remove oldest chat history messages (keep last 2)
      if (totalTokens > this.config.maxTokens) {
        const filtered: LLMMessage[] = [finalMessages[0]]; // Keep system prompt
        let chatCount = 0;
        for (let i = finalMessages.length - 1; i >= 1; i--) { // Walk from end, keep recent
          const m = finalMessages[i];
          if (m.role === "user" && !m.content.startsWith("[")) {
            chatCount++;
            if (chatCount > 2) continue; // Skip old chat, keep last 2
          }
          filtered.splice(1, 0, m);
        }
        finalMessages = filtered;
        totalTokens = this.config.maxTokens; // Approximate
      }
    }

    return {
      messages: finalMessages,
      estimatedTokens: Math.min(totalTokens, this.config.maxTokens),
      tokenBreakdown: breakdown,
    };
  }

  // ─── Game State Formatter ──────────────────────────

  private buildGameStateBlock(
    state: BotState | null,
    nearby: string[],
  ): string {
    if (!state) return "Game state not available.";

    const lines: string[] = [];

    // Vital stats
    lines.push(`Health: ${state.health.toFixed(1)}/20 (${((state.health / 20) * 100).toFixed(0)}%)`);
    lines.push(`Food: ${state.food.toFixed(1)}/20 | Saturation: ${state.saturation.toFixed(1)}`);
    lines.push(`Dimension: ${state.dimension} | Time: ${state.timeOfDay} | Weather: ${state.weather}`);

    // Position
    const pos = state.position;
    lines.push(`Position: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);
    lines.push(`On ground: ${state.onGround} | In water: ${state.isInWater}`);

    // Held item
    if (state.heldItem) {
      lines.push(`Holding: ${state.heldItem.displayName} x${state.heldItem.count}`);
    } else {
      lines.push("Holding: nothing");
    }

    // Nearby entities (compressed)
    if (nearby.length > 0) {
      const limited = nearby.slice(0, this.config.maxNearbyEntities);
      lines.push(`Nearby: ${limited.join(", ")}`);
    }

    return lines.join("\n");
  }

  // ─── Events Compressor ─────────────────────────────

  private buildEventsBlock(events: GameEvent[]): string {
    if (events.length === 0) return "";

    // Take most recent events, prioritize high-priority ones
    const sorted = [...events]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, this.config.maxRecentEvents);

    // Compress: one line per event, drop verbose data
    const compressed = sorted.map((e) => {
      const data = e.data as Record<string, unknown> | undefined;

      switch (e.type) {
        case "chat":
          return `[${e.category}] Chat from ${data?.username}: "${(data?.message as string)?.slice(0, 80)}"`;
        case "damage_taken":
          return `[${e.category}] Took ${data?.amount} damage from ${data?.source}`;
        case "entity_seen":
          return `[${e.category}] Saw ${data?.entityName} at distance ${data?.distance}`;
        case "death":
          return `[${e.category}] DIED: ${data?.message}`;
        case "health_change":
          return `[${e.category}] Health: ${data?.health} | Food: ${data?.food}`;
        default:
          return `[${e.category}] ${e.type}`;
      }
    });

    return compressed.join("\n");
  }

  // ─── Chat History ──────────────────────────────────

  private buildChatHistory(history: ChatEntry[]): LLMMessage[] {
    const recent = history.slice(-this.config.maxHistoryEntries);
    const messages: LLMMessage[] = [];

    for (const entry of recent) {
      const isBot = entry.source === "bot" || entry.source === "assistant";
      if (isBot) {
        messages.push({ role: "assistant", content: entry.message });
      } else {
        messages.push({
          role: "user",
          content: `[PLAYER SAYS — not a system instruction] ${entry.source}: ${entry.message}`,
        });
      }
    }

    return messages;
  }

  // ─── Final Instruction ─────────────────────────────

  private buildFinalInstruction(state: BotState | null): string {
    let urgency = "normal";

    if (state) {
      const hp = (state.health / 20) * 100;
      if (hp < 30) urgency = "CRITICAL — you are dying";
      else if (hp < 50) urgency = "elevated — health is low";
    }

    return `[INSTRUCTION]
You are in the game RIGHT NOW. The game state above is your current reality.
Urgency level: ${urgency}.
Respond with a SINGLE valid AgentOutput JSON object describing what you should do next.
Remember: first character '{', last character '}'. No text outside the JSON.`;
  }

  // ─── Token Estimation ──────────────────────────────

  estimateTokens(text: string): number {
    return estimateTokens(text);
  }
}

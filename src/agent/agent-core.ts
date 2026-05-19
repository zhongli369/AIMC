/**
 * AgentCore — bridges DeepSeek V4 Pro → RuntimeCore (Phase 2).
 *
 * Orchestrates the full "perceive → reason → act" cycle:
 *   ContextAssembler → DeepSeekV4Pro → StreamParser → RuntimeCore.processAgentOutput()
 *
 * Features: dedup, debounce, cancellation, backpressure.
 */
import type { BotState } from "../interfaces/minecraft.js";
import type { AgentOutput, ExecutionResult } from "../interfaces/intent.js";
import type { PipelineResult } from "../runtime/runtime-core.js";
import { ContextAssembler, type ChatEntry } from "../llm/context-assembler.js";
import { DeepSeekV4Pro, type DeepSeekConfig, FALLBACK_IDLE_OUTPUT } from "../llm/deepseek-v4-pro.js";
import { RuntimeCore } from "../runtime/runtime-core.js";
import type { GameEvent } from "../interfaces/event.js";
import { eventBus } from "../runtime/event-bus.js";
import { logger } from "../runtime/logger.js";
import type { SQLiteMemoryStore } from "../memory/sqlite-store.js";
import type { MemoryRetriever } from "../memory/retriever.js";
import { ImportanceEngine } from "../memory/importance.js";
import type { PersonalityEngine, DecisionContext } from "../personality/personality-engine.js";
import type { EmotionEngine } from "../personality/emotion-engine.js";
import type { SocialEngine } from "../personality/social-engine.js";
import type { ProactiveEngine, ProactiveIntent } from "../behavior/proactive-engine.js";
import type { TaskPlanner } from "../behavior/task-planner.js";
import { HeuristicEngine, type NearbyInfo } from "../heuristics/index.js";

// ─── Config ──────────────────────────────────────────

export interface AgentCoreConfig {
  /** Minimum ms between think cycles */
  debounceMs: number;
  /** DeepSeek API configuration */
  deepseek: DeepSeekConfig;
  /** Max concurrent think cycles (1 = no overlap) */
  maxConcurrent: number;
  /** Whether to emit events for every think cycle */
  verboseEvents: boolean;
}

const DEFAULT_AGENT_CONFIG: Partial<AgentCoreConfig> = {
  debounceMs: 500,
  maxConcurrent: 1,
  verboseEvents: false,
};

// ─── Think Result ────────────────────────────────────

export interface ThinkResult {
  /** Whether the think cycle produced any output */
  completed: boolean;
  /** The LLM output (if valid) */
  agentOutput?: AgentOutput;
  /** Results from RuntimeCore execution */
  executionResults: ExecutionResult[];
  /** Pipeline result summary */
  pipelineResult: PipelineResult | null;
  /** Latency breakdown */
  timing: {
    contextMs: number;
    llmMs: number;
    validationMs: number;
    executionMs: number;
    totalMs: number;
  };
  /** Whether this was a fallback (LLM failed) */
  fallback: boolean;
}

// ─── Agent State ─────────────────────────────────────

export type AgentState = "idle" | "thinking" | "executing" | "error";

// ─── AgentCore ───────────────────────────────────────

export class AgentCore {
  private config: AgentCoreConfig;
  private deepseek: DeepSeekV4Pro;
  private assembler: ContextAssembler;
  private runtimeCore: RuntimeCore;
  private state: AgentState = "idle";
  private lastThinkTime = 0;
  private activeRequest: AbortController | null = null;
  private pendingThink: (() => void) | null = null;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private heuristicEngine: HeuristicEngine | null = null;

  // Phase 5: Memory system
  private memoryStore: SQLiteMemoryStore | null = null;
  private memoryRetriever: MemoryRetriever | null = null;
  private importanceEngine: ImportanceEngine = new ImportanceEngine();

  // Phase 6: Personality + Proactive system
  private personalityEngine: PersonalityEngine | null = null;
  private emotionEngine: EmotionEngine | null = null;
  private socialEngine: SocialEngine | null = null;
  private proactiveEngine: ProactiveEngine | null = null;
  private taskPlanner: TaskPlanner | null = null;
  private proactiveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    runtimeCore: RuntimeCore,
    deepseekConfig: DeepSeekConfig,
    config?: Partial<AgentCoreConfig>,
  ) {
    this.config = { ...DEFAULT_AGENT_CONFIG, ...config } as AgentCoreConfig;
    this.runtimeCore = runtimeCore;
    this.deepseek = new DeepSeekV4Pro(deepseekConfig);
    this.assembler = new ContextAssembler();
  }

  /** Wire Phase 5 memory backend into the agent. */
  setMemoryBackend(store: SQLiteMemoryStore, retriever: MemoryRetriever): void {
    this.memoryStore = store;
    this.memoryRetriever = retriever;
    console.log("[AgentCore] Memory backend wired — retrieval + storage active");
  }

  /** Wire Phase 6 personality + proactive systems. */
  setPersonalityBackend(params: {
    personality: PersonalityEngine;
    emotion: EmotionEngine;
    social: SocialEngine;
    proactive: ProactiveEngine;
    tasks: TaskPlanner;
  }): void {
    this.personalityEngine = params.personality;
    this.emotionEngine = params.emotion;
    this.socialEngine = params.social;
    this.proactiveEngine = params.proactive;
    this.taskPlanner = params.tasks;
    console.log("[AgentCore] Personality+Proactive backend wired — autonomous teammate active");
  }

  /** Wire heuristic engine — enables non-LLM fast path for survival actions. */
  setHeuristicEngine(engine: HeuristicEngine): void {
    this.heuristicEngine = engine;
  }

  /** Start the proactive behavior loop. */
  startProactiveLoop(intervalMs: number = 5000): void {
    if (this.proactiveTimer) return;
    this.proactiveTimer = setInterval(() => this.proactiveTick(), intervalMs);
    console.log(`[AgentCore] Proactive loop started — ${intervalMs}ms interval`);
  }

  /** Stop the proactive behavior loop. */
  stopProactiveLoop(): void {
    if (this.proactiveTimer) {
      clearInterval(this.proactiveTimer);
      this.proactiveTimer = null;
    }
  }

  // ─── Main Think Cycle ──────────────────────────────

  /**
   * Execute a full think cycle: context → LLM → validate → execute.
   * This is the PRIMARY entry point for triggering the agent.
   *
   * @param botState - Current Minecraft bot state snapshot
   * @param chatMessage - Optional new chat message from a player
   * @param recentEvents - Recent game events from EventBus
   * @param chatHistory - Recent chat history
   */
  async think(params: {
    botState: BotState | null;
    chatMessage?: { source: string; message: string };
    recentEvents?: GameEvent[];
    chatHistory?: ChatEntry[];
    nearbyEntities?: string[];
  }): Promise<ThinkResult> {
    const totalStart = Date.now();
    const timing = { contextMs: 0, llmMs: 0, validationMs: 0, executionMs: 0, totalMs: 0 };

    // ── Dedup/Debounce ────────────────────────────
    const now = Date.now();
    const elapsed = now - this.lastThinkTime;

    if (this.state === "thinking" || this.state === "executing") {
      // Cancel previous in-flight request
      this.cancelActiveRequest();

      if (elapsed < this.config.debounceMs) {
        // Queue for execution after debounce window
        if (this._debounceTimer) clearTimeout(this._debounceTimer);
        await new Promise<void>((r) => {
          this.pendingThink = r;
          this._debounceTimer = setTimeout(() => {
            this.pendingThink?.();
            this.pendingThink = null;
            this._debounceTimer = null;
          }, this.config.debounceMs - elapsed);
        });
      }
    }

    this.state = "thinking";
    this.lastThinkTime = Date.now();
    this.activeRequest = new AbortController();

    try {
      // ═══ PERCEIVE: Build context ═══
      const contextStart = Date.now();

      const events = params.recentEvents || eventBus.getRecentEvents(30000, 20);
      const chatHistory = params.chatHistory || [];
      if (params.chatMessage) {
        chatHistory.push({
          source: params.chatMessage.source,
          message: params.chatMessage.message,
          timestamp: Date.now(),
        });
      }

      // Phase 5: Memory retrieval
      let memorySnapshots: string[] | undefined;
      if (this.memoryStore && this.memoryRetriever) {
        try {
          const queryText = params.chatMessage?.message
            || events.slice(0, 3).map((e) => `${e.category}:${e.type}`).join(" ");
          const retrieval = await this.memoryRetriever.retrieve({
            store: this.memoryStore,
            queryText,
            currentLocation: params.botState?.position
              ? { x: params.botState.position.x, y: params.botState.position.y, z: params.botState.position.z }
              : undefined,
            limit: 5,
          });
          if (retrieval.contextText) {
            memorySnapshots = [retrieval.contextText];
          }
        } catch (err) {
          // Memory retrieval failure is non-fatal — continue without memories
          console.warn("[AgentCore] Memory retrieval failed:", (err as Error).message);
        }
      }

      const assembled = this.assembler.build({
        botState: params.botState,
        recentEvents: events,
        chatHistory,
        nearbyEntities: params.nearbyEntities,
        memorySnapshots,
      });

      // Phase 6: Inject personality-driven behavior hints
      if (this.personalityEngine && this.emotionEngine) {
        const decisionCtx: DecisionContext = {
          healthPercent: params.botState ? (params.botState.health / 20) * 100 : 100,
          nearbyHostiles: params.nearbyEntities?.filter((e) =>
            /zombie|skeleton|creeper|spider|witch/i.test(e),
          ).length || 0,
          playerNearby: params.nearbyEntities?.some((e) => /\(\d+m\)/.test(e)) || false,
          idleTimeMs: Date.now() - this.lastThinkTime,
          recentFailures: 0,
        };
        const hints = this.personalityEngine.getBehaviorHints(decisionCtx);
        if (hints.length > 0) {
          assembled.messages.push({
            role: "system",
            content: `[BEHAVIOR HINTS]\n${hints.join("\n")}`,
          });
        }
      }

      // Phase 6: Inject active task context
      if (this.taskPlanner) {
        const activeTask = this.taskPlanner.getActiveTask();
        if (activeTask) {
          const step = activeTask.steps[activeTask.currentStep] || "complete task";
          assembled.messages.push({
            role: "system",
            content: `[ACTIVE TASK] ${activeTask.description}\nCurrent step: ${step} (${activeTask.currentStep + 1}/${activeTask.steps.length})`,
          });
        }
      }

      timing.contextMs = Date.now() - contextStart;

      if (this.config.verboseEvents) {
        logger.intentReceived({
          id: `think-${Date.now()}`,
          type: "__think_cycle__" as any,
          target: {},
          priority: 1 as const,
          reason: `Context: ${assembled.estimatedTokens} tokens`,
        });
      }

      // ═══ HEURISTIC FAST PATH: survival actions skip LLM ═══
      if (this.heuristicEngine && params.botState) {
        const nearby = this.classifyNearby(params.nearbyEntities || []);
        const heuristicResult = this.heuristicEngine.evaluate({
          botState: params.botState,
          nearby,
        });
        if (heuristicResult?.decided && heuristicResult.category === "survival") {
          timing.llmMs = 0;
          timing.validationMs = 0;
          const pipelineResult = await this.runtimeCore.processAgentOutput(heuristicResult.output!);
          timing.executionMs = performance.now() - totalStart - timing.contextMs;
          timing.totalMs = Date.now() - totalStart;
          this.state = "idle";
          return {
            completed: true,
            agentOutput: heuristicResult.output!,
            executionResults: pipelineResult.results,
            pipelineResult,
            timing,
            fallback: false,
          };
        }
      }

      // ═══ REASON: Call LLM ═══
      const llmStart = Date.now();

      const llmResult = await this.deepseek.generate(
        assembled.messages,
        { signal: this.activeRequest.signal },
      );

      timing.llmMs = Date.now() - llmStart;

      if (!llmResult.success || !llmResult.output) {
        // LLM failed — fallback
        timing.totalMs = Date.now() - totalStart;
        this.state = "idle";
        logger.actionFailed(
          { id: "llm-fail", type: "__think_cycle__" as any, target: {}, priority: 1 as const, reason: "LLM failure" },
          { actionId: "llm-fail", success: false, message: llmResult.error || "LLM failed", interrupted: false, timedOut: llmResult.timedOut },
          timing.llmMs,
        );

        return {
          completed: false,
          executionResults: [],
          pipelineResult: null,
          timing,
          fallback: true,
        };
      }

      // ═══ VALIDATE + EXECUTE: Through RuntimeCore ═══
      const validationStart = Date.now();
      const pipelineResult = await this.runtimeCore.processAgentOutput(llmResult.output);
      timing.validationMs = Date.now() - validationStart;

      // Phase 5: Save memory candidates from LLM output
      const agentOutput = llmResult.output as Record<string, unknown>;
      if (this.memoryStore && agentOutput.memory_save) {
        this.saveMemoryCandidate(agentOutput.memory_save, params.botState).catch((err) => {
          console.warn("[AgentCore] Memory save failed:", (err as Error).message);
        });
      }

      timing.executionMs = 0; // Included in pipeline
      timing.totalMs = Date.now() - totalStart;

      this.state = "idle";

      return {
        completed: true,
        agentOutput: llmResult.output as unknown as AgentOutput,
        executionResults: pipelineResult.results,
        pipelineResult,
        timing,
        fallback: false,
      };
    } catch (err) {
      timing.totalMs = Date.now() - totalStart;
      this.state = "error";

      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.actionFailed(
        { id: "think-error", type: "__think_cycle__" as any, target: {}, priority: 1 as const, reason: errorMsg },
        { actionId: "think-error", success: false, message: errorMsg, interrupted: false, timedOut: false },
        timing.totalMs,
      );

      return {
        completed: false,
        executionResults: [],
        pipelineResult: null,
        timing,
        fallback: true,
      };
    } finally {
      this.activeRequest = null;
    }
  }

  // ─── Lifecycle ─────────────────────────────────────

  cancelActiveRequest(): void {
    if (this.activeRequest) {
      this.activeRequest.abort();
      this.activeRequest = null;
    }
    this.deepseek.cancel();
  }

  getState(): AgentState {
    return this.state;
  }

  isBusy(): boolean {
    return this.state === "thinking" || this.state === "executing";
  }

  // ─── Phase 6: Proactive Loop ──────────────────────

  /**
   * Periodic proactive evaluation — generates autonomous intents
   * based on personality, emotion, and current game state.
   */
  private async proactiveTick(): Promise<void> {
    if (!this.proactiveEngine || !this.personalityEngine) return;
    if (this.isBusy()) return; // Don't interrupt active thinking

    try {
      const bridge = (globalThis as any).__aimc__;
      const botState = bridge?.getBotState?.() || null;
      const intents = await this.proactiveEngine.evaluate({
        botState,
        recentEvents: eventBus.getRecentEvents(30000, 10),
        nearbyEntities: bridge?.getNearbyEntities?.() || [],
      });
      if (intents.length === 0) return;

      for (const intent of intents) {
        if (intent.requireLLM) {
          // Submit to full think cycle for LLM-validated actions
          await this.think({
            botState: null,
            chatMessage: {
              source: "proactive_engine",
              message: `[PROACTIVE] ${intent.reason}. Suggested action: ${intent.actionType}.`,
            },
          });
        } else {
          // Heuristic: execute directly through RuntimeCore
          const result = await this.runtimeCore.processAgentOutput({
            speech: intent.actionType === "speak_chat" ? { text: (intent.target as any)?.text || intent.reason, tone: "friendly" } : undefined,
            actions: [{
              id: `proactive-${Date.now()}`,
              type: intent.actionType,
              target: intent.target || {},
              priority: intent.priority,
              reason: intent.reason,
            }],
          });
          if (result.results.length > 0) {
            console.log(`[AgentCore] Proactive: ${intent.actionType} — ${intent.reason}`);
          }
        }
      }
    } catch (err) {
      console.warn("[AgentCore] Proactive tick failed:", (err as Error).message);
    }
  }

  // ─── Convenience Methods ───────────────────────────

  /**
   * Quick response: just generate speech, no actions.
   * Lower-latency path for chat-only interactions.
   */
  async quickChat(
    botState: BotState,
    chatHistory: ChatEntry[],
    userMessage: string,
  ): Promise<string | null> {
    const messages = [
      { role: "system" as const, content: "Respond to the player with ONLY a JSON object with a 'speech' field and empty actions array. Be brief. Use AgentOutput schema." },
      { role: "user" as const, content: `Player says: "${userMessage}"\nRespond briefly.` },
    ];

    const result = await this.deepseek.generate(messages);
    return result.output?.speech?.text || null;
  }

  /**
   * Emergency assessment: low-latency call to assess danger level.
   * Used by SafetyGuard to determine if emergency stop is needed.
   */
  async assessDanger(botState: BotState, recentDamage: GameEvent[]): Promise<"safe" | "caution" | "danger"> {
    if (botState.health < 6) return "danger";
    if (botState.health < 12) return "caution";

    const recentHits = recentDamage.filter(
      (e) => e.type === "damage_taken" && Date.now() - e.timestamp < 5000,
    );
    if (recentHits.length > 3) return "danger";
    if (recentHits.length > 1) return "caution";

    return "safe";
  }

  // ─── Phase 5: Memory Save ──────────────────────────

  private async saveMemoryCandidate(
    raw: unknown,
    botState: BotState | null,
  ): Promise<void> {
    if (!this.memoryStore) return;

    const mc = raw as Record<string, unknown>;
    const type = (mc.type as string) || "event";

    const candidate = {
      type: type as any,
      summary: (mc.summary as string) || "",
      details: (mc.details as string) || (mc.summary as string) || "",
      importance: this.importanceEngine.score({
        type: type as any,
        summary: (mc.summary as string) || "",
        details: (mc.details as string) || "",
        importance: (mc.importance as number) || 5,
        emotionalValence: (mc.emotionalValence as number) ?? 0,
        tags: (mc.tags as string[]) || [],
        relatedEntities: [],
        location: botState?.position
          ? { x: botState.position.x, y: botState.position.y, z: botState.position.z }
          : undefined,
      }),
      emotionalValence: (mc.emotionalValence as number) ?? 0,
      tags: (mc.tags as string[]) || [],
      relatedEntities: [],
      location: botState?.position
        ? { x: botState.position.x, y: botState.position.y, z: botState.position.z, dimension: botState.dimension }
        : undefined,
      source: "llm" as const,
    };

    const saved = await this.memoryStore.save(candidate);
    console.log(`[AgentCore] Memory saved: [${saved.type}] ${saved.summary.slice(0, 80)} (importance: ${saved.importance})`);
  }

  /** Classify entity strings into categories for heuristic engine. */
  private classifyNearby(entities: string[]): NearbyInfo {
    const hostileKeywords = ["zombie", "skeleton", "creeper", "spider", "witch", "hoglin", "piglin_brute", "enderman", "warden", "blaze", "ghast"];
    const projectileKeywords = ["arrow", "fireball", "trident", "snowball"];
    const itemKeywords = ["item", "drop", "experience_orb", "xp"];

    const hostiles: string[] = [];
    const projectiles: string[] = [];
    const items: string[] = [];
    const players: string[] = [];
    const other: string[] = [];

    for (const e of entities) {
      const lower = e.toLowerCase();
      if (hostileKeywords.some((h) => lower.includes(h))) {
        hostiles.push(e);
      } else if (projectileKeywords.some((p) => lower.includes(p))) {
        projectiles.push(e);
      } else if (itemKeywords.some((i) => lower.includes(i))) {
        items.push(e);
      } else if (lower.includes("player") || /\(\d+m\)/.test(e)) {
        players.push(e);
      } else {
        other.push(e);
      }
    }

    return { entities: entities, hostiles, items, players, projectiles: projectiles };
  }
}

// Re-export for convenience
export { FALLBACK_IDLE_OUTPUT };

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
import { type ChatEntry } from "../llm/context-assembler.js";
import { type DeepSeekConfig, FALLBACK_IDLE_OUTPUT } from "../llm/deepseek-v4-pro.js";
import { RuntimeCore } from "../runtime/runtime-core.js";
import type { GameEvent } from "../interfaces/event.js";
import type { SQLiteMemoryStore } from "../memory/sqlite-store.js";
import type { MemoryRetriever } from "../memory/retriever.js";
import type { PersonalityEngine } from "../personality/personality-engine.js";
import type { EmotionEngine } from "../personality/emotion-engine.js";
import type { SocialEngine } from "../personality/social-engine.js";
import type { ProactiveEngine } from "../behavior/proactive-engine.js";
import type { TaskPlanner } from "../behavior/task-planner.js";
import { HeuristicEngine } from "../heuristics/index.js";
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
export type AgentState = "idle" | "thinking" | "executing" | "error";
export declare class AgentCore {
    private config;
    private deepseek;
    private assembler;
    private runtimeCore;
    private state;
    private lastThinkTime;
    private activeRequest;
    private pendingThink;
    private _debounceTimer;
    private heuristicEngine;
    private memoryStore;
    private memoryRetriever;
    private importanceEngine;
    private personalityEngine;
    private emotionEngine;
    private socialEngine;
    private proactiveEngine;
    private taskPlanner;
    private proactiveTimer;
    constructor(runtimeCore: RuntimeCore, deepseekConfig: DeepSeekConfig, config?: Partial<AgentCoreConfig>);
    /** Wire Phase 5 memory backend into the agent. */
    setMemoryBackend(store: SQLiteMemoryStore, retriever: MemoryRetriever): void;
    /** Wire Phase 6 personality + proactive systems. */
    setPersonalityBackend(params: {
        personality: PersonalityEngine;
        emotion: EmotionEngine;
        social: SocialEngine;
        proactive: ProactiveEngine;
        tasks: TaskPlanner;
    }): void;
    /** Wire heuristic engine — enables non-LLM fast path for survival actions. */
    setHeuristicEngine(engine: HeuristicEngine): void;
    /** Start the proactive behavior loop. */
    startProactiveLoop(intervalMs?: number): void;
    /** Stop the proactive behavior loop. */
    stopProactiveLoop(): void;
    /**
     * Execute a full think cycle: context → LLM → validate → execute.
     * This is the PRIMARY entry point for triggering the agent.
     *
     * @param botState - Current Minecraft bot state snapshot
     * @param chatMessage - Optional new chat message from a player
     * @param recentEvents - Recent game events from EventBus
     * @param chatHistory - Recent chat history
     */
    think(params: {
        botState: BotState | null;
        chatMessage?: {
            source: string;
            message: string;
        };
        recentEvents?: GameEvent[];
        chatHistory?: ChatEntry[];
        nearbyEntities?: string[];
    }): Promise<ThinkResult>;
    cancelActiveRequest(): void;
    getState(): AgentState;
    isBusy(): boolean;
    /**
     * Periodic proactive evaluation — generates autonomous intents
     * based on personality, emotion, and current game state.
     */
    private proactiveTick;
    /**
     * Quick response: just generate speech, no actions.
     * Lower-latency path for chat-only interactions.
     */
    quickChat(botState: BotState, chatHistory: ChatEntry[], userMessage: string): Promise<string | null>;
    /**
     * Emergency assessment: low-latency call to assess danger level.
     * Used by SafetyGuard to determine if emergency stop is needed.
     */
    assessDanger(botState: BotState, recentDamage: GameEvent[]): Promise<"safe" | "caution" | "danger">;
    private saveMemoryCandidate;
    /** Classify entity strings into categories for heuristic engine. */
    private classifyNearby;
}
export { FALLBACK_IDLE_OUTPUT };
//# sourceMappingURL=agent-core.d.ts.map
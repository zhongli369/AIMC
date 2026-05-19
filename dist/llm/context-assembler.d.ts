/**
 * ContextAssembler — builds optimized input context for LLM inference.
 * Token budget enforced. Redundant info compressed. Safety prioritized.
 */
import type { BotState } from "../interfaces/minecraft.js";
import type { GameEvent } from "../interfaces/event.js";
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
export interface ChatEntry {
    source: string;
    message: string;
    timestamp?: number;
}
export declare class ContextAssembler {
    private config;
    private systemPrompt;
    constructor(config?: Partial<AssemblerConfig>);
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
    }): AssembledContext;
    private buildGameStateBlock;
    private buildEventsBlock;
    private buildChatHistory;
    private buildFinalInstruction;
    estimateTokens(text: string): number;
}
export {};
//# sourceMappingURL=context-assembler.d.ts.map
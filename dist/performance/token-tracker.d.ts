/**
 * TokenTracker — precise token usage and cost analytics.
 *
 * Tracks per-request and cumulative token consumption for DeepSeek V4 Pro.
 * Estimates cost based on model pricing tiers.
 *
 * Model pricing (per 1M tokens, as of 2025):
 *   deepseek-chat:     $0.14 input / $0.28 output
 *   deepseek-reasoner: $0.55 input / $2.19 output
 */
import type { TokenUsage } from "./profiler.js";
export interface TokenTrackerConfig {
    /** Model name for pricing lookup */
    model: string;
    /** Hard budget per request (prompt tokens) */
    maxPromptTokens: number;
    /** Hard budget per request (completion tokens) */
    maxCompletionTokens: number;
    /** Soft budget — warn when cumulative daily tokens exceed this */
    dailyBudgetTokens: number;
    /** Whether to track at all */
    enabled: boolean;
}
export declare class TokenTracker {
    private config;
    private requests;
    private cumulativePrompt;
    private cumulativeCompletion;
    private dailyTokens;
    private dailyResetTime;
    private budgetWarnings;
    constructor(config?: Partial<TokenTrackerConfig>);
    /** Estimate tokens from text (rough: ~4 chars per token for English). */
    estimateTokens(text: string): number;
    /** Estimate tokens from a messages array. */
    estimateMessagesTokens(messages: Array<{
        content: string;
    }>): number;
    calculateCost(promptTokens: number, completionTokens: number): number;
    /** Record a completed LLM request. Returns the TokenUsage record. */
    recordRequest(promptTokens: number, completionTokens: number): TokenUsage;
    /** Check if a prompt exceeds the per-request budget. */
    isWithinPromptBudget(estimatedTokens: number): boolean;
    /** Check if daily budget is exhausted. */
    isDailyBudgetExhausted(): boolean;
    /** Get remaining daily budget. */
    remainingDailyBudget(): number;
    stats(): {
        cumulativePrompt: number;
        cumulativeCompletion: number;
        dailyTokens: number;
        dailyBudget: number;
        budgetPercent: number;
        totalCostUsd: number;
        requestCount: number;
        avgPromptTokens: number;
        avgCompletionTokens: number;
    };
    reset(): void;
    private checkDailyReset;
    private nextMidnightMs;
}
//# sourceMappingURL=token-tracker.d.ts.map
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

// ─── Pricing ───────────────────────────────────────────

interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

const PRICING: Record<string, ModelPricing> = {
  "deepseek-chat": { inputPer1M: 0.14, outputPer1M: 0.28 },
  "deepseek-reasoner": { inputPer1M: 0.55, outputPer1M: 2.19 },
};

// ─── Config ────────────────────────────────────────────

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

const DEFAULT_CONFIG: TokenTrackerConfig = {
  model: "deepseek-chat",
  maxPromptTokens: 3000,
  maxCompletionTokens: 1000,
  dailyBudgetTokens: 1_000_000,
  enabled: true,
};

// ─── TokenTracker ──────────────────────────────────────

export class TokenTracker {
  private config: TokenTrackerConfig;
  private requests: TokenUsage[] = [];
  private cumulativePrompt = 0;
  private cumulativeCompletion = 0;
  private dailyTokens = 0;
  private dailyResetTime: number;
  private budgetWarnings = 0;

  constructor(config?: Partial<TokenTrackerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.dailyResetTime = this.nextMidnightMs();
  }

  // ─── Estimation ──────────────────────────────────────

  /** Estimate tokens from text (rough: ~4 chars per token for English). */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.5);
  }

  /** Estimate tokens from a messages array. */
  estimateMessagesTokens(messages: Array<{ content: string }>): number {
    let total = 0;
    for (const msg of messages) {
      total += this.estimateTokens(msg.content);
    }
    return total;
  }

  // ─── Cost Calculation ────────────────────────────────

  calculateCost(promptTokens: number, completionTokens: number): number {
    const pricing = PRICING[this.config.model] || PRICING["deepseek-chat"];
    const inputCost = (promptTokens / 1_000_000) * pricing.inputPer1M;
    const outputCost = (completionTokens / 1_000_000) * pricing.outputPer1M;
    return inputCost + outputCost;
  }

  // ─── Recording ───────────────────────────────────────

  /** Record a completed LLM request. Returns the TokenUsage record. */
  recordRequest(promptTokens: number, completionTokens: number): TokenUsage {
    if (!this.config.enabled) {
      return { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 };
    }

    this.checkDailyReset();

    const totalTokens = promptTokens + completionTokens;
    const cost = this.calculateCost(promptTokens, completionTokens);

    this.cumulativePrompt += promptTokens;
    this.cumulativeCompletion += completionTokens;
    this.dailyTokens += totalTokens;

    const usage: TokenUsage = {
      promptTokens,
      completionTokens,
      totalTokens,
      estimatedCostUsd: Math.round(cost * 10000) / 10000,
    };

    this.requests.push(usage);
    if (this.requests.length > 500) this.requests.shift();

    // Budget check
    if (this.dailyTokens > this.config.dailyBudgetTokens * 0.8 && this.budgetWarnings === 0) {
      console.warn(`[TokenTracker] Daily token budget at 80%: ${this.dailyTokens}/${this.config.dailyBudgetTokens}`);
      this.budgetWarnings++;
    }
    if (this.dailyTokens > this.config.dailyBudgetTokens && this.budgetWarnings === 1) {
      console.warn(`[TokenTracker] Daily token budget EXCEEDED: ${this.dailyTokens}/${this.config.dailyBudgetTokens}`);
      this.budgetWarnings++;
    }

    return usage;
  }

  // ─── Budget Checks ───────────────────────────────────

  /** Check if a prompt exceeds the per-request budget. */
  isWithinPromptBudget(estimatedTokens: number): boolean {
    return estimatedTokens <= this.config.maxPromptTokens;
  }

  /** Check if daily budget is exhausted. */
  isDailyBudgetExhausted(): boolean {
    this.checkDailyReset();
    return this.dailyTokens >= this.config.dailyBudgetTokens;
  }

  /** Get remaining daily budget. */
  remainingDailyBudget(): number {
    this.checkDailyReset();
    return Math.max(0, this.config.dailyBudgetTokens - this.dailyTokens);
  }

  // ─── Stats ───────────────────────────────────────────

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
  } {
    this.checkDailyReset();

    const totalCost = this.calculateCost(this.cumulativePrompt, this.cumulativeCompletion);
    const count = this.requests.length || 1;

    return {
      cumulativePrompt: this.cumulativePrompt,
      cumulativeCompletion: this.cumulativeCompletion,
      dailyTokens: this.dailyTokens,
      dailyBudget: this.config.dailyBudgetTokens,
      budgetPercent: Math.round((this.dailyTokens / this.config.dailyBudgetTokens) * 10000) / 100,
      totalCostUsd: Math.round(totalCost * 10000) / 10000,
      requestCount: this.requests.length,
      avgPromptTokens: Math.round(this.cumulativePrompt / count),
      avgCompletionTokens: Math.round(this.cumulativeCompletion / count),
    };
  }

  reset(): void {
    this.requests = [];
    this.cumulativePrompt = 0;
    this.cumulativeCompletion = 0;
    this.dailyTokens = 0;
    this.budgetWarnings = 0;
  }

  // ─── Internal ────────────────────────────────────────

  private checkDailyReset(): void {
    const now = Date.now();
    if (now > this.dailyResetTime) {
      this.dailyTokens = 0;
      this.budgetWarnings = 0;
      this.dailyResetTime = this.nextMidnightMs();
    }
  }

  private nextMidnightMs(): number {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    return midnight.getTime();
  }
}

/**
 * Skill Execution Result — unified observability types for Phase 3-A.
 *
 * These types standardize how skill execution is observed and reported.
 * They do NOT introduce new execution pipelines or modify the architecture.
 */
import type { ExecutionResult } from "../../interfaces/intent.js";

// ─── Plan Step Lifecycle ─────────────────────────────

export type PlanStepState =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "retrying"
  | "skipped";

// ─── Skill Execution Result ──────────────────────────

export interface SkillExecutionResult {
  /** Whether the skill completed all actions successfully */
  success: boolean;
  /** Name of the executed skill */
  skillName: string;
  /** Number of actions that were dispatched */
  actionsExecuted: number;
  /** Total retry attempts across all actions */
  retryCount: number;
  /** Total duration in milliseconds */
  durationMs: number;
  /** Error message if the skill failed */
  error?: string;
  /** Whether fallback was triggered */
  fallbackUsed: boolean;
  /** Name of fallback skill if one was used */
  fallbackSkillName?: string;
  /** Per-action results */
  actionResults: ExecutionResult[];
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;
}

// ─── Plan Step Status ────────────────────────────────

export interface PlanStepStatus {
  step: number;
  action: string;
  skill?: string;
  state: PlanStepState;
  retryCount: number;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  error?: string;
  fallbackUsed: boolean;
  fallbackSkillName?: string;
}

// ─── Execution Telemetry (AIMC_SKILL_TRACE) ───────────

export interface SkillTrace {
  /** trace identifier */
  traceId: string;
  /** UTC timestamp when execution started */
  timestamp: number;
  /** Name of the skill */
  skillName: string;
  /** Top-level intent type */
  intent: "chat" | "skill" | "plan";
  /** Total execution duration in ms */
  durationMs: number;
  /** Number of retry attempts */
  retryCount: number;
  /** Final outcome */
  finalStatus: "success" | "failed" | "partial" | "fallback";
  /** Whether fallback was triggered */
  fallbackTriggered: boolean;
  /** Fallback skill name if triggered */
  fallbackSkillName?: string;
  /** Number of actions dispatched */
  actionsDispatched: number;
  /** Error message if failed */
  error?: string;
  /** Plan step statuses (for plan intent) */
  planSteps?: PlanStepStatus[];
}

// ─── Retry Config ────────────────────────────────────

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 2,
  baseDelayMs: 100,
  maxDelayMs: 600,
};

// ─── Fallback Mapping ────────────────────────────────

export type FallbackMap = Record<string, string>;

/**
 * AgentCore — bridges DeepSeek V4 Pro → RuntimeCore → SkillRouter (Phase 2.5).
 *
 * Orchestrates the full "perceive → reason → validate → execute" cycle:
 *   ContextAssembler → DeepSeekV4Pro → RuntimeCore.validate() → SkillRouter.route() → ActionDispatcher
 *
 * Single Execution Chain:
 *   AgentCore → SkillRouter (sole entry) → ActionDispatcher (sole executor) → Mineflayer
 *
 * Features: dedup, debounce, cancellation, backpressure.
 */
import type { BotState } from "../interfaces/minecraft.js";
import type { AgentOutput, ExecutionResult } from "../interfaces/intent.js";
import type { ValidationResult } from "../runtime/runtime-core.js";
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
import { SkillRouter } from "../skill/index.js";
import { VoiceIntentAnalyzer } from "../voice/voice-intent-analyzer.js";
import { type VoicePressureSignal } from "../voice/voice-pressure.js";
import { TacticalAnalyzer } from "../team/tactical-analyzer.js";
import { SupportBehaviors } from "../team/support-behaviors.js";
import { type TeamState } from "../team/team-state.js";
import { RoleAdaptationEngine } from "../role/role-adaptation.js";
import { RelationshipEngine } from "../memory/relationship-state.js";
import { SharedExperienceTimeline } from "../memory/shared-experience.js";
import { MemoryCallbackGenerator } from "../memory/memory-callbacks.js";
import { BehaviorArbitrator } from "../behavior/arbitration/behavior-arbitrator.js";
import { IntentPredictor } from "../team/intent-prediction.js";
import { ProactiveSupportEngine } from "../team/proactive-support.js";
import { StabilityMonitor, type StabilityState, type ProgressType } from "../behavior/stability/stuck-detector.js";
import { RuntimeTraceRecorder } from "../observability/runtime-trace.js";
import { BehaviorTimeline } from "../observability/behavior-timeline.js";
import { SystemHealthTracker } from "../observability/system-health.js";
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
    /** Results from SkillRouter execution */
    executionResults: ExecutionResult[];
    /** Validation result summary */
    validation: ValidationResult | null;
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
    private proactiveRunning;
    private proactiveIntervalMs;
    private lastUserInteraction;
    private skillRouter;
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
    /** Wire role adaptation engine — enables role-specialized behavior (Phase 4-D). */
    setRoleBackend(adaptation: RoleAdaptationEngine): void;
    getRoleAdaptation(): RoleAdaptationEngine | null;
    /** Wire relationship + shared experience backends (Phase 4-E). */
    setRelationshipBackend(params: {
        relationship: RelationshipEngine;
        experiences: SharedExperienceTimeline;
        language?: "zh" | "en";
    }): void;
    getRelationshipEngine(): RelationshipEngine | null;
    getSharedExperiences(): SharedExperienceTimeline | null;
    getCallbackGenerator(): MemoryCallbackGenerator;
    /** Wire behavior arbitration backend (Phase 4-G). */
    setArbitrationBackend(params?: {
        arbitrator?: BehaviorArbitrator;
        intentPredictor?: IntentPredictor;
        proactiveSupport?: ProactiveSupportEngine;
    }): void;
    getArbitrator(): BehaviorArbitrator;
    getIntentPredictor(): IntentPredictor;
    getProactiveSupport(): ProactiveSupportEngine;
    /** Wire Phase 6 observability backends (trace recorder + timeline). */
    setObservabilityBackend(params: {
        traceRecorder: RuntimeTraceRecorder;
        timeline: BehaviorTimeline;
    }): void;
    getTraceRecorder(): RuntimeTraceRecorder | null;
    getBehaviorTimeline(): BehaviorTimeline | null;
    getHealthTracker(): SystemHealthTracker;
    /**
     * Wire skill system — REQUIRED for execution.
     * Without SkillRouter, validated intents will NOT be dispatched.
     */
    setSkillRouter(router: SkillRouter): void;
    getSkillRouter(): SkillRouter | null;
    /** Start the proactive behavior loop. */
    startProactiveLoop(intervalMs?: number): void;
    /** Stop the proactive behavior loop. */
    stopProactiveLoop(): void;
    /** Start the stability watchdog loop. */
    startWatchdog(intervalMs?: number): void;
    /** Stop the stability watchdog loop. */
    stopWatchdog(): void;
    /**
     * Periodic stability evaluation tick.
     *
     * Checks for stuck state, loop detection, and safe mode transitions.
     * Recovery flows through the normal think() pipeline — NO new execution path.
     */
    private stabilityTick;
    /** Record a progress event after successful execution. */
    recordProgress(type: ProgressType, detail?: string): void;
    /** Get current stability state (read-only diagnostic). */
    getStabilityState(): StabilityState;
    /** Get stability monitor for external telemetry. */
    getStabilityMonitor(): StabilityMonitor;
    /**
     * Collect all subsystem signals into a single ArbitrationInput.
     * Called AFTER RuntimeCore.validate() and BEFORE SkillRouter.route().
     */
    private collectArbitrationSignals;
    /**
     * Derive memory urgency from shared experiences.
     *
     * Scans recent experiences for danger-related memories
     * (combat deaths, near-death, lava/void incidents).
     */
    private buildMemoryUrgency;
    /**
     * Apply behavior arbitration to a validated AgentOutput.
     *
     * Collects all subsystem signals, runs the arbitrator, emits the trace,
     * and returns a new AgentOutput with the arbitrated action list.
     *
     * If the arbitrator has no opinion (no rules triggered, no conflicts),
     * the original output is returned unchanged.
     */
    private applyArbitration;
    private buildSkillContext;
    /**
     * Route validated AgentOutput through SkillRouter for execution.
     * This is the ONLY path from AI decision to Minecraft action.
     */
    private executeViaSkillRouter;
    /**
     * Execute a full think cycle:
     *   context → LLM → RuntimeCore.validate() → SkillRouter.route() → ActionDispatcher
     *
     * This is the PRIMARY entry point for triggering the agent.
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
    /** Record a user interaction timestamp — gates proactive ticks (Phase 5B). */
    recordUserInteraction(): void;
    /**
     * Periodic proactive evaluation — generates autonomous intents
     * based on personality, emotion, and current game state.
     * ALL proactive actions route through RuntimeCore.validate() → SkillRouter.route().
     *
     * Phase 5B skip rules (user interaction always wins):
     *   1. Agent busy thinking/executing → skip
     *   2. Previous proactive tick still running → skip
     *   3. User interaction within last 15s → skip
     */
    private proactiveTick;
    /**
     * Quick response: just generate speech, no actions.
     * Lower-latency path for chat-only interactions.
     */
    quickChat(botState: BotState, chatHistory: ChatEntry[], userMessage: string): Promise<string | null>;
    /**
     * Emergency assessment: low-latency call to assess danger level.
     */
    assessDanger(botState: BotState, recentDamage: GameEvent[]): Promise<"safe" | "caution" | "danger">;
    private saveMemoryCandidate;
    private voiceInputHandler;
    private voiceOutputEmitter;
    private _voiceState;
    private voiceIntentAnalyzer;
    private lastVoicePressure;
    private tacticalAnalyzer;
    private supportBehaviors;
    private lastTeamState;
    private roleAdaptation;
    private relationshipEngine;
    private sharedExperiences;
    private callbackGenerator;
    private behaviorArbitrator;
    private intentPredictor;
    private proactiveSupport;
    private stabilityMonitor;
    private watchdogTimer;
    private traceRecorder;
    private timeline;
    private healthTracker;
    /**
     * Handle voice input from STT adapter.
     * Routes through the EXISTING chat pipeline:
     *   voice text → think({ chatMessage }) → RuntimeCore.validate → SkillRouter → ActionDispatcher
     *
     * This does NOT create a new execution path. It reuses the chat pipeline
     * with source "player_voice".
     */
    handleVoiceInput(text: string): Promise<ThinkResult | null>;
    /**
     * Emit voice output text to TTS adapter.
     * This is OUTPUT ONLY — it does not affect execution.
     */
    emitVoiceOutput(text: string): void;
    /** Wire voice input handler (called by VoiceEventBridge / STT adapter). */
    onVoiceInput(handler: (text: string) => Promise<void>): void;
    /** Wire voice output callback (called by TTS adapter). */
    onVoiceOutput(emitter: (text: string) => void): void;
    /** Get voice state (read-only — does NOT affect bot state). */
    getVoiceState(): Readonly<{
        speaking: boolean;
        listening: boolean;
        interrupted: boolean;
        processing: boolean;
    }>;
    /**
     * Get voice context bundle (Phase 4-B).
     *
     * Provides a read-only snapshot of voice pressure + state for
     * context injection without exposing internal objects.
     */
    getVoiceContext(): {
        pressure: VoicePressureSignal;
        state: Readonly<{
            speaking: boolean;
            listening: boolean;
            interrupted: boolean;
            processing: boolean;
        }>;
    };
    /** Get raw voice intent analyzer (for external telemetry). */
    getVoiceAnalyzer(): VoiceIntentAnalyzer;
    /** Get last computed team state (read-only). */
    getTeamState(): TeamState | null;
    /** Get tactical analyzer (for external telemetry). */
    getTacticalAnalyzer(): TacticalAnalyzer;
    /** Get support behaviors instance. */
    getSupportBehaviors(): SupportBehaviors;
    /**
     * Generate passive support actions from team state.
     * Caller MUST dispatch results through SkillRouter.route().
     */
    generateSupportActions(botHealth: number): {
        actions: import("../interfaces/intent.js").IntentAction[];
        behaviorTriggered: string | null;
    };
    /**
     * Build TeamState from read-only sources: __WORLD_STATE__, __botState__.
     */
    private buildTeamState;
    /**
     * Format team tactical context as a short LLM system message.
     */
    private formatTeamContext;
    /** Interrupt voice output (SAFE MODE — does NOT touch ActionDispatcher). */
    interruptVoice(reason: string): void;
    /** Classify entity strings into categories for heuristic engine. */
    private classifyNearby;
}
export { FALLBACK_IDLE_OUTPUT };
//# sourceMappingURL=agent-core.d.ts.map
/**
 * AIMC — AI Minecraft Companion
 * Entry point. Maintains backward compatibility with Mindcraft while
 * bootstrapping the new runtime architecture.
 */
import { RuntimeCore } from "./runtime/index.js";
import { AgentCore } from "./agent/index.js";
import type { DeepSeekConfig } from "./llm/index.js";
import { VoiceOrchestrator } from "./voice/index.js";
import type { VoiceOrchestratorConfig, WhisperConfig } from "./voice/index.js";
import { SQLiteMemoryStore, MemoryRetriever } from "./memory/index.js";
import { PersonalityEngine, EmotionEngine, SocialEngine, PERSONALITY_PRESETS, type PersonalityProfile } from "./personality/index.js";
import { ProactiveEngine, TaskPlanner } from "./behavior/index.js";
import { Coordinator } from "./coordination/index.js";
import { PerformanceProfiler, TokenTracker } from "./performance/index.js";
import { HeuristicEngine } from "./heuristics/index.js";
import { Watchdog, RecoveryManager } from "./recovery/index.js";
export declare const runtimeCore: RuntimeCore;
export declare function initAgent(deepseekConfig: DeepSeekConfig): AgentCore;
export declare function getAgent(): AgentCore | null;
/** Initialize Phase 4 voice pipeline. Requires whisper.cpp binary + model paths. */
export declare function initVoice(voiceConfig?: Partial<VoiceOrchestratorConfig>, whisperConfig?: WhisperConfig): VoiceOrchestrator;
export declare function getVoice(): VoiceOrchestrator | null;
/** Initialize Phase 5 memory system. Requires DB path. */
export declare function initMemory(dbPath?: string): Promise<{
    store: SQLiteMemoryStore;
    retriever: MemoryRetriever;
}>;
export declare function getMemory(): {
    store: SQLiteMemoryStore | null;
    retriever: MemoryRetriever | null;
};
/** Initialize Phase 6 personality + proactive + coordination systems. */
export declare function initPersonality(params?: {
    profile?: PersonalityProfile;
    preset?: keyof typeof PERSONALITY_PRESETS;
    proactiveIntervalMs?: number;
}): {
    personality: PersonalityEngine;
    emotion: EmotionEngine;
    social: SocialEngine;
    proactive: ProactiveEngine;
    tasks: TaskPlanner;
    coordinator: Coordinator;
};
export declare function getPersonality(): {
    personality: PersonalityEngine | null;
    emotion: EmotionEngine | null;
    social: SocialEngine | null;
    proactive: ProactiveEngine | null;
    tasks: TaskPlanner | null;
    coordinator: Coordinator | null;
};
/** Initialize all productionization systems: performance, heuristics, recovery. */
export declare function initProduction(params?: {
    profilerEnabled?: boolean;
    heuristicEnabled?: boolean;
    recoveryAutoRecover?: boolean;
    tokenBudgetDaily?: number;
}): {
    profiler: PerformanceProfiler;
    tokenTracker: TokenTracker;
    heuristicEngine: HeuristicEngine;
    watchdog: Watchdog;
    recoveryManager: RecoveryManager;
};
export declare function getProduction(): {
    profiler: PerformanceProfiler | null;
    tokenTracker: TokenTracker | null;
    heuristicEngine: HeuristicEngine | null;
    watchdog: Watchdog | null;
    recoveryManager: RecoveryManager | null;
};
//# sourceMappingURL=index.d.ts.map
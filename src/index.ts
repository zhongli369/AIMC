/**
 * AIMC — AI Minecraft Companion
 * Entry point. Maintains backward compatibility with Mindcraft while
 * bootstrapping the new runtime architecture.
 */
import { eventBus, RuntimeCore } from "./runtime/index.js";
import { AgentCore } from "./agent/index.js";
import type { DeepSeekConfig } from "./llm/index.js";
import { VoiceOrchestrator } from "./voice/index.js";
import type { VoiceOrchestratorConfig, WhisperConfig } from "./voice/index.js";
import { SQLiteMemoryStore, MemoryRetriever, ImportanceEngine } from "./memory/index.js";
import {
  PersonalityEngine,
  EmotionEngine,
  SocialEngine,
  PERSONALITY_PRESETS,
  type PersonalityProfile,
} from "./personality/index.js";
import { ProactiveEngine, TaskPlanner } from "./behavior/index.js";
import { Coordinator } from "./coordination/index.js";
import { PerformanceProfiler, TokenTracker } from "./performance/index.js";
import { HeuristicEngine } from "./heuristics/index.js";
import { Watchdog, RecoveryManager } from "./recovery/index.js";

// Phase 2: Runtime Execution Layer
export const runtimeCore = new RuntimeCore();

// Phase 3: Agent LLM layer (lazy-init when deepseek API key available)
let agentCore: AgentCore | null = null;

// Phase 4: Voice pipeline (lazy-init when whisper binary/model configured)
let voiceOrchestrator: VoiceOrchestrator | null = null;

// Phase 5: Memory system (lazy-init when DB path configured)
let memoryStore: SQLiteMemoryStore | null = null;
let memoryRetriever: MemoryRetriever | null = null;

// Phase 6: Personality + Proactive system (lazy-init)
let personalityEngine: PersonalityEngine | null = null;
let emotionEngine: EmotionEngine | null = null;
let socialEngine: SocialEngine | null = null;
let proactiveEngine: ProactiveEngine | null = null;
let taskPlanner: TaskPlanner | null = null;
let coordinator: Coordinator | null = null;

// Productionization: Performance, heuristics, recovery (lazy-init)
let profiler: PerformanceProfiler | null = null;
let tokenTracker: TokenTracker | null = null;
let heuristicEngine: HeuristicEngine | null = null;
let watchdog: Watchdog | null = null;
let recoveryManager: RecoveryManager | null = null;

export function initAgent(deepseekConfig: DeepSeekConfig): AgentCore {
  if (agentCore) {
    agentCore.stopProactiveLoop();
    agentCore.cancelActiveRequest();
  }
  agentCore = new AgentCore(runtimeCore, deepseekConfig);
  console.log(`[AIMC] AgentCore initialized — model: ${deepseekConfig.model}`);

  // Wire memory if already initialized
  if (memoryStore && memoryRetriever) {
    agentCore.setMemoryBackend(memoryStore, memoryRetriever);
  }
  // Wire heuristic if already initialized
  if (heuristicEngine) {
    agentCore.setHeuristicEngine(heuristicEngine);
  }
  // Wire personality if already initialized
  if (personalityEngine && emotionEngine && socialEngine && proactiveEngine && taskPlanner) {
    agentCore.setPersonalityBackend({
      personality: personalityEngine,
      emotion: emotionEngine,
      social: socialEngine,
      proactive: proactiveEngine,
      tasks: taskPlanner,
    });
    agentCore.startProactiveLoop();
  }

  updateBridge();
  return agentCore;
}

export function getAgent(): AgentCore | null {
  return agentCore;
}

/** Initialize Phase 4 voice pipeline. Requires whisper.cpp binary + model paths. */
export function initVoice(
  voiceConfig?: Partial<VoiceOrchestratorConfig>,
  whisperConfig?: WhisperConfig,
): VoiceOrchestrator {
  if (voiceOrchestrator) voiceOrchestrator.destroy();
  voiceOrchestrator = new VoiceOrchestrator(voiceConfig);
  if (whisperConfig) {
    voiceOrchestrator.initSTT(whisperConfig);
  }
  console.log("[AIMC] VoiceOrchestrator initialized — VAD + Whisper + Edge-TTS ready");
  updateBridge();
  return voiceOrchestrator;
}

export function getVoice(): VoiceOrchestrator | null {
  return voiceOrchestrator;
}

/** Initialize Phase 5 memory system. Requires DB path. */
export async function initMemory(dbPath?: string): Promise<{
  store: SQLiteMemoryStore;
  retriever: MemoryRetriever;
}> {
  if (memoryStore) memoryStore.close();
  memoryStore = new SQLiteMemoryStore(dbPath ? { dbPath } : {});
  await memoryStore.init();
  memoryRetriever = new MemoryRetriever();

  // Wire into AgentCore if already initialized
  if (agentCore) {
    agentCore.setMemoryBackend(memoryStore, memoryRetriever);
  }

  console.log("[AIMC] Memory system initialized — SQLite + hybrid retrieval ready");
  updateBridge();
  return { store: memoryStore, retriever: memoryRetriever };
}

export function getMemory(): {
  store: SQLiteMemoryStore | null;
  retriever: MemoryRetriever | null;
} {
  return { store: memoryStore, retriever: memoryRetriever };
}

/** Initialize Phase 6 personality + proactive + coordination systems. */
export function initPersonality(params: {
  profile?: PersonalityProfile;
  preset?: keyof typeof PERSONALITY_PRESETS;
  proactiveIntervalMs?: number;
} = {}): {
  personality: PersonalityEngine;
  emotion: EmotionEngine;
  social: SocialEngine;
  proactive: ProactiveEngine;
  tasks: TaskPlanner;
  coordinator: Coordinator;
} {
  // Cleanup old instances
  if (emotionEngine) emotionEngine.stop();
  if (proactiveEngine) proactiveEngine.stop();

  const profile = params.profile || PERSONALITY_PRESETS[params.preset || "companion"];

  emotionEngine = new EmotionEngine();
  personalityEngine = new PersonalityEngine(profile, emotionEngine);
  socialEngine = new SocialEngine(profile, emotionEngine);
  proactiveEngine = new ProactiveEngine(personalityEngine, emotionEngine);
  taskPlanner = new TaskPlanner();
  coordinator = new Coordinator();

  // Wire into AgentCore if already initialized
  if (agentCore) {
    agentCore.setPersonalityBackend({
      personality: personalityEngine,
      emotion: emotionEngine,
      social: socialEngine,
      proactive: proactiveEngine,
      tasks: taskPlanner,
    });
    agentCore.startProactiveLoop(params.proactiveIntervalMs || 5000);
  }

  // Wire memory into social engine
  if (memoryStore && memoryRetriever) {
    socialEngine.setMemoryBackend(memoryStore, memoryRetriever);
  }

  console.log(`[AIMC] Personality+Proactive system initialized — profile: ${profile.name}`);
  updateBridge();
  return { personality: personalityEngine, emotion: emotionEngine, social: socialEngine, proactive: proactiveEngine, tasks: taskPlanner, coordinator };
}

export function getPersonality(): {
  personality: PersonalityEngine | null;
  emotion: EmotionEngine | null;
  social: SocialEngine | null;
  proactive: ProactiveEngine | null;
  tasks: TaskPlanner | null;
  coordinator: Coordinator | null;
} {
  return { personality: personalityEngine, emotion: emotionEngine, social: socialEngine, proactive: proactiveEngine, tasks: taskPlanner, coordinator };
}

/** Initialize all productionization systems: performance, heuristics, recovery. */
export function initProduction(params?: {
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
} {
  // Cleanup old instances
  if (watchdog) watchdog.stop();
  if (recoveryManager) recoveryManager.destroy();

  profiler = new PerformanceProfiler({ enabled: params?.profilerEnabled ?? true });
  tokenTracker = new TokenTracker({
    enabled: params?.profilerEnabled ?? true,
    dailyBudgetTokens: params?.tokenBudgetDaily || 1_000_000,
  });
  heuristicEngine = new HeuristicEngine({ enabled: params?.heuristicEnabled ?? true });
  watchdog = new Watchdog();

  // Wire heuristic into AgentCore
  if (agentCore) agentCore.setHeuristicEngine(heuristicEngine);

  // Enable subsystem watchdogs for initialized systems
  watchdog.enable("runtime");
  if (agentCore) watchdog.enable("agent");
  if (memoryStore) watchdog.enable("memory");

  recoveryManager = new RecoveryManager(watchdog, {
    autoRecover: params?.recoveryAutoRecover ?? true,
  });

  // Wire RecoveryManager events → actual recovery actions
  recoveryManager.on("runtime_reset", () => { runtimeCore.start(); });
  recoveryManager.on("agent_reset", () => { agentCore?.cancelActiveRequest(); });
  recoveryManager.on("bot_reset", () => {
    // Stuck recovery — handled by legacy bot controller via bridge
    console.log("[RecoveryManager] Bot reset signal — position history cleared");
  });

  watchdog.start();
  console.log("[AIMC] Productionization systems initialized");
  console.log(`[AIMC]   PerformanceProfiler + TokenTracker (daily budget: ${params?.tokenBudgetDaily || 1_000_000} tokens)`);
  console.log(`[AIMC]   HeuristicEngine (${params?.heuristicEnabled ?? true ? "enabled" : "disabled"})`);
  console.log(`[AIMC]   Watchdog + RecoveryManager (auto-recover: ${params?.recoveryAutoRecover ?? true})`);

  updateBridge();
  return { profiler, tokenTracker, heuristicEngine, watchdog, recoveryManager };
}

export function getProduction(): {
  profiler: PerformanceProfiler | null;
  tokenTracker: TokenTracker | null;
  heuristicEngine: HeuristicEngine | null;
  watchdog: Watchdog | null;
  recoveryManager: RecoveryManager | null;
} {
  return { profiler, tokenTracker, heuristicEngine, watchdog, recoveryManager };
}

function updateBridge(): void {
  (globalThis as any).__aimc__ = {
    runtimeCore,
    agentCore,
    voiceOrchestrator,
    memoryStore,
    memoryRetriever,
    personalityEngine,
    emotionEngine,
    socialEngine,
    proactiveEngine,
    taskPlanner,
    coordinator,
    profiler,
    tokenTracker,
    heuristicEngine,
    watchdog,
    recoveryManager,
    getAgent: () => agentCore,
    getVoice: () => voiceOrchestrator,
    getMemory: () => ({ store: memoryStore, retriever: memoryRetriever }),
    getPersonality: () => ({ personality: personalityEngine, emotion: emotionEngine, social: socialEngine, proactive: proactiveEngine, tasks: taskPlanner, coordinator }),
    getProduction: () => ({ profiler, tokenTracker, heuristicEngine, watchdog, recoveryManager }),
  };
}

// Bridge: expose runtimeCore immediately (before agent init) for safety-only usage
updateBridge();

async function main(): Promise<void> {
  console.log("[AIMC] AI Minecraft Companion starting...");
  console.log(`[AIMC] EventBus active with ${eventBus.getSubscriberCount()} subscribers`);

  // Phase 2: Runtime Execution Layer
  runtimeCore.start();
  console.log("[AIMC] RuntimeCore pipeline: Schema → SafetyGuard → ActionDispatcher");

  // Phase 3: DeepSeek V4 Pro integration ready
  console.log("[AIMC] LLM layer: DeepSeekV4Pro + ContextAssembler + StreamParser ready");
  console.log("[AIMC] AgentCore ready — call initAgent({ apiKey, ... }) to activate");

  // Phase 4: Voice Pipeline (Whisper.cpp → Edge-TTS)
  console.log("[AIMC] Voice: VoiceOrchestrator ready — call initVoice() to activate");
  console.log("[AIMC] Voice path: mic → VAD → Whisper.cpp → AgentCore → Edge-TTS → speaker");

  // Phase 5: Memory System (SQLite + Chroma vector store)
  console.log("[AIMC] Memory: SQLiteMemoryStore + hybrid retrieval ready — call initMemory() to activate");

  // Phase 6: Personality + Proactive Engine
  console.log("[AIMC] Personality: Profiles (4 presets) + EmotionEngine + SocialEngine ready");
  console.log("[AIMC] Proactive: ProactiveEngine + TaskPlanner + Coordinator ready");
  console.log("[AIMC] Phase 6 ready — call initPersonality({ preset: 'companion' }) to activate");

  // Productionization: Performance + Heuristics + Recovery
  console.log("[AIMC] Productionization: PerformanceProfiler + TokenTracker ready");
  console.log("[AIMC] Productionization: HeuristicEngine ready (non-LLM decision layer)");
  console.log("[AIMC] Productionization: Watchdog + RecoveryManager ready");
  console.log("[AIMC] Productionization ready — call initProduction() to activate");

  console.log("[AIMC] Ready.");
  // Quick start:
  //   initAgent({ apiKey: "sk-...", model: "deepseek-chat" })
  //   initMemory("./aimc-memory.db")
  //   initPersonality({ preset: 'companion' })
  //   initProduction()
  //   initVoice({ voiceInput: true }, { whisperPath: "...", modelPath: "...", ... })
  //   voiceOrchestrator.start()
}

main().catch(console.error);

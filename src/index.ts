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
import { SkillRouter, SkillRegistry } from "./skill/index.js";
import {
  RoleAdaptationEngine,
  loadIdentity,
  saveIdentity,
  createAutoSave,
  getRoleProfile,
  type CompanionIdentity,
} from "./role/index.js";
import {
  RelationshipEngine,
  SharedExperienceTimeline,
  MemoryCallbackGenerator,
  createRelationshipState,
  saveRelationshipState,
  loadRelationshipState,
  saveSharedExperiences,
  loadSharedExperiences,
  createMemoryAutoSave as createRelAutoSave,
  type RelationshipState,
} from "./memory/index.js";
import { initUIStateBridge, UIStateBridge } from "./ui/state-bridge.js";

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

// Phase 2: Skill system (lazy-init)
let skillRouter: SkillRouter | null = null;
let skillRegistry: SkillRegistry | null = null;

// P1: UI State Bridge
let uiBridge: UIStateBridge | null = null;

// Phase 4-D: Role system (lazy-init)
let roleAdaptation: RoleAdaptationEngine | null = null;
let roleAutoSaveCleanup: (() => void) | null = null;

// Phase 4-E: Relationship & Shared Experience (lazy-init)
let relationshipEngine: RelationshipEngine | null = null;
let sharedExperiences: SharedExperienceTimeline | null = null;
let callbackGenerator: MemoryCallbackGenerator | null = null;
let memoryAutoSaveCleanup: (() => void) | null = null;

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
  // Wire skill system if already initialized
  if (skillRouter) {
    agentCore.setSkillRouter(skillRouter);
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
    const proactiveMs = params.proactiveIntervalMs ?? 5000;
    if (proactiveMs > 0) {
      agentCore.startProactiveLoop(proactiveMs);
    } else {
      console.log("[AIMC] Proactive loop NOT started — proactiveIntervalMs=0");
    }
  }

  // Wire memory into social engine
  if (memoryStore && memoryRetriever) {
    socialEngine.setMemoryBackend(memoryStore, memoryRetriever);
  }

  console.log(`[AIMC] Personality+Proactive system initialized — profile: ${profile.name}`);
  updateBridge();
  return { personality: personalityEngine, emotion: emotionEngine, social: socialEngine, proactive: proactiveEngine, tasks: taskPlanner, coordinator };
}

/** Initialize Phase 2 skill system. */
export function initSkill(): { router: SkillRouter; registry: SkillRegistry } {
  skillRegistry = new SkillRegistry();
  skillRouter = new SkillRouter(skillRegistry);

  // Wire into AgentCore if already initialized
  if (agentCore) {
    agentCore.setSkillRouter(skillRouter);
  }

  console.log(`[AIMC] Skill system initialized — ${skillRegistry.list().length} skills registered`);
  updateBridge();
  return { router: skillRouter, registry: skillRegistry };
}

export function getSkill(): { router: SkillRouter | null; registry: SkillRegistry | null } {
  return { router: skillRouter, registry: skillRegistry };
}

/** Initialize Phase 4-D role specialization system. */
export function initRole(params?: {
  dataDir?: string;
  initialRole?: import("./role/index.js").CompanionRole;
  autoSaveIntervalMs?: number;
}): RoleAdaptationEngine {
  // Load persisted identity or create default
  const dataDir = params?.dataDir || "./aimc_data";
  const identity = loadIdentity(
    { dataDir },
    params?.initialRole || "balanced",
  );

  roleAdaptation = new RoleAdaptationEngine(identity);

  // Start auto-save
  if (roleAutoSaveCleanup) roleAutoSaveCleanup();
  roleAutoSaveCleanup = createAutoSave(
    () => roleAdaptation!.getIdentity(),
    { dataDir },
    params?.autoSaveIntervalMs ?? 60_000,
  );

  // Wire into AgentCore if already initialized
  if (agentCore) {
    agentCore.setRoleBackend(roleAdaptation);
  }

  const profile = getRoleProfile(identity.currentRole);
  console.log(`[AIMC] Role system initialized — ${profile.label} (${profile.description})`);
  updateBridge();
  return roleAdaptation;
}

export function getRole(): RoleAdaptationEngine | null {
  return roleAdaptation;
}

/** Initialize Phase 4-E relationship + shared experience system. */
export function initRelationship(params?: {
  dataDir?: string;
  autoSaveIntervalMs?: number;
  language?: "zh" | "en";
}): {
  relationship: RelationshipEngine;
  experiences: SharedExperienceTimeline;
  callbacks: MemoryCallbackGenerator;
} {
  const dataDir = params?.dataDir || "./aimc_data";

  // Load persisted state
  const relLoaded = loadRelationshipState({ dataDir });
  const expLoaded = loadSharedExperiences({ dataDir });

  relationshipEngine = new RelationshipEngine(relLoaded.state);
  sharedExperiences = new SharedExperienceTimeline(expLoaded.experiences);
  callbackGenerator = new MemoryCallbackGenerator(params?.language || "zh");

  // Register session start
  relationshipEngine.registerSessionStart();

  // Start auto-save
  if (memoryAutoSaveCleanup) memoryAutoSaveCleanup();
  memoryAutoSaveCleanup = createRelAutoSave({
    getRelationshipState: () => relationshipEngine!.getState() as RelationshipState,
    getExperiences: () => sharedExperiences!.getAll() as any[],
    config: { dataDir },
    intervalMs: params?.autoSaveIntervalMs ?? 60_000,
  }).stop;
  // Re-create with save capability
  const handle = createRelAutoSave({
    getRelationshipState: () => relationshipEngine!.getState() as RelationshipState,
    getExperiences: () => sharedExperiences!.getAll() as any[],
    config: { dataDir },
    intervalMs: params?.autoSaveIntervalMs ?? 60_000,
  });
  memoryAutoSaveCleanup = handle.stop;

  // Wire into AgentCore if already initialized
  if (agentCore) {
    agentCore.setRelationshipBackend({
      relationship: relationshipEngine,
      experiences: sharedExperiences,
      language: params?.language,
    });
  }

  const snap = relationshipEngine.getSnapshot();
  console.log(`[AIMC] Relationship system initialized — ${snap.style}, ${snap.summary}`);
  console.log(`[AIMC] Shared experiences: ${sharedExperiences.getStats().totalMemories} memories loaded`);
  updateBridge();
  return { relationship: relationshipEngine, experiences: sharedExperiences, callbacks: callbackGenerator };
}

export function getRelationship(): {
  relationship: RelationshipEngine | null;
  experiences: SharedExperienceTimeline | null;
  callbacks: MemoryCallbackGenerator | null;
} {
  return {
    relationship: relationshipEngine,
    experiences: sharedExperiences,
    callbacks: callbackGenerator,
  };
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

/** Initialize P1 UI state bridge — telemetry → Electron IPC. */
export function initUI(params?: {
  intervalMs?: number;
}): UIStateBridge {
  if (uiBridge) uiBridge.stop();
  uiBridge = initUIStateBridge(params?.intervalMs ?? 1000);
  console.log("[AIMC] UI State Bridge initialized — emitting AIMC_UI_STATE every " + (params?.intervalMs ?? 1000) + "ms");
  updateBridge();
  return uiBridge;
}

export function getUIBridge(): UIStateBridge | null {
  return uiBridge;
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
    skillRouter,
    skillRegistry,
    profiler,
    tokenTracker,
    heuristicEngine,
    watchdog,
    recoveryManager,
    getAgent: () => agentCore,
    getVoice: () => voiceOrchestrator,
    getMemory: () => ({ store: memoryStore, retriever: memoryRetriever }),
    getPersonality: () => ({ personality: personalityEngine, emotion: emotionEngine, social: socialEngine, proactive: proactiveEngine, tasks: taskPlanner, coordinator }),
    getSkill: () => ({ router: skillRouter, registry: skillRegistry }),
    getRole: () => roleAdaptation,
    roleAdaptation,
    relationshipEngine,
    sharedExperiences,
    callbackGenerator,
    getRelationship: () => ({ relationship: relationshipEngine, experiences: sharedExperiences, callbacks: callbackGenerator }),
    getProduction: () => ({ profiler, tokenTracker, heuristicEngine, watchdog, recoveryManager }),
    getBotState: () =>
      (globalThis as any).__botState__ ??
      (globalThis as any).__RUNTIME_CONTEXT__?.getSnapshot?.()?.bot ??
      null,
    getNearbyEntities: () =>
      (globalThis as any).__RUNTIME_CONTEXT__?.getNearbyEntities?.() ?? [],
    uiBridge,
    getUIBridge: () => uiBridge,
  };
}

// Bridge: expose runtimeCore immediately (before agent init) for safety-only usage
updateBridge();

async function main(): Promise<void> {
  console.log("[AIMC] AI Minecraft Companion starting...");
  console.log(`[AIMC] EventBus active with ${eventBus.getSubscriberCount()} subscribers`);

  // Phase 2: Runtime Execution Layer + Skill System
  runtimeCore.start();
  console.log("[AIMC] RuntimeCore pipeline: Schema → SafetyGuard → ActionDispatcher");
  console.log("[AIMC] Skill system: SkillRegistry + SkillRouter ready — call initSkill() to activate");

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

  // Phase 4-D: Role Specialization & Companion Identity
  console.log("[AIMC] Role: 5 companion roles (miner/fighter/scout/support/balanced) ready");
  console.log("[AIMC] Role: RoleAdaptationEngine + JSON persistence ready — call initRole() to activate");

  // Phase 4-E: Memory, Relationship & Shared Experience
  console.log("[AIMC] Relationship: familiarity/trust/teamwork tracking ready");
  console.log("[AIMC] Memory: SharedExperienceTimeline (8 categories) + MemoryCallbackGenerator ready");
  console.log("[AIMC] Memory: JSON persistence with atomic writes + auto-save ready");
  console.log("[AIMC] Phase 4-E ready — call initRelationship() to activate");
  console.log("[AIMC] Role: RoleAdaptationEngine + JSON persistence ready — call initRole() to activate");

  // Productionization: Performance + Heuristics + Recovery
  console.log("[AIMC] Productionization: PerformanceProfiler + TokenTracker ready");
  console.log("[AIMC] Productionization: HeuristicEngine ready (non-LLM decision layer)");
  console.log("[AIMC] Productionization: Watchdog + RecoveryManager ready");
  console.log("[AIMC] Productionization ready — call initProduction() to activate");

  // P1: UI Product Layer
  console.log("[AIMC] UI: UIStateBridge ready — call initUI() to activate");
  console.log("[AIMC] UI: AIMC_UI_STATE → stdout → Electron IPC → Dashboard (960x620, 3-panel)");
  console.log("[AIMC] Voice: Voice Profile Loader ready — call loadVoiceProfiles() to load per-role TTS settings");

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

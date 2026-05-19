import { ContextAssembler } from "../llm/context-assembler.js";
import { DeepSeekV4Pro, FALLBACK_IDLE_OUTPUT } from "../llm/deepseek-v4-pro.js";
import { eventBus } from "../runtime/event-bus.js";
import { logger } from "../runtime/logger.js";
import { ImportanceEngine } from "../memory/importance.js";
const DEFAULT_AGENT_CONFIG = {
    debounceMs: 500,
    maxConcurrent: 1,
    verboseEvents: false,
};
// ─── AgentCore ───────────────────────────────────────
export class AgentCore {
    config;
    deepseek;
    assembler;
    runtimeCore;
    state = "idle";
    lastThinkTime = 0;
    activeRequest = null;
    pendingThink = null;
    _debounceTimer = null;
    heuristicEngine = null;
    // Phase 5: Memory system
    memoryStore = null;
    memoryRetriever = null;
    importanceEngine = new ImportanceEngine();
    // Phase 6: Personality + Proactive system
    personalityEngine = null;
    emotionEngine = null;
    socialEngine = null;
    proactiveEngine = null;
    taskPlanner = null;
    proactiveTimer = null;
    constructor(runtimeCore, deepseekConfig, config) {
        this.config = { ...DEFAULT_AGENT_CONFIG, ...config };
        this.runtimeCore = runtimeCore;
        this.deepseek = new DeepSeekV4Pro(deepseekConfig);
        this.assembler = new ContextAssembler();
    }
    /** Wire Phase 5 memory backend into the agent. */
    setMemoryBackend(store, retriever) {
        this.memoryStore = store;
        this.memoryRetriever = retriever;
        console.log("[AgentCore] Memory backend wired — retrieval + storage active");
    }
    /** Wire Phase 6 personality + proactive systems. */
    setPersonalityBackend(params) {
        this.personalityEngine = params.personality;
        this.emotionEngine = params.emotion;
        this.socialEngine = params.social;
        this.proactiveEngine = params.proactive;
        this.taskPlanner = params.tasks;
        console.log("[AgentCore] Personality+Proactive backend wired — autonomous teammate active");
    }
    /** Wire heuristic engine — enables non-LLM fast path for survival actions. */
    setHeuristicEngine(engine) {
        this.heuristicEngine = engine;
    }
    /** Start the proactive behavior loop. */
    startProactiveLoop(intervalMs = 5000) {
        if (this.proactiveTimer)
            return;
        this.proactiveTimer = setInterval(() => this.proactiveTick(), intervalMs);
        console.log(`[AgentCore] Proactive loop started — ${intervalMs}ms interval`);
    }
    /** Stop the proactive behavior loop. */
    stopProactiveLoop() {
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
    async think(params) {
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
                if (this._debounceTimer)
                    clearTimeout(this._debounceTimer);
                await new Promise((r) => {
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
            let memorySnapshots;
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
                }
                catch (err) {
                    // Memory retrieval failure is non-fatal — continue without memories
                    console.warn("[AgentCore] Memory retrieval failed:", err.message);
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
                const decisionCtx = {
                    healthPercent: params.botState ? (params.botState.health / 20) * 100 : 100,
                    nearbyHostiles: params.nearbyEntities?.filter((e) => /zombie|skeleton|creeper|spider|witch/i.test(e)).length || 0,
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
                    type: "__think_cycle__",
                    target: {},
                    priority: 1,
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
                    const pipelineResult = await this.runtimeCore.processAgentOutput(heuristicResult.output);
                    timing.executionMs = performance.now() - totalStart - timing.contextMs;
                    timing.totalMs = Date.now() - totalStart;
                    this.state = "idle";
                    return {
                        completed: true,
                        agentOutput: heuristicResult.output,
                        executionResults: pipelineResult.results,
                        pipelineResult,
                        timing,
                        fallback: false,
                    };
                }
            }
            // ═══ REASON: Call LLM ═══
            const llmStart = Date.now();
            const llmResult = await this.deepseek.generate(assembled.messages, { signal: this.activeRequest.signal });
            timing.llmMs = Date.now() - llmStart;
            if (!llmResult.success || !llmResult.output) {
                // LLM failed — fallback
                timing.totalMs = Date.now() - totalStart;
                this.state = "idle";
                logger.actionFailed({ id: "llm-fail", type: "__think_cycle__", target: {}, priority: 1, reason: "LLM failure" }, { actionId: "llm-fail", success: false, message: llmResult.error || "LLM failed", interrupted: false, timedOut: llmResult.timedOut }, timing.llmMs);
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
            const agentOutput = llmResult.output;
            if (this.memoryStore && agentOutput.memory_save) {
                this.saveMemoryCandidate(agentOutput.memory_save, params.botState).catch((err) => {
                    console.warn("[AgentCore] Memory save failed:", err.message);
                });
            }
            timing.executionMs = 0; // Included in pipeline
            timing.totalMs = Date.now() - totalStart;
            this.state = "idle";
            return {
                completed: true,
                agentOutput: llmResult.output,
                executionResults: pipelineResult.results,
                pipelineResult,
                timing,
                fallback: false,
            };
        }
        catch (err) {
            timing.totalMs = Date.now() - totalStart;
            this.state = "error";
            const errorMsg = err instanceof Error ? err.message : String(err);
            logger.actionFailed({ id: "think-error", type: "__think_cycle__", target: {}, priority: 1, reason: errorMsg }, { actionId: "think-error", success: false, message: errorMsg, interrupted: false, timedOut: false }, timing.totalMs);
            return {
                completed: false,
                executionResults: [],
                pipelineResult: null,
                timing,
                fallback: true,
            };
        }
        finally {
            this.activeRequest = null;
        }
    }
    // ─── Lifecycle ─────────────────────────────────────
    cancelActiveRequest() {
        if (this.activeRequest) {
            this.activeRequest.abort();
            this.activeRequest = null;
        }
        this.deepseek.cancel();
    }
    getState() {
        return this.state;
    }
    isBusy() {
        return this.state === "thinking" || this.state === "executing";
    }
    // ─── Phase 6: Proactive Loop ──────────────────────
    /**
     * Periodic proactive evaluation — generates autonomous intents
     * based on personality, emotion, and current game state.
     */
    async proactiveTick() {
        if (!this.proactiveEngine || !this.personalityEngine)
            return;
        if (this.isBusy())
            return; // Don't interrupt active thinking
        try {
            const bridge = globalThis.__aimc__;
            const botState = bridge?.getBotState?.() || null;
            const intents = await this.proactiveEngine.evaluate({
                botState,
                recentEvents: eventBus.getRecentEvents(30000, 10),
                nearbyEntities: bridge?.getNearbyEntities?.() || [],
            });
            if (intents.length === 0)
                return;
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
                }
                else {
                    // Heuristic: execute directly through RuntimeCore
                    const result = await this.runtimeCore.processAgentOutput({
                        speech: intent.actionType === "speak_chat" ? { text: intent.target?.text || intent.reason, tone: "friendly" } : undefined,
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
        }
        catch (err) {
            console.warn("[AgentCore] Proactive tick failed:", err.message);
        }
    }
    // ─── Convenience Methods ───────────────────────────
    /**
     * Quick response: just generate speech, no actions.
     * Lower-latency path for chat-only interactions.
     */
    async quickChat(botState, chatHistory, userMessage) {
        const messages = [
            { role: "system", content: "Respond to the player with ONLY a JSON object with a 'speech' field and empty actions array. Be brief. Use AgentOutput schema." },
            { role: "user", content: `Player says: "${userMessage}"\nRespond briefly.` },
        ];
        const result = await this.deepseek.generate(messages);
        return result.output?.speech?.text || null;
    }
    /**
     * Emergency assessment: low-latency call to assess danger level.
     * Used by SafetyGuard to determine if emergency stop is needed.
     */
    async assessDanger(botState, recentDamage) {
        if (botState.health < 6)
            return "danger";
        if (botState.health < 12)
            return "caution";
        const recentHits = recentDamage.filter((e) => e.type === "damage_taken" && Date.now() - e.timestamp < 5000);
        if (recentHits.length > 3)
            return "danger";
        if (recentHits.length > 1)
            return "caution";
        return "safe";
    }
    // ─── Phase 5: Memory Save ──────────────────────────
    async saveMemoryCandidate(raw, botState) {
        if (!this.memoryStore)
            return;
        const mc = raw;
        const type = mc.type || "event";
        const candidate = {
            type: type,
            summary: mc.summary || "",
            details: mc.details || mc.summary || "",
            importance: this.importanceEngine.score({
                type: type,
                summary: mc.summary || "",
                details: mc.details || "",
                importance: mc.importance || 5,
                emotionalValence: mc.emotionalValence ?? 0,
                tags: mc.tags || [],
                relatedEntities: [],
                location: botState?.position
                    ? { x: botState.position.x, y: botState.position.y, z: botState.position.z }
                    : undefined,
            }),
            emotionalValence: mc.emotionalValence ?? 0,
            tags: mc.tags || [],
            relatedEntities: [],
            location: botState?.position
                ? { x: botState.position.x, y: botState.position.y, z: botState.position.z, dimension: botState.dimension }
                : undefined,
            source: "llm",
        };
        const saved = await this.memoryStore.save(candidate);
        console.log(`[AgentCore] Memory saved: [${saved.type}] ${saved.summary.slice(0, 80)} (importance: ${saved.importance})`);
    }
    /** Classify entity strings into categories for heuristic engine. */
    classifyNearby(entities) {
        const hostileKeywords = ["zombie", "skeleton", "creeper", "spider", "witch", "hoglin", "piglin_brute", "enderman", "warden", "blaze", "ghast"];
        const projectileKeywords = ["arrow", "fireball", "trident", "snowball"];
        const itemKeywords = ["item", "drop", "experience_orb", "xp"];
        const hostiles = [];
        const projectiles = [];
        const items = [];
        const players = [];
        const other = [];
        for (const e of entities) {
            const lower = e.toLowerCase();
            if (hostileKeywords.some((h) => lower.includes(h))) {
                hostiles.push(e);
            }
            else if (projectileKeywords.some((p) => lower.includes(p))) {
                projectiles.push(e);
            }
            else if (itemKeywords.some((i) => lower.includes(i))) {
                items.push(e);
            }
            else if (lower.includes("player") || /\(\d+m\)/.test(e)) {
                players.push(e);
            }
            else {
                other.push(e);
            }
        }
        return { entities: entities, hostiles, items, players, projectiles: projectiles };
    }
}
// Re-export for convenience
export { FALLBACK_IDLE_OUTPUT };
//# sourceMappingURL=agent-core.js.map
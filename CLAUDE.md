# CLAUDE.md — AI Minecraft Companion (AIMC)

Production-grade AI teammate system for Minecraft. LLM-driven agent with structured intent pipeline, skill system, safety guard, voice pipeline, team coordination, role specialization, relationship memory, cooperative autonomy, behavior arbitration, stability recovery, full observability, runtime configuration, Electron dashboard UI, voice profile system, and one-click production release packaging. Default language: Chinese (中文).

---

## RUNTIME TRUTH MODEL

This section IS the canonical runtime architecture. Every statement here matches actual code behavior. If code and this document conflict, **this document must be updated first, or the code must be rejected.**

### Canonical Execution Chain (ONLY valid path)

```
User Input / Proactive Tick / Voice Input / Team Context
        │
        ▼
┌─────────────────────────────────────────────┐
│  AgentCore (src/agent/agent-core.ts)        │
│  Sole AI brain. think() / quickChat() /     │
│  proactiveTick() / handleVoiceInput().       │
│  Assembles context from all soft layers:    │
│  [BEHAVIOR] [TEAM] [ROLE] [RELATIONSHIP]    │
│  Generates AgentOutput.                     │
│  NEW (4-G): BehaviorArbitrator resolves     │
│  conflicting soft-layer signals BEFORE      │
│  SkillRouter.                               │
└──────────────────┬──────────────────────────┘
                   │ AgentOutput (JSON)
                   ▼
┌─────────────────────────────────────────────┐
│  RuntimeCore.validate()                     │
│  (src/runtime/runtime-core.ts)              │
│  Zod schema validation + SafetyGuard.       │
│  VALIDATION ONLY — zero execution.          │
└──────────────────┬──────────────────────────┘
                   │ Validated AgentOutput
                   ▼
┌─────────────────────────────────────────────┐
│  SkillRouter.route()                        │
│  (src/skill/skill-router.ts)                │
│  SOLE behavior entry point.                 │
│  Handles chat / skill / plan intents.       │
│  Sets caller token before dispatch.         │
│  Retry + fallback + telemetry.              │
│  Soft influence: voice pressure timing,     │
│  tactical bias, role bias.                  │
└──────────────────┬──────────────────────────┘
                   │ IntentAction[]
                   ▼
┌─────────────────────────────────────────────┐
│  ActionDispatcher.dispatch()                │
│  (src/runtime/action-dispatcher.ts)         │
│  SOLE bot control layer.                    │
│  verifyCaller() at entry — token-gated.     │
│  Queue, retry, safety check, timeout.       │
└──────────────────┬──────────────────────────┘
                   │ bot.*() calls
                   ▼
┌─────────────────────────────────────────────┐
│  Mineflayer Bot                             │
│  (pathfinder, pvp, collectBlock, etc.)      │
└─────────────────────────────────────────────┘
```

**This is the ONLY valid execution topology. NO other path exists at runtime.**

### What Is Allowed to Execute at Runtime

| Module | Role | Execution? |
|--------|------|------------|
| `AgentCore` | AI reasoning, AgentOutput generation, context assembly | Yes — sole brain |
| `RuntimeCore` | Zod + SafetyGuard validation | **Validate only** — no execution since Phase 2.5 |
| `SkillRouter` | Intent → skill/chat/plan → actions, telemetry hub | Yes — sole execution entry |
| `ActionDispatcher` | IntentAction → Mineflayer API | Yes — sole bot controller |
| `RuntimeContext` | Bot state synchronization | Yes — read/write `__botState__` |
| `HeuristicEngine` | Survival fast-path (non-LLM) | Yes — outputs enter AgentCore pipeline |
| `TaskPlanner` | Goal generation + task lifecycle | Yes — plans consumed by AgentCore → SkillRouter |
| All soft layers | context injection, weight/bias influence, timing modifiers | Yes — passive influence ONLY |
| `src/legacy/` (all files) | **PROHIBITED** | **Dead code — zero runtime instantiation** |

### Soft Influence Layers (Passive — no execution authority)

These modules enrich LLM context and influence skill weights/timing. They NEVER execute actions or bypass SkillRouter:

| Layer | Module | Phase | What It Does |
|-------|--------|-------|--------------|
| Personality | `src/personality/personality-engine.ts` | 6 | Trait-based action weights, speech tone, behavior hints |
| Emotion | `src/personality/emotion-engine.ts` | 6 | Emotional state modulation |
| Social | `src/personality/social-engine.ts` | 6 | Social interaction modeling |
| Proactive | `src/behavior/proactive-engine.ts` | 6 | Autonomous action generation via think() |
| Heuristic | `src/heuristics/heuristic-engine.ts` | 6 | Non-LLM survival fast-path |
| Voice | `src/voice/voice-orchestrator.ts` | 4-A | STT/TTS pipeline integration |
| Voice Pressure | `src/voice/voice-pressure.ts` | 4-B | Timing modifiers from voice urgency |
| Tactical | `src/team/tactical-analyzer.ts` | 4-C | Team-aware skill weight bias |
| Support | `src/team/support-behaviors.ts` | 4-C | Passive regrouping, pickup, spacing |
| Role | `src/role/role-adaptation.ts` | 4-D | Long-term role identity evolution |
| Relationship | `src/memory/relationship-state.ts` | 4-E | Familiarity, trust, teamwork tracking |
| Experience | `src/memory/shared-experience.ts` | 4-E | Meaningful moment memory timeline |
| Callbacks | `src/memory/memory-callbacks.ts` | 4-E | Natural shared-history references |
| Intent Predict | `src/team/intent-prediction.ts` | 4-F | Player intent anticipation |
| Proactive Support | `src/team/proactive-support.ts` | 4-F | Safe helper action generation |
| Formation | `src/team/formation-system.ts` | 4-F | Dynamic positioning advisory |
| Mining | `src/team/mining-coordination.ts` | 4-F | Cooperative mining rhythm |
| Combat | `src/team/combat-synergy.ts` | 4-F | Coordinated combat tactics |
| **Arbitration** | `src/behavior/arbitration/behavior-arbitrator.ts` | **4-G** | **Resolves conflicting signals → single action for SkillRouter** |
| **Stuck Detect** | `src/behavior/stability/stuck-detector.ts` | **5** | **Detects no-progress state, triggers recovery** |
| **Loop Detect** | `src/behavior/stability/stuck-detector.ts` | **5** | **Suppresses repeated identical actions** |
| **Skill Backoff** | SkillRouter (gating only) | **5** | **Temporary skill disable after consecutive failures** |
| **Safe Mode** | `src/behavior/stability/stuck-detector.ts` | **5** | **Temporary risk-reduction flag** |
| **Runtime Trace** | `src/observability/runtime-trace.ts` | **6** | **Per-cycle trace session with 8 stage events** |
| **Behavior Timeline** | `src/observability/behavior-timeline.ts` | **6** | **Chronological decision log (23 event types, max 5000)** |
| **System Health** | `src/observability/system-health.ts` | **6** | **Real-time metrics (stuck/loop/success/fallback rates)** |
| **Event Collector** | `src/observability/event-collector.ts` | **6** | **Central non-intrusive event sink, async, never-throws** |
| **Exporter** | `src/observability/exporter.ts` | **6** | **JSON snapshot, timeline dump, trace replay, health report** |
| **UI State Bridge** | `src/ui/state-bridge.ts` | **P1** | **Telemetry → UI-safe snapshots, AIMC_UI_STATE stdout → IPC → dashboard** |
| **Voice Profile** | `src/voice/profile/voice-profile-loader.ts` | **P1** | **Per-role TTS settings (pitch/rate/volume/pacing), JSON-driven** |

### What Is Explicitly Forbidden (even if code exists)

- Any module calling `bot.*` directly (except ActionDispatcher)
- Any module calling `ActionDispatcher.dispatch()` directly (except SkillRouter with token)
- Any new LLM invocation path
- Any new execution pipeline
- Any bypass of `SkillRouter.route()`
- Any direct execution from soft influence layers
- Any reactivation of legacy Mindcraft code
- Any modification of `RuntimeCore` to add execution logic
- Any parallel AI loop or agent

---

## ARCHITECTURE INVARIANTS (NON-NEGOTIABLE)

> **If any of these are violated, the system is considered architecturally broken.**

| # | Invariant | Enforcement |
|---|-----------|-------------|
| I-1 | There is exactly ONE AI brain: `AgentCore` | Build scan + runtime audit |
| I-2 | There is exactly ONE execution router: `SkillRouter` | Token gate |
| I-3 | There is exactly ONE bot controller: `ActionDispatcher` | `verifyCaller()` at dispatch entry |
| I-4 | `RuntimeCore` MUST NOT execute actions | Build scan rule: `runtime_execution` |
| I-5 | No module may call `bot.*` directly except `ActionDispatcher` | Build scan rule: `legacy_bot_control` |
| I-6 | All execution MUST pass the token gate | `__AIMC_ARCH_LOCK__.strictMode === true` |
| I-7 | All state originates from `RuntimeContext` | Single writer: `runtime-context.cjs` |
| I-8 | `__AIMC_ARCH_LOCK__` is immutable at runtime | Set once at bootstrap, never modified |
| I-9 | Legacy code is dead — zero instantiation | Only `settings.js` + `mcdata.js` active |
| I-10 | All new code is TypeScript strict mode | `tsc --noEmit` must pass |

---

## SELF-AUDIT CHECKLIST (for Claude Code)

**Before ANY code change, CC must answer these 5 questions:**

| # | Question | If YES → Action |
|---|----------|-----------------|
| 1 | Does this introduce a second execution path? | **REJECT** — single chain only |
| 2 | Does this bypass `SkillRouter.route()`? | **REJECT** — single entry point |
| 3 | Does this modify `ActionDispatcher` security/token logic? | **REJECT** — security layer is frozen |
| 4 | Does this introduce direct `bot.*` access outside `ActionDispatcher`? | **REJECT** — single bot controller |
| 5 | Does this modify the runtime chain order? | **REJECT** — topology is locked |

**If ALL answers are NO → proceed.** Any YES → the change is an architecture violation.

### Secondary Checks (non-blocking but must be documented)

| # | Question | If YES → |
|---|----------|----------|
| 6 | Does this add a new globalThis property? | Must be documented in GlobalThis Registry |
| 7 | Does this add a new skill? | Must be registered in SkillRegistry + documented here |
| 8 | Does this change the SkillRouter retry/fallback config? | Must be documented in Skill System section |
| 9 | Does this touch `src/legacy/`? | Verify it's only `settings.js` or `mcdata.js` |
| 10 | Does this change the AgentOutput schema? | RuntimeCore validation must be updated first |

---

## ALLOWED vs FORBIDDEN CAPABILITIES

### ALLOWED (can be added/modified without architecture review)

| Category | Examples | Constraint |
|----------|----------|------------|
| Skill execution | New skills, skill parameter tuning | Must register in SkillRegistry |
| Retry logic | Tuning retry counts, backoff timing | Stay within SkillRouter |
| Fallback logic | Adding/removing fallback mappings | Max 2-hop chain |
| Telemetry | New trace fields, log formatting | Side-effect only, no execution impact |
| Plan lifecycle | Step state transitions, timeout tuning | Within `SkillRouter.executePlan()` |
| Heuristic output | New fast-path rules | Output enters AgentCore pipeline, not direct dispatch |
| LLM prompting | System prompt tuning, behavior hints | Must maintain Chinese default |
| Personality profiles | Trait weights, new presets | Must go through PersonalityEngine |
| Voice pipeline | STT/TTS config, narration templates | Passive transport layer — no execution |
| Voice pressure | Timing modifiers, keyword detection | Soft influence on retry/timeout only |
| Tactical analysis | Team state evaluation, skill bias | Weight-only influence on SkillRouter |
| Support behaviors | Regroup, pickup, spacing actions | Flow through SkillRouter, not direct |
| Role profiles | New roles, skill weight tuning | Register in ROLE_PROFILES |
| Role adaptation | Observation tracking, confidence tuning | Slow passive evolution only |
| Relationship state | Trust/familiarity metrics, decay rates | Social continuity — no execution |
| Shared experiences | Memory categories, pruning rules | Context enrichment only |
| Memory callbacks | Template phrases, bilingual support | No LLM — template-driven only |
| Intent prediction | Context analysis, confidence scoring | Advisory only — never executes |
| Proactive support | Guard, collect, light, share actions | All through SkillRouter |
| Formation system | Spacing modes, positioning advice | Advisory — movement via existing skills |
| Mining coordination | Complementary task selection | Advisory — no autonomous mining |
| Combat synergy | Threat priority, role selection | Reactive + team-oriented only |
| Behavior arbitration | Signal weight tuning, emergency rule config | All actions still flow through SkillRouter |
| Stability watchdog | Stuck timeout, loop threshold, cooldown duration | Watchdog only — no intelligence change |
| Skill failure backoff | Failure thresholds, disable durations, fallback mapping | Gating only — no skill optimization |
| Safe mode | Entry/exit timing, constraint hints | Risk reduction only — no capability improvement |
| Trace recording | Trace stage labels, session limits, event fields | Non-blocking, never-throws, PURE OBSERVABILITY |
| Timeline events | New TimelineEventTypes, shortcut methods, query filters | Side-effect only — recording only |
| Health metrics | New health indicators, thresholds, trend analysis | Read-only computation — no feedback loop |
| Event collector | Ingest batching, buffer sizes, singleton config | Async fire-and-forget, zero execution impact |
| Exporter | Export formats (snapshot/compact/replay/dump), trend algorithms | Read-only data transformation |
| Health reports | Formatting, metric selection, diagnostic strings | Human-readable output only |
| Config parameters | Thresholds, multipliers, fallback mappings, behavior flags | Read-only at runtime — no AI capability change |
| Config file | JSON structure, new config sections, default values | Must not introduce new execution paths |
| UI state bridge | Polling interval, snapshot format, game state fields | Read-only, one-way data flow, no execution impact |
| Voice profiles | Per-role TTS settings (pitch/rate/volume/style), pacing, narration | Pure configuration, no behavior change |
| Dashboard UI | Panel layout, metric display, timeline rendering | Renderer only — NO Node access, NO bot API access |
| Dashboard IPC | Channel names, event forwarding, preload API surface | Transport only — no logic in IPC layer |

### FORBIDDEN (architecture violation — will be blocked)

| Category | Why Forbidden |
|----------|---------------|
| New AI loops | Single brain (I-1) |
| New execution pipelines | Single chain (I-2) |
| Direct bot control outside ActionDispatcher | Single bot controller (I-3) |
| Parallel agent systems | Single brain (I-1) |
| External process AI execution | Would bypass token gate (I-6) |
| `RuntimeCore` execution logic | Validate-only (I-4) |
| Legacy code reactivation | Dead code, zero runtime (I-9) |
| Bypass of `SkillRouter.route()` | Single entry (I-2) |
| Token gate circumvention | Core security (I-6) |
| Independent state evolution | Single source of truth (I-7) |
| Autonomous mining empires | Companion, not independent agent |
| Autonomous war AI | Reactive + team-oriented combat only |

---

## VERSIONED ARCHITECTURE LOCK

### Phase History

| Phase | Status | Description |
|-------|--------|-------------|
| 1 | Complete | Architecture unification — bridge creates bot, wires dispatcher |
| 2 | Complete | Skill System + Task Planner + Personality |
| 2.5 | Complete | Execution Convergence — RuntimeCore → validate-only, SkillRouter sole entry |
| 2.6 | Complete | Architecture Lock — token gate, arch guard scan, immutable rules |
| 2.7 | Complete | Convergence Audit — runtime-trace, all 5 risk areas CLEAN |
| 2.8 | Complete | System Freeze — ghost loop renamed, `__AIMC_ARCH_LOCK__` wired, legacy sealed |
| 3 | Complete | AgentCore + DeepSeek V4 Pro streaming + context assembler |
| 3-A | Complete | Skill Execution Reliability — retry, fallback, telemetry, plan lifecycle |
| 3-B | Complete | Documentation Authority — CLAUDE.md as enforcement-grade source of truth |
| 3-C | Complete | Drift Protection — build pipeline integration, arch-drift-scan (15 rules) |
| 4-A | Complete | Voice Companion Loop — STT/TTS, EventBus bridge, voice state, interrupt handling |
| 4-B | Complete | Voice-Driven Action Timing — pressure model, timing modifiers, SkillRouter soft timing |
| 4-C | Complete | Tactical Team Coordination — team state, tactical analyzer, support behaviors |
| 4-D | Complete | Role Specialization — 5 companion roles, adaptation engine, role persistence |
| 4-E | Complete | Memory & Relationship — familiarity/trust, shared experiences, natural callbacks |
| 4-F | Complete | Cooperative Autonomy — intent prediction, proactive support, formation, mining/combat synergy |
| 4-G | Complete | Behavior Arbitration — resolves conflicting soft-layer signals, 5 emergency rules, weight-based ranking |
| 5 | Complete | Stability & Recovery — stuck detection, loop detection, skill failure backoff, safe mode |
| 6 | Complete | Observability Layer (P0) — runtime trace, behavior timeline, system health, event collector, exporter |
| 0.5 | Complete | Configuration System — runtime-tunable parameters, config file, typed loader, 5 integration points |
| P1 | Complete | UI Product Layer — Electron Dashboard (3 panels), Voice Profile System, UI State Bridge, IPC wiring |
| P2 | Complete | Production Release Layer — electron-builder config, pre-release check, AIMC_MODE, asset bundling, one-click build |

### Structural Freeze (Phase 2.8 → Permanent)

The execution topology is **PERMANENTLY FROZEN** as of Phase 2.8:

```
AgentCore → RuntimeCore.validate → SkillRouter.route → ActionDispatcher → Mineflayer
```

**Future phases MUST NOT modify this topology.** All extensions are soft influence layers that inject context into AgentCore or apply weight/timing biases into SkillRouter. They NEVER create new execution paths.

### Current System State

- **ARCHITECTURE LOCKED** — v2.8-frozen, strictMode=true
- **SINGLE-CHAIN EXECUTION** — no bypass, no branches
- **TOKEN GATE ACTIVE** — SkillRouter → ActionDispatcher enforced
- **LEGACY IS DEAD CODE** — ~7500 lines excluded from runtime
- **PHASE P2 COMPLETE** — production release layer (electron-builder config, pre-release check, AIMC_MODE, one-click build)
- **PHASE P1 COMPLETE** — UI product layer (Electron dashboard, voice profiles, UI state bridge, IPC wiring)
- **PHASE 0.5 COMPLETE** — configuration system (runtime-tunable parameters, config file + typed loader)
- **PHASE 6 COMPLETE** — observability layer (runtime trace, behavior timeline, system health, event collector, exporter)
- **BUILD ENFORCEMENT** — arch-guard-scan (5 rules) + arch-drift-scan (15 rules, 4 groups)
- **170 source files** — 0 violations, 0 drift

---

## GOLDEN PATH EXECUTION TRACE

### Example: Player asks to mine iron

```
1. User input "去挖铁" arrives via stdin → handleChat() in legacy-bridge.cjs

2. AgentCore.think() called with:
   - botState (from __botState__)
   - chatMessage: { source: "player", message: "去挖铁" }
   - nearbyEntities (from __WORLD_STATE__)
   - Phase 6: RuntimeTraceRecorder.startSession() → trace session begins (non-blocking)

3. AgentCore assembles context:
   [SYSTEM PROMPT] → [MEMORY] → [BEHAVIOR HINTS] → [TEAM CONTEXT] → [ROLE CONTEXT] →
   [RELATIONSHIP CONTEXT] → [ACTIVE TASK] → DeepSeek V4 Pro → streaming response
   - Phase 6: trace event "context_assembled" recorded after assembly

4. LLM outputs AgentOutput:
   - Phase 6: trace events "llm_call_start" / "llm_call_end" recorded around LLM call
   {
     intent: "skill",
     skill: { name: "mine_resource", params: { blockType: "iron_ore", count: 8 } },
     speech: { text: "好的，我去挖铁矿石。", tone: "friendly" },
     actions: []
   }

5. RuntimeCore.validate(rawJson):
   - Stage 1: Zod schema validation → PASS
   - Stage 2: SafetyGuard checks each action → PASS
   - Returns ValidationResult { success: true, output: validated AgentOutput }
   - Phase 6: trace event "validation_pass" recorded

5.5. (Phase 4-G): BehaviorArbitrator.evaluate(signals):
   - Collects signals: tactical, role, relationship, voice, memory, cooperative
   - Normalizes all to weights [0.0, 2.0]
   - Checks 5 emergency rules in priority order
   - Returns final ranked IntentAction[] (with suppressed actions logged)
   - Emits AIMC_ARBITRATION_TRACE
   - Phase 6: trace event "arbitration_complete" recorded

6. SkillRouter.route(output, ctx):
   - Phase 6: trace event "route_skill" recorded, timeline "skill_start" recorded
   - Sets __AIMC_SKILLROUTER_TOKEN__ = "<uuid-token>"
   - intent="skill" → executeSkillWithRetry("mine_resource", {blockType:"iron_ore", count:8}, ctx)
     - registry.plan() → generates 8 collect_block actions for iron_ore
     - Voice pressure + tactical bias applied to timing
     - Action 1: dispatchWithRetry(collect_block iron_ore)
       - ActionDispatcher.dispatch() → verifyCaller() checks token → PASS
       - Phase 6: dispatch event ingested into EventCollector
       - bot.collectBlock.collect(iron_ore_block) → SUCCESS
     - Actions 2-8: continue...
     - All 8 actions complete
   - Returns SkillExecutionResult { success: true }
   - Phase 6: timeline "skill_complete" recorded, entries ingested into EventCollector

7. Emits AIMC_SKILL_TRACE to stdout

8. Clears __AIMC_SKILLROUTER_TOKEN__ (finally block)

9. Phase 6: trace session closed, ingested into EventCollector via getEventCollector().ingestTraceSession()

10. Bridge returns AIMC_MSG chat_response to Electron main process
```

### Context Assembly Order (think() method)

The LLM context is assembled in this exact order:

```
System Prompt
  → Memory Snapshots (Phase 5: SQLite retrieval)
  → Behavior Hints (Phase 6: PersonalityEngine)
  → Team Context (Phase 4-C: TacticalAnalyzer)
  → Role Context (Phase 4-D: RoleAdaptationEngine)
  → Relationship Context (Phase 4-E: RelationshipEngine + SharedExperiences)
  → Active Task (Phase 6: TaskPlanner)
  → Heuristic Fast-Path Check (skips LLM if survival action)
  → Phase 5 Safe Mode Context (constraint hints injected if safe mode active)
  → LLM Generation
  → Phase 4-G Arbitration (BehaviorArbitrator resolves conflicting signals)
  → SkillRouter.route() (with Phase 5 failure gating + loop suppression)
```

Each layer is OPTIONAL — if the subsystem is not initialized, the context line is simply skipped.

Phase 6 trace hooks record a non-blocking event at each step (context_assembled, llm_call_start, llm_call_end, validation_pass/fail, arbitration_complete, execution_complete). These are PURE OBSERVABILITY — they do not affect the context or execution.

---

## EXECUTION SECURITY MODEL

This is the HARD security boundary. 5 layers, enforced at build-time AND runtime:

| Layer | Guardian | Mechanism | Blocks |
|-------|----------|-----------|--------|
| Build-time guard | `scripts/arch-guard-scan.cjs` | Static analysis (5 rules) | Forbidden imports, removed APIs, direct `bot.*` calls |
| Build-time drift | `scripts/arch-drift-scan.cjs` | Static analysis (15 rules, 4 groups) | Architecture pattern drift, new execution paths |
| Bootstrap | `legacy-bridge.cjs` | Sets `__AIMC_ARCH_LOCK__` v2.8-frozen | Missing or tampered arch lock |
| Caller gate | `SkillRouter.route()` | Sets `__AIMC_SKILLROUTER_TOKEN__` before dispatch | Unauthorized dispatch callers |
| Dispatch gate | `ActionDispatcher.verifyCaller()` | Checks token + `strictMode` | Direct dispatcher calls |
| Bot API gate | `ActionDispatcher` sole ownership | ONLY module with `bot.*()` in active code | Bypassed bot control |

### Token Gate

```
SkillRouter.route()                         ActionDispatcher.dispatch()
      │                                              │
      ├─ __AIMC_SKILLROUTER_TOKEN__ = <token>       │
      ├─ dispatcher.dispatch(action) ──────────────→ ├─ verifyCaller()
      │                                              │   ├─ check __AIMC_ARCH_LOCK__.strictMode
      │                                              │   ├─ read token from globalThis
      │                                              │   ├─ match against authorizedCallers
      │                                              │   └─ throw + emit arch_violation if invalid
      └─ delete __AIMC_SKILLROUTER_TOKEN__          │
```

Violation emits `system:arch_violation` with: `callerStack`, `violatedModule`, `recommendedFix`.

---

## ANTI-DRIFT RULE (CRITICAL)

> **If code implementation and CLAUDE.md conflict:**
> 1. CLAUDE.md must be updated first, OR
> 2. The code change must be rejected.
>
> **CLAUSE: It is NEVER acceptable for CLAUDE.md to describe an architecture that does not match the actual runtime.**
>
> After ANY change to `src/`, `electron/`, or `scripts/`, the modifier must verify that CLAUDE.md still accurately describes:
> - The real execution flow
> - The real runtime control ownership
> - The real security model
> - The real active/dead system state

---

## SKILL SYSTEM (Phase 2 + Phase 3-A)

### 8 Core Skills

| Skill | Category | Fallback | Key Actions |
|-------|----------|----------|-------------|
| `follow_player` | movement | `explore_area` | move_to, look_at_player |
| `mine_resource` | gathering | `explore_area` | collect_block × N |
| `attack_target` | combat | `defend_player` | attack_entity, equip_item |
| `gather_food` | gathering | `collect_items` | collect_block, consume |
| `build_shelter` | building | — | collect_block, place_block, place_torch |
| `collect_items` | gathering | — | collect_nearby_items |
| `explore_area` | movement | — | move_to |
| `defend_player` | combat | — | follow_player, attack_entity |

### Phase 3-A Execution Model

```
executeSkillWithRetry(name, params, ctx)
  │
  ├─ executeSkillInternal(name)      ← Dispatch all planned actions with per-action retry
  │   └─ dispatchWithRetry(action)   ← Max 2 retries, 100→300→600ms backoff
  │                                    (scaled by voice pressure modifiers)
  │
  ├─ [if failed] registry.resolveFallback(name)  ← Max 2-hop fallback chain
  │   │                                            (tactical bias may adjust preference)
  │   └─ executeSkillInternal(fallback)
  │
  └─ emitSkillTrace(trace)           ← AIMC_SKILL_TRACE JSON to stdout
```

### Retry Configuration

| Parameter | Value |
|-----------|-------|
| Max retries per action | 2 (skill-level), 0 for non-retryable skills |
| Base delay | 100ms |
| Max delay | 600ms |
| Backoff formula | `min(baseDelay * 2^attempt, maxDelay)` |
| Non-retryable failures | Safety blocks, aborted, interrupted |

### Fallback Chain

| Primary | → Fallback | Rationale |
|---------|-----------|-----------|
| `mine_resource` | `explore_area` | No target resource → explore to find it |
| `attack_target` | `defend_player` | Target lost → switch to defensive posture |
| `gather_food` | `collect_items` | No food source → pick up anything nearby |
| `follow_player` | `explore_area` | Player lost → explore instead of standing still |

Max chain depth: 2 hops. A→B→C stops at C (no further fallback).
Tactical bias may override fallback choice (e.g., protect mode → prefer defend_player).

### Execution Telemetry

Every skill/plan execution emits an `AIMC_SKILL_TRACE` JSON line to stdout:

```json
{
  "traceId": "<uuid>",
  "timestamp": 1716150000000,
  "skillName": "mine_resource",
  "intent": "skill",
  "durationMs": 45000,
  "retryCount": 3,
  "finalStatus": "success|failed|partial|fallback",
  "fallbackTriggered": false,
  "fallbackSkillName": null,
  "actionsDispatched": 8
}
```

Telemetry is **side-effect only** — it does not affect execution flow or results.

### Telemetry Trace Types (All Phases)

| Trace | Phase | Purpose |
|-------|-------|---------|
| `AIMC_SKILL_TRACE` | 3-A | Skill/plan execution results |
| `AIMC_VOICE_PRESSURE_TRACE` | 4-B | Voice pressure level + timing modifiers |
| `AIMC_TACTICAL_TRACE` | 4-C | Tactical recommendation + skill bias |
| `AIMC_ROLE_TRACE` | 4-D | Role influence, switches, adaptation ticks |
| `AIMC_MEMORY_TRACE` | 4-E | Memory recalls, callbacks, pruning |
| `AIMC_RELATIONSHIP_TRACE` | 4-E | Trust/familiarity changes, milestones |
| `AIMC_COOP_TRACE` | 4-F | Intent predictions, assist actions |
| `AIMC_SUPPORT_TRACE` | 4-F | Proactive support generation |
| `AIMC_FORMATION_TRACE` | 4-F | Formation mode switches |
| `AIMC_COMBAT_TRACE` | 4-F | Combat role, target selection, rescue |
| `AIMC_ARBITRATION_TRACE` | 4-G | Signal weights, winning action, suppressed actions, applied rule |
| `AIMC_STABILITY_TRACE` | 5 | Stuck detection, loop detection, skill disable, safe mode transitions |
| `AIMC_OBSERVABILITY_SNAPSHOT` | 6 | Full system state snapshot (trace sessions, timeline, health) |
| `AIMC_OBSERVABILITY_HEALTH` | 6 | Health metrics snapshot (stuck/loop/success/fallback rates, latency) |
| `AIMC_OBSERVABILITY_TRACE_REPLAY` | 6 | Single session playback file (timestamp-ordered events) |

### Plan Step Lifecycle

```
pending → running → success
                  → failed
                  → retrying (increments retryCount, re-dispatches)
                  → skipped (fallback applied or precondition not met)
```

Per-step timeout: 8–15s based on priority (`max(8000, min(15000, (16-priority*2)*1000))`), scaled by voice pressure.
Failure isolation: a failed step does NOT cascade to subsequent steps.

### CRITICAL: Skills Do NOT Bypass Architecture

- Skills execute ONLY through `SkillRouter.route()`
- Skills NEVER call `ActionDispatcher.dispatch()` directly
- Skills NEVER access `bot.*` directly
- `SkillRegistry` is the ONLY skill registration point

---

## PHASE 4 CAPABILITY SUMMARIES

### Phase 4-A: Voice Companion Loop
- `src/voice/voice-orchestrator.ts` — VAD + Whisper.cpp STT + Edge-TTS pipeline
- `src/voice/voice-state.ts` — VoiceState (speaking/listening/interrupted/processing)
- `src/voice/voice-event-bus.ts` — VoiceEventBridge: voice → EventBus → AgentCore
- `src/voice/speech-to-text.ts` — handleTranscript() → AgentCore.handleVoiceInput()
- `src/voice/text-to-speech.ts` — Bilingual narration templates (zh/en)
- `src/personality/personality-engine.ts` — getVoiceTone(), getVoiceProsody()

### Phase 4-B: Voice-Driven Action Timing
- `src/voice/voice-pressure.ts` — 4 pressure levels (calm/normal/urgent/critical), computeTimingModifiers()
- `src/voice/voice-intent-analyzer.ts` — Bilingual keyword detection, repetition detection, classifyLevel()
- SkillRouter: dispatchWithRetry() applies pressure-adjusted delays, stepTimeout() applies timeout modifiers

### Phase 4-C: Tactical Team Coordination
- `src/team/team-state.ts` — TeamState, 5 team modes, buildTeamState()
- `src/team/tactical-analyzer.ts` — Deterministic analysis, 8 recommendation types, getSkillBias()
- `src/team/support-behaviors.ts` — Passive regroup, auto-pickup, avoid-blocking
- SkillRouter: tacticalBias → fallback chain adjustment, emitTacticalTrace()
- AgentCore: [TEAM CONTEXT] injection, TacticalAnalyzer + SupportBehaviors instances

### Phase 4-D: Role Specialization & Companion Identity
- `src/role/role-identity.ts` — 5 CompanionRole types, RoleProfile (skillWeights, voiceStyle, confidenceStyle), CompanionIdentity
- `src/role/role-adaptation.ts` — Long-term behavior observation, slow EMA confidence updates, role switch recommendation (min 5min interval)
- `src/role/role-memory.ts` — JSON persistence (atomic write, corruption fallback, auto-save)
- TacticalAnalyzer: getRoleAwareSkillBias(), getRoleTacticalModifiers()
- AgentCore: [ROLE CONTEXT] injection, role-aware tactical bias
- PersonalityEngine: getRoleVoiceProfile(), applyRoleToVoiceTone()

### Phase 4-E: Memory, Relationship & Shared Experience
- `src/memory/relationship-state.ts` — familiarityLevel, trustLevel, teamworkScore (0–100), interactionStyle (formal→familial), rescue/victory tracking
- `src/memory/shared-experience.ts` — 8 experience categories, emotional weighting, relevance query, auto-prune
- `src/memory/memory-callbacks.ts` — Template-driven bilingual callbacks, per-category templates, deterministic selection
- `src/memory/memory-persistence.ts` — Atomic JSON writes, schemaVersion migration, corruption detection, auto-save
- AgentCore: [RELATIONSHIP CONTEXT] injection, shared experience summaries
- PersonalityEngine: getInteractionWarmth(), getFamiliarityHints(), getTrustSpeechConfidence(), getLongTermToneDrift()

### Phase 4-F: Cooperative Autonomy & Dynamic Squad Behavior
- `src/team/intent-prediction.ts` — Predicts 9 player intent types from 8 signal categories, support opportunity mapping
- `src/team/proactive-support.ts` — 8 support behavior types (guard/combat/regroup/collect/light/share/scout/assist), cooldown-gated
- `src/team/formation-system.ts` — 6 formation modes, obstacle-aware, shouldRegroup(), shouldAvoidBlocking()
- `src/team/mining-coordination.ts` — Mining pattern analysis, complementary task selection, danger detection
- `src/team/combat-synergy.ts` — 5 combat roles, threat priority ordering, bow-LoS avoidance, rescue priority
- PersonalityEngine: getCooperativeInitiative(), getCooperativeHints() — trust-aware proactive behavior

### Phase 4-G: Real-Time Behavior Arbitration
- `src/behavior/arbitration/behavior-arbitrator.ts` — Collects signals from all 6 soft layers (tactical/role/relationship/voice/memory/cooperative), normalizes to weights [0.0, 2.0], applies 5 emergency rules, produces single ranked action list for SkillRouter
- Arbitration rules: (1) Emergency memory overrides all, (2) Voice overrides tactical in safe state only, (3) HP < 30% blocks combat actions, (4) Relationship protection overrides mining/building if player in danger, (5) Single primary action output
- Weight formula: `finalScore = T×1.0 + R×0.8 + Rel×0.7 + M×1.2 + V×1.5 + C×0.9`
- SkillRouter: `emitArbitrationTrace()` — AIMC_ARBITRATION_TRACE (signal weights, winning action, suppressed actions, applied rule, reason chain)
- AgentCore: `applyArbitration()` called after RuntimeCore.validate() and before SkillRouter.route() — collects signals, evaluates, emits trace, returns arbitrated AgentOutput

### Phase 5: Stability & Recovery
- `src/behavior/stability/stuck-detector.ts` — StuckDetector (8s no-progress → force recovery), ActionLoopDetector (3 repeats in 5s → cooldown), SafeModeManager (temporary risk reduction), SkillFailureTracker (3 consecutive failures → disable 7s)
- SkillRouter: SkillFailureTracker gates skill execution (disabled → fallback), ActionLoopDetector gates action dispatch (loop → suppress), `emitStabilityTrace()` — AIMC_STABILITY_TRACE (diagnostic only, non-influential)
- AgentCore: `startWatchdog()` periodic stability tick, `recordProgress()` after successful execution, stuck recovery via normal think() pipeline, safe mode hints injected as constraint context
- PURELY watchdog + circuit breaker — NO new AI, NO learning, NO decision improvement, NO behavior optimization

### Phase 6: Observability Layer (P0)
- `src/observability/runtime-trace.ts` — RuntimeTraceRecorder with 8-stage trace events (agent_core_input → mineflayer_result), max 50 sessions, 500 events/session, per-think() cycle session lifecycle
- `src/observability/behavior-timeline.ts` — BehaviorTimeline with 23 TimelineEventTypes, append-only, auto-prunes at 5000 entries, query() with filtering, shortcut methods for all event types
- `src/observability/system-health.ts` — SystemHealthTracker computing stuckRate, loopRate, skillSuccessRate, fallbackRate, avgDecisionLatencyMs, health state classification (healthy/unstable/safe_mode/recovering)
- `src/observability/event-collector.ts` — EventCollector singleton ingesting trace sessions, timeline entries, health snapshots, batch ingestion. Non-blocking, never-throws, circular buffer
- `src/observability/exporter.ts` — ObservabilityExporter: exportSnapshot() (full JSON), exportCompact() (key metrics), exportTraceReplay() (single session), exportHealthHistory() (trend), exportTimelineDump() (filtered), healthReport() (human-readable)
- AgentCore: `setObservabilityBackend()`, trace session start/close in think(), trace events at 8 key decision points, health ticks after execution, closed sessions ingested into EventCollector
- SkillRouter: `setObservabilityBackend()`, timeline recording for skill start/complete/failed, fallback events, loop detection events, timeline entries ingested at route exit
- ActionDispatcher: `setTimeline()`, dispatch event ingestion per action
- PURE OBSERVABILITY — NO behavior change, NO decision influence, NO execution impact, all recording non-blocking never-throws

### Phase 0.5: Configuration System
- `config/aimc.config.json` — JSON configuration file with 5 sections: stability thresholds, behavior flags, fallback mappings, voice sensitivity, arbitration weight multipliers
- `src/config/aimc-config.ts` — Typed singleton config loader: `loadConfig()`, `getConfig()`, `getStabilityConfig()`, `getFallbackSkill()`, `getVoicePressureSensitivity()`, `isSafeModeEnabled()`, `reloadConfig()`
- StuckDetector/SafeModeManager: behavior flags wired (`allowCombatInSafeMode`, `preferExploreInSafeMode`) for configurable safe mode hints
- SkillFailureTracker: instance-level fallback map, `setFallbackMap()` for runtime override from config
- SkillRouter: `applyConfig()` method wires fallback map + voice sensitivity + voice timing enable flag
- Voice pressure: `computeTimingModifiers()` accepts `sensitivity` multiplier parameter (1.0 = default)
- BehaviorArbitrator: `applyConfigMultipliers()` for voice/memory weight multipliers + `relationshipProtectionEnabled` flag
- PURE CONFIGURATION — NO new execution paths, NO behavior change beyond parameter tuning, NO AI capability changes

### Phase P1: UI Product Layer
- `electron/renderer/ui/dashboard.html` + `dashboard.js` + `dashboard.css` — 3-panel Electron Dashboard: GameState (health/food/position/inventory), AIFlow (intent badge/skill trace/timeline), SystemHealth (success rate/fallback rate/stuck rate/loop rate/safe mode indicator)
- `electron/renderer/ui/voice-profile.json` — Per-role TTS voice profiles (miner/fighter/scout/support/balanced) with pitch/rate/volume/style + narration pacing
- `src/voice/profile/voice-profile-loader.ts` — Typed singleton loader: `loadVoiceProfiles()`, `getVoiceProfile(role)`, `getDefaultVoiceProfile()`, `reloadVoiceProfiles()`
- `src/voice/text-to-speech.ts` — `applyRoleVoiceProfile(role)` method + `getCurrentVoiceProfile()` for Edge-TTS integration
- `src/ui/state-bridge.ts` — UIStateBridge singleton: polls EventCollector + __botState__ every 1s, builds UI-safe snapshots (UIGameState/UIAIFlow/UISystemHealth), emits via `AIMC_UI_STATE:` stdout lines
- `electron/bot-process-manager.cjs` — Parses `AIMC_UI_STATE:` lines, emits `ui-state` events
- `electron/main.cjs` — Dashboard BrowserWindow (960x620), `sendToDashboard()` helper, `ui-state` forwarding, `dashboard:open` + `dashboard:status` IPC handlers
- `electron/preload.cjs` — `openDashboard()`, `getDashboardStatus()`, `onDashboardState()`, `onDashboardStatus()` exposed via contextBridge
- `electron/renderer/index.html` + `renderer.js` — Dashboard button in launcher UI
- Data flow: `Telemetry/__botState__ → UIStateBridge.poll() → AIMC_UI_STATE stdout → BotProcessManager → main.cjs → IPC → Dashboard renderer`
- PURE READ-ONLY — NO execution, NO behavior change, NO architecture impact, all data paths one-way

### Phase P2: Production Release & Packaging Layer
- `electron-builder.json` — Standalone electron-builder config: appId `com.aimc.mcp`, files (`dist/`, `electron/`, `config/`), asar: true, extraResources (config + voice-profile), win/mac/linux targets
- `package.json` — Updated scripts: `build`, `pack`, `dist`, `release`, `release:win`, `release:portable`, `precheck`; build config with full file inclusion + extraResources
- `scripts/pre-release-check.cjs` — 7 validation checks: TS build output, config file, voice profile, dashboard UI, Electron entry files, build config, launcher renderer. Syntax check for AgentCore/SkillRouter/UIStateBridge in dist/index.js. Emits AIMC_PRE_RELEASE_CHECK: PASS/FAIL
- `scripts/build.cjs` — Pipeline updated: stepPreReleaseCheck() added after compilation, AIMC_RELEASE_BUILD_START/SUCCESS/FAIL telemetry at start/end/error
- `src/config/env-mode.ts` — Environment mode detection: `getMode()`, `isDev()`, `isProd()`. Detects via `AIMC_MODE` env var or Electron packaged detection (`process.resourcesPath`, `.asar` in path)
- Release output: `release/win-unpacked/` with AIMC Launcher.exe, app.asar (813MB), config/ extraResources, voice-profile.json bundled
- Verified: `config/aimc.config.json` and `voice-profile.json` confirmed inside asar
- PURE ENGINEERING — NO AI changes, NO skill changes, NO runtime logic changes, NO architecture changes

---

## LEGACY CODE STATUS (Phase 2.8 Sealed)

### A. ACTIVE LIB (2 files — imported at runtime)

| File | Imported by | Function |
|------|-------------|----------|
| `agent/settings.js` | `legacy-bridge.cjs`, `mcdata.js` | Settings store |
| `utils/mcdata.js` | `legacy-bridge.cjs` | `initBot()` — Mineflayer bot factory |

### B. DEAD CODE (~7500 lines — zero runtime references)

`agent/agent.js`, `coder.js`, `action_manager.js`, `conversation.js`, `history.js`, `memory_bank.js`, `mindserver_proxy.js`, `modes.js`, `self_prompter.js`, `speak.js`, `connection_handler.js`, `npc/**`, `vision/**`, `tasks/**`, `commands/**`, `library/**`, `models/**`, `process/agent_process.js`, `process/init_agent.js`, `mindcraft/**`, `mindcraft-py/**`, `main.js`, `utils/examples.js`, `utils/math.js`, `utils/text.js`, `utils/translator.js`, `settings.js` (duplicate stub)

### C. RISK CODE (zero runtime risk — never activated)

| File | Risk | Reason safe |
|------|------|-------------|
| `agent/agent.js` | Autonomous LLM agent | Never instantiated |
| `process/agent_process.js` | Separate AI process | Never spawned |
| `agent/action_manager.js` | Parallel executor | Never used |
| `agent/commands/index.js` | `!command` system | Never wired |

**All legacy systems are excluded from runtime. They exist for reference only.**

---

## GLOBALTHIS REGISTRY

| Property | Set by | Purpose | Classification |
|----------|--------|---------|----------------|
| `__botState__` | `runtime-context.cjs` | Bot state snapshot (~20Hz), single writer | **NECESSARY** |
| `__BOT__` | `legacy-bridge.cjs` | Raw Mineflayer bot instance | **RISK** — token-gated |
| `__ACTION_DISPATCHER__` | `legacy-bridge.cjs` | ActionDispatcher instance | **LOW RISK** |
| `__WORLD_STATE__` | `legacy-bridge.cjs` | Read-only world queries | **NECESSARY** |
| `__RUNTIME_CONTEXT__` | `legacy-bridge.cjs` | Unified runtime backplane | **NECESSARY** |
| `__SKILL_ROUTER__` | `legacy-bridge.cjs` | SkillRouter instance | **LOW RISK** |
| `__SKILL_REGISTRY__` | `legacy-bridge.cjs` | SkillRegistry instance | **LOW RISK** |
| `__AIMC_GUARD__` | `legacy-bridge.cjs` | Phase 2.5 enforcement guard | **NECESSARY** |
| `__AIMC_ARCH_LOCK__` | `legacy-bridge.cjs` | Phase 2.8 frozen security lock, strictMode=true | **NECESSARY** |
| `__aimc__` | `src/index.ts` | Module reference cache: AgentCore, SkillRouter, PersonalityEngine, VoiceOrchestrator, MemoryStore, RoleAdaptation, RelationshipEngine, and all init/get functions | **LOW RISK** |
| `__AIMC_SKILLROUTER_TOKEN__` | `skill-router.ts` (per-dispatch) | Caller token for dispatch gate | **NECESSARY** |

---

## PROJECT STRUCTURE

```
src/
├── index.ts                     ← Entry point (initAgent, initVoice, initMemory, initPersonality,
│                                    initSkill, initRole, initRelationship, initProduction)
├── interfaces/
│   ├── intent.ts                ← AgentOutput, IntentAction (26 types), ExecutionResult
│   ├── event.ts                 ← GameEvent, EventBus types
│   ├── memory.ts                ← MemoryType definitions
│   └── minecraft.ts             ← BotState, BotRef types
├── runtime/
│   ├── intent-schema.ts         ← Zod schemas for ALL LLM output
│   ├── safety-guard.ts          ← Lava/void/fall/spam/rate/health safety
│   ├── action-dispatcher.ts     ← Intent → Mineflayer (token-gated, SOLE bot controller)
│   ├── runtime-core.ts          ← Validation gate (Zod + SafetyGuard, NO execution)
│   ├── event-bus.ts             ← Async pub/sub with pattern matching
│   └── logger.ts                ← Structured JSON logging
├── skill/
│   ├── skill-definitions.ts     ← 8 built-in skills + SkillContext + fallback metadata
│   ├── skill-registry.ts        ← register/get/list/plan + getFallback + resolveFallback
│   ├── skill-router.ts          ← SOLE execution entry (retry, fallback, telemetry hub)
│   ├── types/skill-result.ts    ← SkillExecutionResult, PlanStepStatus, SkillTrace
│   └── index.ts
├── agent/
│   └── agent-core.ts            ← think(), quickChat(), handleVoiceInput(), proactiveTick(),
│                                    Team/Role/Relationship context injection
├── llm/                         ← DeepSeek V4 Pro integration
│   ├── deepseek-v4-pro.ts       ← generate(), stream, cancel
│   ├── context-assembler.ts     ← Multi-source context builder
│   ├── stream-parser.ts         ← Streaming JSON parser
│   └── prompts/                 ← System, behavior, safety, intent-format prompts
├── voice/                       ← Phase 4-A/B: Voice pipeline
│   ├── voice-orchestrator.ts    ← VAD + Whisper + Edge-TTS lifecycle
│   ├── voice-state.ts           ← VoiceState, NarrationCategory
│   ├── voice-event-bus.ts       ← Voice → EventBus bridge
│   ├── speech-to-text.ts        ← STT adapter
│   ├── text-to-speech.ts        ← TTS adapter, bilingual narration
│   ├── voice-pressure.ts        ← 4-level pressure model, timing modifiers
│   ├── voice-intent-analyzer.ts ← Bilingual keyword + repetition analysis
│   ├── vad.ts                   ← Voice Activity Detection
│   ├── stt-whisper.ts           ← Whisper.cpp integration
│   ├── tts-edge.ts              ← Edge-TTS integration
│   ├── profile/                 ← P1: Voice Profile System
│   │   └── voice-profile-loader.ts ← Per-role TTS settings loader
│   └── index.ts
├── team/                        ← Phase 4-C/F: Team coordination
│   ├── team-state.ts            ← TeamState, 5 team modes
│   ├── tactical-analyzer.ts     ← Deterministic tactical analysis + role-aware bias
│   ├── support-behaviors.ts     ← Passive support actions
│   ├── intent-prediction.ts     ← Player intent prediction (9 types)
│   ├── proactive-support.ts     ← Safe helper action generation (8 types)
│   ├── formation-system.ts      ← Dynamic formation positioning (6 modes)
│   ├── mining-coordination.ts   ← Cooperative mining rhythm
│   ├── combat-synergy.ts        ← Coordinated combat tactics (5 roles)
│   └── index.ts
├── role/                        ← Phase 4-D: Role specialization
│   ├── role-identity.ts         ← 5 CompanionRole types, RoleProfile, CompanionIdentity
│   ├── role-adaptation.ts       ← Slow EMA confidence updates, role switch recommendation
│   ├── role-memory.ts           ← JSON persistence (atomic write, corruption fallback)
│   └── index.ts
├── memory/                      ← Phase 5 + 4-E: Memory & relationship
│   ├── sqlite-store.ts          ← SQLite persistent memory (sql.js)
│   ├── retriever.ts             ← Hybrid memory retrieval
│   ├── importance.ts            ← Importance scoring engine
│   ├── compressor.ts            ← Memory compression/decay
│   ├── types.ts                 ← MemoryEvent, MemoryCandidate, MemoryQuery types
│   ├── relationship-state.ts    ← Familiarity/trust/teamwork tracking
│   ├── shared-experience.ts     ← Meaningful moments timeline (8 categories)
│   ├── memory-callbacks.ts      ← Natural language callback generator
│   ├── memory-persistence.ts    ← JSON persistence (atomic, versioned, auto-save)
│   └── index.ts
├── personality/                 ← Phase 6: Personality system
│   ├── personality-engine.ts    ← Trait-based action/skill weights, voice tone, role voice,
│   │                               interaction warmth, familiarity hints, cooperative initiative
│   ├── personality-profile.ts   ← PersonalityDimensions, 4 presets
│   ├── emotion-engine.ts        ← Emotional state machine
│   ├── social-engine.ts         ← Social interaction modeling
│   └── index.ts
├── behavior/                    ← Phase 6 + 4-G + 5: Proactive behavior + arbitration + stability
│   ├── proactive-engine.ts      ← Autonomous action generation
│   ├── task-planner.ts          ← Goal generation + task lifecycle + plan sync
│   ├── arbitration/
│   │   └── behavior-arbitrator.ts ← Signal collection, weight normalization, emergency rules, action ranking
│   ├── stability/
│   │   └── stuck-detector.ts    ← StuckDetector, ActionLoopDetector, SafeModeManager, SkillFailureTracker
│   └── index.ts
├── heuristics/                  ← Non-LLM survival fast path
│   ├── heuristic-engine.ts
│   └── index.ts
├── recovery/                    ← Watchdog + auto-recovery
│   ├── watchdog.ts
│   ├── recovery-manager.ts
│   └── index.ts
├── coordination/                ← Multi-system coordination
│   ├── coordinator.ts
│   └── index.ts
├── performance/                 ← Profiling + token tracking
│   ├── profiler.ts
│   ├── token-tracker.ts
│   └── index.ts
├── observability/               ← Phase 6: Observability layer (P0)
│   ├── runtime-trace.ts         ← Full execution chain trace (8 stages, 50 sessions max)
│   ├── behavior-timeline.ts     ← Chronological decision log (23 event types)
│   ├── system-health.ts         ← Real-time health metrics tracker
│   ├── event-collector.ts       ← Central non-intrusive event sink (singleton)
│   ├── exporter.ts              ← JSON snapshot, compact, trace replay, health history, timeline dump
│   └── index.ts
├── config/                      ← Phase 0.5 + P2: Configuration system
│   ├── aimc-config.ts           ← Typed singleton config loader, deep merge, telemetry
│   └── env-mode.ts              ← AIMC_MODE detection (dev/prod), isDev(), isProd()
├── ui/                          ← P1: UI State Bridge
│   └── state-bridge.ts          ← Telemetry → UI-safe state, AIMC_UI_STATE emitter
└── legacy/                      ← DEAD CODE — reference only (~7500 lines)
electron-builder.json            ← P2: Production packaging config (win/mac/linux, asar, extraResources)
config/
└── aimc.config.json             ← Runtime-tunable parameters (stability, behavior, fallback, voice, arbitration)
electron/
├── main.cjs                     ← Electron main process
├── legacy-bridge.cjs            ← CJS bridge: bot lifecycle + AgentCore + SkillRouter pipeline
│                                  Sets __AIMC_ARCH_LOCK__, all globalThis properties
├── bot-process-manager.cjs      ← Bot process lifecycle
├── launcher-resolver.cjs        ← Launcher path resolution
├── runtime/
│   ├── bot-runtime-manager.cjs  ← Crash guard, keepAlive, bootstrap, heartbeat
│   └── runtime-context.cjs      ← Bot state sync (physicsTick → __botState__)
└── renderer/                    ← Launcher UI + Dashboard
    ├── ui/                      ← P1: Dashboard
    │   ├── dashboard.html       ← 3-panel layout
    │   ├── dashboard.js         ← IPC subscriber + renderer
    │   ├── dashboard.css        ← Dark theme styles
    │   └── voice-profile.json   ← Per-role TTS profiles
scripts/
├── build.cjs                    ← Build pipeline (guard → drift → typecheck → compile → precheck → pack)
├── pre-release-check.cjs        ← P2: 7-check pre-release validation (AIMC_PRE_RELEASE_CHECK)
├── arch-guard-scan.cjs          ← Architecture guard (5 rules)
└── arch-drift-scan.cjs          ← Architecture drift scanner (15 rules, 4 groups)
```

---

## COMMANDS

```bash
npm run build       # Full build pipeline: arch-guard → arch-drift → typecheck → compile → pack
npm run typecheck   # tsc --noEmit
npm run start       # node dist/index.js (headless)
npm run dev         # tsc && node dist/index.js
npm run electron    # Launch Electron launcher (dev mode)
```

Package release: `npx electron-builder --dir`

---

## CRITICAL RULES (Phase 3-B → P2 — Authority Lock)

1. **AgentCore** is the ONLY AI decision system. No second brain. No legacy AI.
2. **SkillRouter** is the ONLY behavior entry point. Handles ALL intents. No bypass.
3. **ActionDispatcher** is the ONLY entry to Mineflayer. Token enforced at `dispatch()`.
4. **RuntimeCore** is VALIDATION-ONLY. Zero execution since Phase 2.5.
5. **RuntimeContext** is the ONLY state source. No independent state evolution.
6. Execution MUST follow: `AgentCore → RuntimeCore.validate → SkillRouter.route → ActionDispatcher.dispatch → Mineflayer`.
7. **SafetyGuard** validates every intent in `RuntimeCore.validate()` before SkillRouter sees it.
8. All skill execution includes retry (max 2) + fallback (max 2 hops) + `AIMC_SKILL_TRACE`.
9. **Legacy code is DEAD CODE** — only `settings.js` + `mcdata.js` active. ~7500 lines excluded.
10. **`__AIMC_ARCH_LOCK__` v2.8-frozen** — set at bootstrap, `strictMode=true`, immutable.
11. **Build fails** if `scripts/arch-guard-scan.cjs` or `scripts/arch-drift-scan.cjs` detect violations.
12. **Skills NEVER** bypass ActionDispatcher or access `bot.*` directly.
13. **Soft layers** (voice, tactical, role, relationship, cooperative) are PASSIVE ONLY — they inject context and influence weights/timing, never execute.
14. **CLAUDE.md IS AUTHORITY** — if code and doc conflict, doc is updated first or code is rejected.
15. **Architecture invariants I-1 through I-10** are non-negotiable. Violation = system broken.
16. **All telemetry is side-effect only** — 14 trace types, zero execution impact.
17. **Phase 6 active** — full observability: every decision, action, failure, and recovery is traceable and replayable.
18. **Observability hooks MUST NOT modify behavior** — all trace recording is non-blocking, never-throws, wrapped in try/catch.
19. **EventCollector is PURE SINK** — async fire-and-forget, no feedback loop into AgentCore or SkillRouter.

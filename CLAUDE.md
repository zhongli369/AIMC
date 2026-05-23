# CLAUDE.md — AI Minecraft Companion (AIMC)

Production-grade AI teammate for Minecraft. LLM-driven agent with structured intent pipeline, skill system, safety guard, voice pipeline, team coordination, role specialization, relationship memory, cooperative autonomy, behavior arbitration, stability recovery, observability, runtime config, Electron dashboard UI, and one-click production release. Default language: Chinese (中文).

---

## RUNTIME TRUTH MODEL

If code and this document conflict, **this document must be updated first, or the code must be rejected.**

### Canonical Execution Chain (ONLY valid path)

```
User Input / Proactive Tick / Voice Input / Team Context
        │
        ▼
AgentCore.think()          ← Sole AI brain. Assembles context from soft layers, generates AgentOutput.
        │
        ▼
RuntimeCore.validate()     ← Zod + SafetyGuard. VALIDATION ONLY — zero execution.
        │
        ▼
BehaviorArbitrator         ← Resolves conflicting soft-layer signals → single ranked action list.
        │
        ▼
SkillRouter.route()        ← Sole execution entry. Sets token → retry + fallback + telemetry.
        │
        ▼
ActionDispatcher.dispatch() ← Sole bot controller. verifyCaller() token-gated.
        │
        ▼
Mineflayer Bot
```

**No other execution path exists at runtime.**

### Module Roles

| Module | Role |
|--------|------|
| `AgentCore` | Sole AI brain — reasoning, context assembly, AgentOutput generation |
| `RuntimeCore` | **Validate only** — Zod schema + SafetyGuard |
| `SkillRouter` | Sole execution entry — intent → skill/chat/plan, token, retry, fallback |
| `ActionDispatcher` | Sole bot controller — token-gated, sole owner of `bot.*()` |
| `RuntimeContext` | Sole state source — `__botState__` (~20Hz) |
| Soft layers | **Passive influence only** — context injection, weight/timing biases, NEVER execute |
| `src/legacy/` | **DEAD CODE** — only `settings.js` + `mcdata.js` active |

---

## ARCHITECTURE INVARIANTS (NON-NEGOTIABLE)

| # | Invariant |
|---|-----------|
| I-1 | Exactly ONE AI brain: `AgentCore` |
| I-2 | Exactly ONE execution router: `SkillRouter` |
| I-3 | Exactly ONE bot controller: `ActionDispatcher` |
| I-4 | `RuntimeCore` MUST NOT execute actions |
| I-5 | No module calls `bot.*` directly except `ActionDispatcher` |
| I-6 | All execution passes token gate: `__AIMC_ARCH_LOCK__.strictMode === true` |
| I-7 | All state originates from `RuntimeContext` |
| I-8 | `__AIMC_ARCH_LOCK__` is immutable at runtime |
| I-9 | Legacy code is dead — zero instantiation |
| I-10 | All new code is TypeScript strict mode |

---

## SELF-AUDIT CHECKLIST

**Before ANY code change, answer these 5 questions. Any YES = REJECT.**

| # | Question |
|---|----------|
| 1 | Does this introduce a second execution path? |
| 2 | Does this bypass `SkillRouter.route()`? |
| 3 | Does this modify `ActionDispatcher` security/token logic? |
| 4 | Does this introduce direct `bot.*` access outside `ActionDispatcher`? |
| 5 | Does this modify the runtime chain order? |

Secondary: new globalThis property → document in GlobalThis Registry. New skill → register in SkillRegistry. AgentOutput schema change → update RuntimeCore validation first. `src/legacy/` touch → verify it's only `settings.js` or `mcdata.js`.

---

## FORBIDDEN (architecture violation)

- New AI loops, execution pipelines, parallel agent systems
- Direct bot control outside ActionDispatcher
- `SkillRouter.route()` bypass, token gate circumvention
- `RuntimeCore` execution logic
- Legacy code reactivation
- Independent state evolution

---

## EXECUTION SECURITY MODEL

| Layer | Guardian | Mechanism |
|-------|----------|-----------|
| Build guard | `scripts/arch-guard-scan.cjs` | 5 rules static analysis |
| Build drift | `scripts/arch-drift-scan.cjs` | 15 rules, 4 groups |
| Bootstrap | `legacy-bridge.cjs` | Sets `__AIMC_ARCH_LOCK__` v2.8-frozen |
| Caller gate | `SkillRouter` | Sets `__AIMC_SKILLROUTER_TOKEN__` before dispatch |
| Dispatch gate | `ActionDispatcher.verifyCaller()` | Checks token + strictMode |

Token flow: `SkillRouter sets token → dispatch → verifyCaller() checks → SkillRouter clears token`. Violation emits `system:arch_violation`.

---

## SKILL SYSTEM

### 8 Core Skills

| Skill | Category | Fallback |
|-------|----------|----------|
| `follow_player` | movement | `explore_area` |
| `mine_resource` | gathering | `explore_area` |
| `attack_target` | combat | `defend_player` |
| `gather_food` | gathering | `collect_items` |
| `build_shelter` | building | — |
| `collect_items` | gathering | — |
| `explore_area` | movement | — |
| `defend_player` | combat | — |

### Execution Model

- Retry: max 2 per action, 100→300→600ms backoff
- Fallback: max 2-hop chain. A→B→C stops at C.
- Telemetry: `AIMC_SKILL_TRACE` JSON to stdout (side-effect only)
- Plan step lifecycle: `pending → running → success/failed/retrying/skipped`
- Skills execute ONLY through `SkillRouter.route()`, NEVER call `ActionDispatcher` or `bot.*` directly

---

## PHASE HISTORY (all complete)

1→2→2.5→2.6→2.7→2.8 (System Freeze) → 3 (AgentCore + DeepSeek) → 3-A/B/C (Reliability/Docs/Drift) → 4-A/B/C/D/E/F/G (Voice/Tactical/Role/Memory/Coop/Arbitration) → 5 (Stability) → 6 (Observability) → 0.5 (Config) → P1 (UI Dashboard) → P2 (Production Release)

**Topology permanently frozen:** `AgentCore → RuntimeCore.validate → SkillRouter → ActionDispatcher → Mineflayer`. All extensions are soft influence layers (context injection, weight/timing bias). 170 source files, 0 violations, 0 drift.

---

## SOFT INFLUENCE LAYERS (passive only)

Personality, Emotion, Social, Proactive, Heuristic, Voice (STT/TTS), Voice Pressure, Tactical, Support, Role, Relationship, Shared Experience, Memory Callbacks, Intent Prediction, Proactive Support, Formation, Mining, Combat, Arbitration, Stuck Detection, Loop Detection, Skill Backoff, Safe Mode, Runtime Trace, Behavior Timeline, System Health, Event Collector, Exporter, UI State Bridge, Voice Profile.

All layers inject context or influence weights/timing. They NEVER execute actions or bypass SkillRouter.

---

## GLOBALTHIS REGISTRY

| Property | Set by | Classification |
|----------|--------|----------------|
| `__botState__` | `runtime-context.cjs` | NECESSARY |
| `__BOT__` | `legacy-bridge.cjs` | RISK — token-gated |
| `__ACTION_DISPATCHER__` | `legacy-bridge.cjs` | LOW RISK |
| `__WORLD_STATE__` | `legacy-bridge.cjs` | NECESSARY |
| `__RUNTIME_CONTEXT__` | `legacy-bridge.cjs` | NECESSARY |
| `__SKILL_ROUTER__` | `legacy-bridge.cjs` | LOW RISK |
| `__SKILL_REGISTRY__` | `legacy-bridge.cjs` | LOW RISK |
| `__AIMC_ARCH_LOCK__` | `legacy-bridge.cjs` | NECESSARY |
| `__AIMC_SKILLROUTER_TOKEN__` | `skill-router.ts` | NECESSARY |
| `__aimc__` | `src/index.ts` | LOW RISK |

---

## LEGACY CODE

**ACTIVE:** `agent/settings.js`, `utils/mcdata.js` only. **DEAD:** ~7500 lines (agent.js, coder.js, action_manager.js, conversation.js, modes.js, npc/**, vision/**, mindcraft/**, commands/** etc.) — zero runtime references.

---

## COMMANDS

```bash
npm run build       # arch-guard → arch-drift → typecheck → compile → precheck → pack
npm run typecheck   # tsc --noEmit
npm run start       # node dist/index.js (headless)
npm run dev         # tsc && node dist/index.js
npm run electron    # Launch Electron launcher (dev mode)
```

Package release: `npx electron-builder --dir`

---

## CRITICAL RULES

1. **AgentCore** is the ONLY AI decision system.
2. **SkillRouter** is the ONLY behavior entry point.
3. **ActionDispatcher** is the ONLY entry to Mineflayer — token-gated.
4. **RuntimeCore** is VALIDATION-ONLY.
5. **RuntimeContext** is the ONLY state source.
6. Execution: `AgentCore → RuntimeCore.validate → SkillRouter.route → ActionDispatcher.dispatch → Mineflayer`.
7. **Soft layers are PASSIVE ONLY** — context/weight/timing influence, never execute.
8. **Skills NEVER** bypass ActionDispatcher or access `bot.*` directly.
9. **Legacy code is DEAD** — only `settings.js` + `mcdata.js` active.
10. **`__AIMC_ARCH_LOCK__` v2.8-frozen** — immutable, strictMode=true.
11. **Build fails** on arch-guard-scan or arch-drift-scan violations.
12. **CLAUDE.md IS AUTHORITY** — code/doc conflict → update doc first or reject code.
13. **Architecture invariants I-1 through I-10** are non-negotiable.
14. **Observability is PURE SINK** — non-blocking, never-throws, no feedback loop.

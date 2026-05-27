# CLAUDE.md — AI Minecraft Companion (AIMC)

LLM-driven Minecraft agent. Execution topology permanently frozen. Default language: Chinese (中文).

If code and this document conflict, **this document is authority — update it first, or reject the code.**

---

## Canonical Execution Chain (ONLY valid path)

```
User Input / Proactive Tick / Voice Input / Team Context
  → AgentCore.think()            ← Sole AI brain
  → RuntimeCore.validate()       ← Zod + SafetyGuard, VALIDATION ONLY
  → BehaviorArbitrator           ← Resolves soft-layer conflicts → ranked action list
  → SkillRouter.route()          ← Sole execution entry, token-gated
  → ActionDispatcher.dispatch()  ← Sole bot controller, verifyCaller() token-gated
  → Mineflayer Bot
```

**No other execution path exists at runtime.**

---

## Architecture Invariants (NON-NEGOTIABLE)

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
| I-9 | Legacy code is dead — only `settings.js` + `mcdata.js` active |
| I-10 | All new code is TypeScript strict mode |

---

## Self-Audit (before ANY code change — any YES = REJECT)

1. Does this introduce a second execution path?
2. Does this bypass `SkillRouter.route()`?
3. Does this modify `ActionDispatcher` security/token logic?
4. Does this introduce direct `bot.*` access outside `ActionDispatcher`?
5. Does this modify the runtime chain order?

Secondary: new globalThis → document. New skill → register in SkillRegistry. AgentOutput schema change → update RuntimeCore validation first.

---

## Forbidden

- New AI loops, execution pipelines, parallel agent systems
- Direct bot control outside ActionDispatcher
- `SkillRouter.route()` bypass, token gate circumvention
- `RuntimeCore` execution logic
- Legacy code reactivation
- Independent state evolution

---

## Execution Security

| Layer | Guardian | Mechanism |
|-------|----------|-----------|
| Build guard | `scripts/arch-guard-scan.cjs` | 5 rules static analysis |
| Build drift | `scripts/arch-drift-scan.cjs` | 15 rules, 4 groups |
| Bootstrap | `legacy-bridge.cjs` | Sets `__AIMC_ARCH_LOCK__` v2.8-frozen |
| Caller gate | `SkillRouter` | Sets token → dispatch → verifyCaller() → clears token |

---

## Skill System

8 core skills. Retry: max 2, 100→300→600ms backoff. Fallback: max 2-hop chain. Skills execute ONLY through `SkillRouter.route()`, NEVER call `ActionDispatcher` or `bot.*` directly.

---

## Commands

```bash
npm run build       # arch-guard → arch-drift → typecheck → compile → precheck → pack
npm run typecheck   # tsc --noEmit
npm run start       # node dist/index.js (headless)
npm run dev         # tsc && node dist/index.js
npm run electron    # Launch Electron launcher (dev mode)
```

Package release: `npx electron-builder --dir`

---

## Critical Rules

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

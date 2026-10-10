# CLAUDE.md — AI Minecraft Companion (AIMC)

LLM-driven Minecraft agent. Execution topology permanently frozen. Default language: Chinese (中文).

If code and this document conflict, **this document is authority — update it first, or reject the code.**

---

## Canonical Execution Chain (ONLY valid path)

```text
User Input / Proactive Tick / Voice Input / Team Context
  → AgentCore.think()            ← Sole AI brain
  → RuntimeCore.validate()       ← Zod + SafetyGuard, VALIDATION ONLY
  → BehaviorArbitrator           ← Resolves soft-layer conflicts → ranked action list
  → SkillRouter.route()          ← Sole execution entry, token-gated
  → ActionDispatcher.dispatch()  ← Sole bot controller, verifyCaller() token-gated
  → Mineflayer Bot
```

No other execution path exists at runtime.

## Architecture Invariants

| # | Invariant |
|---|---|
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

## Self-Audit (before ANY code change — any YES = REJECT)

1. Does this introduce a second execution path?
2. Does this bypass `SkillRouter.route()`?
3. Does this modify `ActionDispatcher` security/token logic?
4. Does this introduce direct `bot.*` access outside `ActionDispatcher`?
5. Does this modify the runtime chain order?

Secondary: new globalThis → document. New skill → register in SkillRegistry. AgentOutput schema change → update RuntimeCore validation first.

## Forbidden

- New AI loops, execution pipelines, parallel agent systems
- Direct bot control outside ActionDispatcher
- `SkillRouter.route()` bypass, token gate circumvention
- `RuntimeCore` execution logic
- Legacy code reactivation
- Independent state evolution

## Commands

```bash
npm run build       # arch-guard → arch-drift → typecheck → compile → precheck → pack
npm run typecheck   # tsc --noEmit
npm run start       # node dist/index.js (headless)
npm run dev         # tsc && node dist/index.js
npm run electron    # Launch Electron launcher (dev mode)
```

## Voice / TTS Boundary

- TTS failure never blocks bot chat or action execution.
- `DOUBAO_API_KEY` (LLM/ARK) ≠ `DOUBAO_TTS_API_KEY` (TTS).
- Store credentials only in environment variables, never source files.

## External Harness Routing (on demand only)

Three-layer harness is stable; entry commands use absolute paths and work from any dir.

| Need | Route | Entry command |
|---|---|---|
| Planning / AC / risk / execution prompt | CodeLike | `python F:\Claude\ClaudeCodeProject\Codex-likePlanningKernel\brain\cli.py plan "requirement" --json` |
| Governed multi-step execution / evidence | WorkFlow | `python F:\Claude\ClaudeCodeProject\WorkFlow\__main__.py pipeline --from-delivery-success --with-post-approval` |
| Architecture / security / complexity governance | SystemKernel | `python F:\Claude\SystemKernel\v3\cli\systemkernel.py v4 status` |

Default: do not load long SystemKernel / CodeLike / WorkFlow histories; call the entry command, use the result in this project. AIMC architecture rules above remain local authority.

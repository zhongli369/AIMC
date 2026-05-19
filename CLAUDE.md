# CLAUDE.md — AI Minecraft Companion (AIMC)

Production-grade AI teammate system for Minecraft. LLM-driven agent with structured intent pipeline, safety guard, and voice-ready streaming architecture. Default language: Chinese (中文).

## Architecture Rule (CRITICAL)

**LLM NEVER directly controls Minecraft.** Every LLM output flows through:

```
DeepSeek V4 → AgentOutput JSON → Zod Schema → SafetyGuard → ActionDispatcher → Mineflayer
```

No bypass paths exist. All LLM output is untrusted input.

## Electron Launcher

```
renderer (UI) ←──IPC──→ main.cjs ←──spawn + stdin/stdout JSON──→ legacy-bridge.cjs
                                                                   ├── src/legacy/main.js (Mindcraft)
                                                                   └── dist/index.js (AgentCore + RuntimeCore)
```

- `npm run electron` — launch the Electron app (dev mode from source)
- `npx electron-builder --dir` — package to `release/win-unpacked/` for standalone use
- User chat messages flow: renderer → IPC → main → stdin → bridge → AgentCore.think() → LLM → RuntimeCore → stdout → main → IPC → renderer
- Bridge protocol: stdin = JSON lines `{"type":"chat","message":"..."}`, stdout = `AIMC_MSG:{...}` prefixed JSON, plain text otherwise
- Legacy `!stop`, `!go` commands in game chat remain fully compatible

## Project Structure

```
src/
├── index.ts                  ← Entry point (exports initAgent, initVoice, initMemory, etc.)
├── interfaces/               ← Type contracts
│   ├── intent.ts             ← AgentOutput, IntentAction (30 types), ExecutionResult
│   ├── event.ts              ← GameEvent, EventBus types (5 categories)
│   └── memory.ts             ← MemoryEntry, RetrievalQuery
├── runtime/                  ← Phase 2: Runtime Execution Layer
│   ├── intent-schema.ts      ← Zod schemas for ALL LLM output
│   ├── safety-guard.ts       ← Lava/void/fall/spam/rate/health safety
│   ├── action-dispatcher.ts  ← Intent → Mineflayer (30 actions, retry, queue)
│   ├── runtime-core.ts       ← Central pipeline orchestrator
│   ├── event-bus.ts          ← Async pub/sub with pattern matching
│   └── logger.ts             ← Structured JSON logging
├── minecraft/
│   └── bot-core.ts           ← Mineflayer lifecycle (connect, reconnect, state)
├── llm/                      ← LLM integration (DeepSeek V4 Pro)
│   ├── prompts/              ← System, safety, behavior, intent-format (ALL CHINESE)
│   ├── deepseek-v4-pro.ts    ← Streaming SSE client with retry + timeout
│   ├── context-assembler.ts  ← Builds context from bot state + events + chat
│   └── stream-parser.ts      ← Incremental JSON reconstruction
├── agent/
│   └── agent-core.ts         ← think(), quickChat(), assessDanger()
├── voice/                    ← Phase 4
│   └── voice-orchestrator.ts ← VAD + Whisper.cpp + Edge-TTS pipeline
├── memory/                   ← Phase 5
│   ├── sqlite-store.ts       ← SQLite persistence
│   └── memory-retriever.ts   ← Hybrid retrieval (keyword + vector)
├── personality/              ← Phase 6
│   ├── personality-engine.ts ← 4 presets (companion, builder, explorer, guardian)
│   ├── emotion-engine.ts     ← Emotional state simulation
│   └── social-engine.ts      ← Relationship tracking
├── behavior/
│   ├── proactive-engine.ts   ← Autonomous action generation
│   └── task-planner.ts       ← Multi-step task decomposition
├── coordination/             ← Multi-system orchestration
├── performance/              ← Profiler + token budget tracking
├── heuristics/               ← Non-LLM decision layer
├── recovery/                 ← Watchdog + auto-recovery
├── legacy/                   ← Original Mindcraft code (preserved)
electron/
├── main.cjs                  ← Electron main process (window, IPC, bot lifecycle)
├── preload.cjs               ← contextBridge API (config, bot control, chat)
├── legacy-bridge.cjs         ← CJS bridge: legacy bot + new AgentCore pipeline
└── renderer/
    ├── index.html            ← Launcher UI
    ├── renderer.js           ← Vanilla JS form/console/chat logic
    └── style.css             ← Dark theme (GitHub-style)
```

## Phase Status

| Phase | Status | Description |
|-------|--------|-------------|
| 1 | Complete | Safe migration, TypeScript, legacy preserved |
| 2 | Complete | Runtime execution layer (Zod, SafetyGuard, ActionDispatcher, RuntimeCore) |
| 3 | Complete | AgentCore + DeepSeek V4 streaming + context assembler |
| 4 | Code Ready | Voice pipeline (Whisper.cpp + Edge-TTS), not yet wired to Electron |
| 5 | Code Ready | Memory system (SQLite + hybrid retrieval), not yet wired to Electron |
| 6 | Code Ready | Personality + proactive engine + coordination, not yet wired to Electron |

## Commands

```bash
npm run build       # TypeScript compilation (tsc)
npm run typecheck   # tsc --noEmit
npm run start       # node dist/index.js (headless, no UI)
npm run dev         # tsc && node dist/index.js
npm run electron    # Launch Electron launcher (dev mode)
```

Legacy bot: `node src/legacy/main.js`
Package release: `npx electron-builder --dir`

## Key Design Decisions

- **Zod validation**: All LLM output validated against strict schemas. `validateAgentOutput()` is the gate.
- **SafetyGuard**: Can OVERRIDE LLM intents. Emergency stop blocks all actions globally.
- **ActionDispatcher**: Sequential queue with retry (max 3) and exponential backoff. Priority 4-5 jumps queue.
- **EventBus**: Async, non-blocking. `category:type` pattern matching. All modules communicate through it.
- **Streaming-first**: LLM responses streamed and parsed incrementally. Early termination when valid JSON detected.
- **Chinese default**: All system/behavior/safety/intent prompts are in Chinese. Bot speaks Chinese by default.
- **Bridge protocol**: Main process ↔ bot process via stdin/stdout JSON lines. `AIMC_MSG:` prefix for structured messages.
- **Dual pipeline**: Legacy Mindcraft !commands coexist with new AgentCore pipeline. Chat UI goes through new pipeline.
- **Lazy init**: All subsystems (agent, voice, memory, personality) initialized on demand via exported `init*()` functions.

## Critical Rules

1. No LLM output bypasses `RuntimeCore.processAgentOutput()`
2. SafetyGuard validates every intent before ActionDispatcher executes
3. Fallback idle intent on any pipeline failure
4. Legacy Mindcraft code runs unchanged alongside new pipeline
5. All new code is TypeScript with strict mode
6. Bot communicates in Chinese by default (prompts are Chinese)

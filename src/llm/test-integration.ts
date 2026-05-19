/**
 * Phase 3 integration test — validates LLM pipeline end-to-end.
 * Run: node --import tsx src/llm/test-integration.ts
 * Or: tsc && node dist/llm/test-integration.js
 */
import { StreamParser } from "./stream-parser.js";
import { ContextAssembler } from "./context-assembler.js";
import { buildSystemPrompt, estimateTokens } from "./prompts/index.js";
import { RuntimeCore } from "../runtime/index.js";

let passed = 0;
let failed = 0;

function test(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  PASS: ${name}`);
    passed++;
  } else {
    console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

async function run() {
  // ── Test 1: StreamParser incremental ──────────────
  console.log("=== Test 1: StreamParser Incremental ===");
  const parser = new StreamParser();
  const chunks = [
    '{"spee',
    'ch":{"text":"H',
    'ello!","tone":"friendly"},"act',
    'ions":[]}',
  ];
  for (const chunk of chunks) {
    parser.feed(chunk);
  }
  const final = parser.finalize();
  test("Incremental JSON assembly", final.state === "done");
  test("Speech text correct", final.output?.speech?.text === "Hello!");

  // ── Test 2: Markdown fence stripping ──────────────
  console.log("=== Test 2: Markdown Fence Handling ===");
  const parser2 = new StreamParser();
  const mdChunk = '```json\n{"speech":{"text":"Hi!","tone":"neutral"},"actions":[]}\n```';
  parser2.feed(mdChunk);
  const final2 = parser2.finalize();
  test("Markdown fence stripped", final2.state === "done");
  test("Output extracted correctly", final2.output?.speech?.text === "Hi!");

  // ── Test 3: Malformed input ──────────────────────
  console.log("=== Test 3: Malformed Input ===");
  const parser3 = new StreamParser();
  parser3.feed("Here's what I think...\n");
  parser3.feed('{"speech":{"text":"ok","tone":"neutral"},"actions":[]}');
  parser3.feed("\nHope that helps!");
  const final3 = parser3.finalize();
  test("Extracts JSON from surrounding text", final3.state === "done");
  test("Correct output despite noise", final3.output?.speech?.text === "ok");

  // ── Test 4: ContextAssembler token budget ─────────
  console.log("=== Test 4: ContextAssembler ===");
  const assembler = new ContextAssembler();
  const ctx = assembler.build({
    botState: {
      lifecycle: "active",
      health: 18, food: 15, saturation: 10,
      position: { x: 100, y: 64, z: 200 },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: 0, pitch: 0, onGround: true, isInWater: false,
      biome: "plains", dimension: "overworld", timeOfDay: "day",
      weather: "clear",
      heldItem: { name: "diamond_pickaxe", displayName: "Diamond Pickaxe", count: 1, slot: 0 },
      gameMode: "survival",
      experience: { points: 10, level: 3 },
    },
    recentEvents: [],
    chatHistory: [
      { source: "Steve", message: "Hey, can you help me mine?" },
      { source: "bot", message: "Sure! What are we looking for?" },
    ],
    nearbyEntities: ["zombie (12m)", "sheep (8m)", "Steve (3m)"],
  });
  test("Token budget under 4000", ctx.estimatedTokens < 4000, `${ctx.estimatedTokens} tokens used`);
  test("System prompt under 2500 tokens", estimateTokens(buildSystemPrompt()) < 2500);
  test("Correct message structure", ctx.messages.length >= 3);

  // ── Test 5: RuntimeCore validation (schema + safety gate) ─
  console.log("=== Test 5: RuntimeCore Validation ===");
  const core = new RuntimeCore();
  core.start();
  const r1 = core.validate({
    speech: { text: "Normal operation", tone: "friendly" },
    actions: [{
      id: "act-1", type: "speak_chat",
      target: { text: "Hello!" }, priority: 2, reason: "Test",
    }],
  });
  test("Normal validation passes", r1.output !== null && r1.output.actions.length > 0);

  core.emergencyStop("test emergency");
  const r2 = core.validate({
    actions: [{
      id: "blocked", type: "attack_entity",
      target: { entityName: "zombie" }, priority: 3, reason: "Should be blocked",
    }],
  });
  test("Emergency blocks intents", r2.rejectedIntents.length > 0);
  test("Block reason correct", /emergency/i.test(r2.rejectedIntents[0]?.errors[0]?.message ?? ""));
  core.clearEmergency();
  core.shutdown();

  // ── Summary ─────────────────────────────────────
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});

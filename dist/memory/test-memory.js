/**
 * Phase 5 integration test — validates memory store, importance, retrieval, compression.
 * Run: npx tsx src/memory/test-memory.ts
 */
import { SQLiteMemoryStore } from "./sqlite-store.js";
import { ImportanceEngine, scoreImportance } from "./importance.js";
import { MemoryRetriever } from "./retriever.js";
import { MemoryCompressor } from "./compressor.js";
import { existsSync, unlinkSync } from "node:fs";
const TEST_DB = "./bots/memory/test-aimc-memory.db";
let passed = 0;
let failed = 0;
function test(name, condition, detail) {
    if (condition) {
        console.log(`  PASS: ${name}`);
        passed++;
    }
    else {
        console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
        failed++;
    }
}
async function run() {
    // Clean up from previous run
    if (existsSync(TEST_DB))
        unlinkSync(TEST_DB);
    console.log("=== Test 1: SQLite Store Init & Save ===");
    const store = new SQLiteMemoryStore({ dbPath: TEST_DB, autoSave: false });
    await store.init();
    const stats = await store.stats();
    test("Store initializes empty", stats.totalEntries === 0);
    const candidates = [
        {
            type: "event",
            summary: "Player Steve found diamonds at y=-54",
            details: "Steve mined 5 diamond ore blocks near a lava pool",
            importance: 8,
            tags: ["mining", "diamond", "rare"],
            relatedEntities: ["Steve"],
            location: { x: 100, y: -54, z: 200, dimension: "overworld" },
            source: "system",
        },
        {
            type: "failure",
            summary: "Bot died to a creeper explosion",
            details: "Creeper sneaked up from behind while bot was mining. Health dropped to 0 instantly.",
            importance: 10,
            emotionalValence: -0.9,
            tags: ["death", "creeper", "explosion", "mining"],
            relatedEntities: ["creeper"],
            location: { x: 95, y: -50, z: 195 },
            source: "system",
        },
        {
            type: "event",
            summary: "Player asked bot to follow into the forest",
            details: "Steve said 'follow me' and ran towards the dark oak forest",
            importance: 5,
            tags: ["chat", "follow", "player"],
            relatedEntities: ["Steve"],
            source: "event",
        },
        {
            type: "location",
            summary: "Found a village at coordinates",
            details: "Plains village with 3 villagers, a blacksmith, and wheat farms",
            importance: 6,
            tags: ["village", "structure", "safe"],
            relatedEntities: ["villager"],
            location: { x: -300, y: 64, z: 500, dimension: "overworld" },
            source: "system",
        },
        {
            type: "task",
            summary: "Build a wheat farm near base",
            details: "Player wants a 9x9 wheat farm with water source in center",
            importance: 4,
            tags: ["building", "farm", "task", "player_request"],
            relatedEntities: ["Steve"],
            location: { x: 50, y: 64, z: 50 },
            source: "llm",
        },
    ];
    for (const c of candidates) {
        const saved = await store.save(c);
        test(`Save: ${saved.type}`, saved.id.length > 0);
    }
    const stats2 = await store.stats();
    test("Store has 5 entries", stats2.totalEntries === 5);
    console.log(`  Stats: ${stats2.totalEntries} entries, avg importance: ${stats2.avgImportance}`);
    console.log("\n=== Test 2: Query Operations ===");
    const byType = await store.queryByType("failure", 10);
    test("Query by type 'failure'", byType.length === 1);
    test("Failure is the creeper death", byType[0]?.summary.includes("creeper"));
    const recent = await store.getRecent(10);
    test("Get recent returns results", recent.length > 0);
    const keywordResults = await store.query({
        keywordSearch: "diamond",
        limit: 5,
    });
    test("Keyword search finds diamond", keywordResults.events.some((e) => e.tags.includes("diamond")));
    console.log("\n=== Test 3: Importance Engine ===");
    const engine = new ImportanceEngine();
    const deathCandidate = {
        type: "event",
        summary: "Bot died in lava",
        details: "Fell into lava while nether mining",
        importance: 0,
        tags: ["death", "lava", "nether"],
        source: "system",
    };
    const deathScore = engine.score(deathCandidate);
    test("Death events score high (>=8)", deathScore >= 8, `got ${deathScore}`);
    const rareItemCandidate = {
        type: "event",
        summary: "Found netherite scrap in ancient debris",
        details: "Mined ancient debris at y=15 in the nether",
        importance: 0,
        tags: ["netherite", "rare", "mining"],
        source: "system",
    };
    const rareScore = engine.score(rareItemCandidate);
    test("Rare item events score high (>=7)", rareScore >= 7, `got ${rareScore}`);
    const trivialCandidate = {
        type: "event",
        summary: "Bot walked 10 blocks north",
        details: "Routine movement",
        importance: 0,
        tags: ["movement"],
        source: "system",
    };
    const trivialScore = engine.score(trivialCandidate);
    test("Trivial events score low (<=3)", trivialScore <= 3, `got ${trivialScore}`);
    // Quick function
    test("scoreImportance() convenience", scoreImportance(deathCandidate) >= 8);
    console.log("\n=== Test 4: Memory Retrieval ===");
    const retriever = new MemoryRetriever();
    const retrieval = await retriever.retrieve({
        store,
        queryText: "Where did we find diamonds",
        currentLocation: { x: 100, y: 64, z: 200 },
        limit: 5,
    });
    test("Retrieval finds diamond memory", retrieval.memories.length > 0);
    test("Diamond memory found in results", retrieval.memories.some((m) => m.event.tags.includes("diamond")));
    test("Top result is highest importance (death)", retrieval.memories[0]?.event.importance === 10);
    test("Context text is non-empty", retrieval.contextText.length > 0);
    console.log(`  Context text:\n${retrieval.contextText}`);
    const urgentRetrieval = await retriever.retrieveUrgent({
        store,
        currentLocation: { x: 95, y: -50, z: 195 },
    });
    test("Urgent retrieval near death location returns death event", urgentRetrieval.memories.some((m) => m.event.type === "failure"));
    console.log("\n=== Test 5: Memory Compression ===");
    const compressor = new MemoryCompressor({
        maxAgeMs: 0, // Compress everything
        minImportanceToKeep: 9, // Only keep importance >= 9
        maxUncompressed: 2,
        mergeSimilar: true,
        batchSize: 10,
    });
    const compressed = await compressor.compress(store);
    test("Compression runs without error", compressed >= 0, `${compressed} compressed`);
    const stats3 = await store.stats();
    console.log(`  After compression: ${stats3.totalEntries} entries, ${stats3.decayedCount} decayed`);
    // Cleanup
    store.close();
    if (existsSync(TEST_DB))
        unlinkSync(TEST_DB);
    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    process.exit(failed > 0 ? 1 : 0);
}
run().catch((err) => {
    console.error("Test error:", err);
    process.exit(1);
});
//# sourceMappingURL=test-memory.js.map
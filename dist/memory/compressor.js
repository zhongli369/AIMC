// ─── Default Config ──────────────────────────────────
const DEFAULT_CONFIG = {
    maxAgeMs: 3600_000, // 1 hour
    minImportanceToKeep: 4, // Keep importance >= 4 uncompressed
    maxUncompressed: 500, // Max uncompressed memories to retain
    mergeSimilar: true,
    batchSize: 20,
};
// ─── Similarity Helpers ──────────────────────────────
function sharedTags(a, b) {
    const setB = new Set(b);
    return a.filter((t) => setB.has(t)).length;
}
function keywordOverlap(a, b) {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = b.toLowerCase().split(/\s+/);
    return wordsB.filter((w) => wordsA.has(w) && w.length > 3).length;
}
function areSimilar(a, b, threshold = 3) {
    if (a.type !== b.type)
        return false;
    let score = 0;
    // Same type: +1
    score += 1;
    // Shared tags
    score += sharedTags(a.tags, b.tags);
    // Keyword overlap in summary
    score += keywordOverlap(a.summary, b.summary);
    // Similar location (within 16 blocks)
    if (a.location && b.location) {
        const dx = a.location.x - b.location.x;
        const dy = a.location.y - b.location.y;
        const dz = a.location.z - b.location.z;
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 16) {
            score += 2;
        }
    }
    return score >= threshold;
}
// ─── Compressor ──────────────────────────────────────
export class MemoryCompressor {
    config;
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Run one compression cycle against the store.
     * Returns count of memories compressed.
     */
    async compress(store) {
        let compressed = 0;
        // 1. Decay old, low-importance memories
        compressed += await this.decayOldMemories(store);
        // 2. Merge similar memories (if enabled)
        if (this.config.mergeSimilar) {
            compressed += await this.mergeSimilar(store);
        }
        // 3. Purge decayed, very low importance memories
        compressed += await this.purgeDecayed(store);
        return compressed;
    }
    // ─── Decay Step ────────────────────────────────────
    async decayOldMemories(store) {
        const cutoff = Date.now() - this.config.maxAgeMs;
        const result = await store.query({
            limit: this.config.batchSize,
            importanceMax: this.config.minImportanceToKeep - 1,
            timeRange: { start: 0, end: cutoff },
            includeDecayed: false,
        });
        let count = 0;
        for (const event of result.events) {
            await store.decay(event.id);
            count++;
        }
        if (count > 0) {
            console.log(`[Compressor] Decayed ${count} old low-importance memories`);
        }
        return count;
    }
    // ─── Merge Step ────────────────────────────────────
    async mergeSimilar(store) {
        // Get recent memories that could be similar
        const recent = await store.getRecent(this.config.batchSize, 1);
        let merges = 0;
        const merged = new Set();
        for (let i = 0; i < recent.length; i++) {
            if (merged.has(recent[i].id))
                continue;
            for (let j = i + 1; j < recent.length; j++) {
                if (merged.has(recent[j].id))
                    continue;
                if (areSimilar(recent[i], recent[j])) {
                    // Merge j into i: update i's summary, decay j
                    const merged_summary = this.mergeSummaries(recent[i], recent[j]);
                    const merged_details = `${recent[i].details}\n(Also: ${recent[j].summary})`;
                    await store.updateSummary(recent[i].id, merged_summary, merged_details);
                    await store.decay(recent[j].id);
                    merged.add(recent[j].id);
                    merges++;
                }
            }
        }
        if (merges > 0) {
            console.log(`[Compressor] Merged ${merges} similar memory pairs`);
        }
        return merges;
    }
    // ─── Purge Step ────────────────────────────────────
    async purgeDecayed(store) {
        // Delete decayed memories older than 24 hours with importance < 2
        const deleted = await store.deleteOld(86400000, 2);
        if (deleted > 0) {
            console.log(`[Compressor] Purged ${deleted} decayed low-importance memories`);
        }
        return deleted;
    }
    // ─── Summary Merging ───────────────────────────────
    mergeSummaries(a, b) {
        // Keep the more important one's summary as primary
        const [primary, secondary] = a.importance >= b.importance ? [a, b] : [b, a];
        // If summaries are very similar, just keep the primary
        if (keywordOverlap(primary.summary, secondary.summary) >= 4) {
            return primary.summary;
        }
        // Otherwise combine
        return `${primary.summary} (Repeated: ${secondary.summary.slice(0, 100)})`;
    }
}
//# sourceMappingURL=compressor.js.map
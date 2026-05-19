/**
 * MemoryCompressor — summarizes old memories, merges similar events,
 * removes low-importance data. Maintains key facts only.
 */
import type { CompressionConfig } from "./types.js";
import type { SQLiteMemoryStore } from "./sqlite-store.js";
export declare class MemoryCompressor {
    private config;
    constructor(config?: Partial<CompressionConfig>);
    /**
     * Run one compression cycle against the store.
     * Returns count of memories compressed.
     */
    compress(store: SQLiteMemoryStore): Promise<number>;
    private decayOldMemories;
    private mergeSimilar;
    private purgeDecayed;
    private mergeSummaries;
}
//# sourceMappingURL=compressor.d.ts.map
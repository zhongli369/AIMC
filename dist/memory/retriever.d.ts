/**
 * MemoryRetriever — hybrid memory retrieval with keyword search
 * and semantic similarity ranking (vector-ready placeholder).
 *
 * Uses Reciprocal Rank Fusion (RRF) style hybrid ranking.
 */
import type { MemoryEvent } from "./types.js";
import type { SQLiteMemoryStore } from "./sqlite-store.js";
import type { MemoryType } from "../interfaces/memory.js";
interface RetrieverConfig {
    /** Weight for keyword relevance (0-1), balance is semantic */
    keywordWeight: number;
    /** Default limit for queries */
    defaultLimit: number;
    /** Max context tokens allowed */
    maxContextTokens: number;
}
export interface RankedMemory {
    event: MemoryEvent;
    /** Combined relevance score 0-1 */
    score: number;
    /** Match method used */
    matchType: "keyword" | "vector" | "hybrid";
}
export interface RetrievalResult {
    memories: RankedMemory[];
    totalSearched: number;
    queryTimeMs: number;
    /** Formatted text for LLM context injection */
    contextText: string;
}
export declare class MemoryRetriever {
    private config;
    constructor(config?: Partial<RetrieverConfig>);
    /**
     * Retrieve relevant memories for LLM context injection.
     *
     * @param store - The SQLite memory store
     * @param queryText - Natural language query (current situation description)
     * @param types - Memory types to include
     * @param currentLocation - Current bot position for spatial relevance
     * @param limit - Max results
     */
    retrieve(params: {
        store: SQLiteMemoryStore;
        queryText?: string;
        types?: MemoryType[];
        currentLocation?: {
            x: number;
            y: number;
            z: number;
            dimension?: string;
        };
        limit?: number;
    }): Promise<RetrievalResult>;
    /**
     * Quick retrieval for urgent situations (low latency path).
     * Skips keyword search, returns top recent + important.
     */
    retrieveUrgent(params: {
        store: SQLiteMemoryStore;
        currentLocation?: {
            x: number;
            y: number;
            z: number;
        };
        limit?: number;
    }): Promise<RetrievalResult>;
    private computeKeywordScore;
    private computeRecencyScore;
    private computeSpatialBoost;
    private extractKeywords;
    private buildContextText;
    private formatAge;
}
export {};
//# sourceMappingURL=retriever.d.ts.map
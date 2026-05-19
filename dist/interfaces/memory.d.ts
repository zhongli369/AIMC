/**
 * Memory system types — structured memory beyond chat logs.
 */
export type MemoryType = "event" | "location" | "relationship" | "skill" | "failure" | "success" | "preference" | "task" | "emotional" | "knowledge";
export interface MemoryEntry {
    id: string;
    type: MemoryType;
    timestamp: number;
    gameTime?: number;
    summary: string;
    details?: string;
    importance: number;
    emotionalValence: number;
    tags: string[];
    relatedEntityIds: string[];
    location?: {
        x: number;
        y: number;
        z: number;
        dimension?: string;
    };
    embedding?: number[];
    decayed: boolean;
    lastAccessedAt: number;
    accessCount: number;
}
export interface RetrievalQuery {
    types?: MemoryType[];
    tags?: string[];
    timeRange?: {
        start: number;
        end: number;
    };
    importanceMin?: number;
    entityIds?: string[];
    location?: {
        near: {
            x: number;
            y: number;
            z: number;
        };
        radius: number;
    };
    semanticQuery?: string;
    limit: number;
}
export interface RetrievalResult {
    entry: MemoryEntry;
    score: number;
    matchType: "keyword" | "vector" | "hybrid";
}
export interface MemoryCandidateInput {
    type: MemoryType;
    summary: string;
    details?: string;
    importance: number;
    emotionalValence?: number;
    tags?: string[];
    relatedEntityIds?: string[];
    location?: {
        x: number;
        y: number;
        z: number;
    };
}
export interface MemoryStats {
    totalEntries: number;
    byType: Record<MemoryType, number>;
    avgImportance: number;
    oldestEntry: number;
    newestEntry: number;
    storageSizeBytes: number;
}
//# sourceMappingURL=memory.d.ts.map
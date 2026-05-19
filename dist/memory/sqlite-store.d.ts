import type { MemoryType } from "../interfaces/memory.js";
import type { MemoryEvent, MemoryCandidate, MemoryQuery, MemoryQueryResult, MemoryStoreStats } from "./types.js";
interface StoreConfig {
    dbPath: string;
    /** Max events to return per query (hard cap) */
    maxQueryLimit: number;
    /** Auto-save after every write */
    autoSave: boolean;
    /** Max in-memory cache entries */
    cacheSize: number;
}
export declare class SQLiteMemoryStore {
    private db;
    private SQL;
    private config;
    private initialized;
    private saveTimer;
    private maintenanceTimer;
    private writeQueue;
    private writePending;
    private cache;
    constructor(config?: Partial<StoreConfig>);
    init(): Promise<void>;
    private startAutoMaintenance;
    private deleteOldSync;
    /** Persist a single memory event. Returns the event with assigned ID. */
    save(event: MemoryCandidate): Promise<MemoryEvent>;
    /** Batch-save multiple candidates. */
    saveBatch(candidates: MemoryCandidate[]): Promise<MemoryEvent[]>;
    /** Query memories with filters. Returns ranked results. */
    query(q: MemoryQuery): Promise<MemoryQueryResult>;
    /** Get recent memories across all types. */
    getRecent(limit?: number, importanceMin?: number): Promise<MemoryEvent[]>;
    /** Get memories by type. */
    queryByType(type: MemoryType, limit?: number): Promise<MemoryEvent[]>;
    /** Get top memories for context injection (high importance, recent). */
    getTopForContext(maxTokens?: number, limit?: number): Promise<MemoryEvent[]>;
    /** Mark a memory as decayed (compressed). */
    decay(id: string): Promise<void>;
    /** Update memory summary (for compression merges). */
    updateSummary(id: string, summary: string, details: string): Promise<void>;
    /** Delete old, low-importance memories. Returns count deleted. */
    deleteOld(olderThanMs: number, minImportanceToKeep?: number): Promise<number>;
    /** Delete a specific memory by ID. */
    deleteById(id: string): Promise<boolean>;
    stats(): Promise<MemoryStoreStats>;
    /** Force-save the database to disk. */
    flush(): void;
    /** Close the database. */
    close(): void;
    private createTables;
    private rowToEvent;
    private touchMemory;
    private countAll;
    private scheduleSave;
    private ensureReady;
    private safeJSONParse;
}
export {};
//# sourceMappingURL=sqlite-store.d.ts.map
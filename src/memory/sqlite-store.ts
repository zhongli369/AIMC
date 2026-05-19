/**
 * SQLiteMemoryStore — persistent memory storage via sql.js.
 *
 * All operations are async (delegated to a sync sql.js which is fast enough
 * that workers aren't necessary for typical query volumes).
 * Queries target <50ms typical.
 */
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { MemoryType } from "../interfaces/memory.js";
import type {
  MemoryEvent,
  MemoryCandidate,
  MemoryQuery,
  MemoryQueryResult,
  MemoryStoreStats,
} from "./types.js";

// ─── Config ──────────────────────────────────────────

interface StoreConfig {
  dbPath: string;
  /** Max events to return per query (hard cap) */
  maxQueryLimit: number;
  /** Auto-save after every write */
  autoSave: boolean;
  /** Max in-memory cache entries */
  cacheSize: number;
}

const DEFAULT_CONFIG: StoreConfig = {
  dbPath: "./bots/memory/aimc-memory.db",
  maxQueryLimit: 50,
  autoSave: true,
  cacheSize: 200,
};

// ─── Store ───────────────────────────────────────────

export class SQLiteMemoryStore {
  private db: Database | null = null;
  private SQL: SqlJsStatic | null = null;
  private config: StoreConfig;
  private initialized = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private writeQueue: Array<() => void> = [];
  private writePending = false;
  private cache: Map<string, MemoryEvent> = new Map();

  constructor(config?: Partial<StoreConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Init ──────────────────────────────────────────

  async init(): Promise<void> {
    if (this.initialized) return;

    this.SQL = await initSqlJs();
    mkdirSync(dirname(this.config.dbPath), { recursive: true });

    if (existsSync(this.config.dbPath)) {
      const buffer = readFileSync(this.config.dbPath);
      this.db = new this.SQL.Database(buffer);
    } else {
      this.db = new this.SQL.Database();
    }

    this.createTables();
    this.initialized = true;
    this.startAutoMaintenance();
    console.log(`[MemoryStore] Initialized — ${this.countAll()} memories at ${this.config.dbPath}`);
  }

  private startAutoMaintenance(): void {
    if (this.maintenanceTimer) return;
    this.maintenanceTimer = setInterval(() => {
      try {
        const deleted = this.deleteOldSync(Date.now() - 7 * 24 * 3600_000, 3);
        if (deleted > 0) console.log(`[MemoryStore] Auto-maintenance: deleted ${deleted} old memories`);
      } catch { /* non-critical */ }
    }, 3600_000); // Every hour
  }

  private deleteOldSync(olderThanMs: number, minImportance: number): number {
    if (!this.db) return 0;
    const cutoff = Date.now() - olderThanMs;
    this.db.run(
      "DELETE FROM memories WHERE timestamp < ? AND importance < ? AND decayed = 1",
      [cutoff, minImportance],
    );
    const deleted = this.db.getRowsModified();
    if (deleted > 0) {
      this.cache.clear();
      this.scheduleSave();
    }
    return deleted;
  }

  // ─── Save ──────────────────────────────────────────

  /** Persist a single memory event. Returns the event with assigned ID. */
  async save(event: MemoryCandidate): Promise<MemoryEvent> {
    this.ensureReady();

    const now = Date.now();
    const memory: MemoryEvent = {
      id: randomUUID(),
      type: event.type,
      timestamp: now,
      summary: event.summary,
      details: event.details || event.summary,
      importance: event.importance,
      emotionalValence: event.emotionalValence ?? 0,
      tags: event.tags || [],
      relatedEntities: event.relatedEntities || [],
      location: event.location ? {
        x: Math.round(event.location.x * 100) / 100,
        y: Math.round(event.location.y * 100) / 100,
        z: Math.round(event.location.z * 100) / 100,
        dimension: event.location.dimension || "overworld",
      } : undefined,
      decayed: false,
      lastAccessedAt: now,
      accessCount: 0,
      source: event.source || "system",
    };

    this.db!.run(
      `INSERT INTO memories (id, type, timestamp, summary, details, importance,
       emotional_valence, tags, related_entities, location_x, location_y, location_z,
       location_dim, decayed, last_accessed, access_count, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        memory.id,
        memory.type,
        memory.timestamp,
        memory.summary,
        memory.details,
        memory.importance,
        memory.emotionalValence,
        JSON.stringify(memory.tags),
        JSON.stringify(memory.relatedEntities),
        memory.location?.x ?? null,
        memory.location?.y ?? null,
        memory.location?.z ?? null,
        memory.location?.dimension ?? null,
        memory.decayed ? 1 : 0,
        memory.lastAccessedAt,
        memory.accessCount,
        memory.source,
      ],
    );

    // Update cache
    this.cache.set(memory.id, memory);
    if (this.cache.size > this.config.cacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    if (this.config.autoSave) {
      this.scheduleSave();
    }

    return memory;
  }

  /** Batch-save multiple candidates. */
  async saveBatch(candidates: MemoryCandidate[]): Promise<MemoryEvent[]> {
    const results: MemoryEvent[] = [];
    for (const c of candidates) {
      results.push(await this.save(c));
    }
    return results;
  }

  // ─── Query ─────────────────────────────────────────

  /** Query memories with filters. Returns ranked results. */
  async query(q: MemoryQuery): Promise<MemoryQueryResult> {
    this.ensureReady();

    const startTime = Date.now();
    const limit = Math.min(q.limit, this.config.maxQueryLimit);
    const conditions: string[] = [];
    const params: any[] = [];

    // Type filter
    if (q.types && q.types.length > 0) {
      conditions.push(`type IN (${q.types.map(() => "?").join(",")})`);
      params.push(...q.types);
    }

    // Tag filter (OR match)
    if (q.tags && q.tags.length > 0) {
      const tagConditions = q.tags.map(() => `tags LIKE ?`).join(" OR ");
      conditions.push(`(${tagConditions})`);
      params.push(...q.tags.map((t) => `%${t}%`));
    }

    // Time range
    if (q.timeRange) {
      conditions.push("timestamp >= ? AND timestamp <= ?");
      params.push(q.timeRange.start, q.timeRange.end);
    }

    // Importance
    if (q.importanceMin !== undefined) {
      conditions.push("importance >= ?");
      params.push(q.importanceMin);
    }
    if (q.importanceMax !== undefined) {
      conditions.push("importance <= ?");
      params.push(q.importanceMax);
    }

    // Entity filter
    if (q.entities && q.entities.length > 0) {
      const entityConditions = q.entities.map(() => `related_entities LIKE ?`).join(" OR ");
      conditions.push(`(${entityConditions})`);
      params.push(...q.entities.map((e) => `%${e}%`));
    }

    // Spatial proximity
    if (q.location) {
      const { near, radius } = q.location;
      conditions.push(
        `location_x IS NOT NULL AND
         ABS(location_x - ?) <= ? AND
         ABS(location_y - ?) <= ? AND
         ABS(location_z - ?) <= ?`,
      );
      params.push(near.x, radius, near.y, radius, near.z, radius);
    }

    // Keyword search
    if (q.keywordSearch) {
      const kw = q.keywordSearch;
      conditions.push("(summary LIKE ? OR details LIKE ? OR tags LIKE ?)");
      params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`);
    }

    // Decay filter
    if (!q.includeDecayed) {
      conditions.push("decayed = 0");
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const offset = q.offset || 0;

    // Query with relevance scoring: importance-weighted, recency-boosted
    const sql = `
      SELECT *, (importance * 0.6 + MIN(1.0, 86400000.0 / MAX(1, ? - timestamp)) * 0.4) as relevance
      FROM memories
      ${whereClause}
      ORDER BY relevance DESC, timestamp DESC
      LIMIT ? OFFSET ?
    `;
    params.unshift(Date.now()); // For recency calculation
    params.push(limit, offset);

    const stmt = this.db!.prepare(sql);
    stmt.bind(params);

    const events: MemoryEvent[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      events.push(this.rowToEvent(row as any));
      // Update access metadata
      this.touchMemory((row as any).id);
    }
    stmt.free();

    // Count total (without limit)
    const countSql = `SELECT COUNT(*) as cnt FROM memories ${whereClause}`;
    const countStmt = this.db!.prepare(countSql);
    countStmt.bind(params.slice(1, -2)); // Remove Date.now, limit, offset
    let totalFound = 0;
    if (countStmt.step()) {
      totalFound = (countStmt.getAsObject() as any).cnt;
    }
    countStmt.free();

    return {
      events,
      totalFound,
      queryTimeMs: Date.now() - startTime,
    };
  }

  // ─── Convenience Queries ───────────────────────────

  /** Get recent memories across all types. */
  async getRecent(limit: number = 20, importanceMin: number = 1): Promise<MemoryEvent[]> {
    const result = await this.query({
      limit,
      importanceMin,
      timeRange: { start: Date.now() - 86400000, end: Date.now() },
    });
    return result.events;
  }

  /** Get memories by type. */
  async queryByType(type: MemoryType, limit: number = 20): Promise<MemoryEvent[]> {
    const result = await this.query({ types: [type], limit });
    return result.events;
  }

  /** Get top memories for context injection (high importance, recent). */
  async getTopForContext(maxTokens: number = 500, limit: number = 8): Promise<MemoryEvent[]> {
    // Prioritize: high importance + recent + not decayed
    const result = await this.query({
      limit,
      importanceMin: 3,
      includeDecayed: false,
    });

    // Token-aware truncation: estimate ~4 chars per token
    const maxChars = maxTokens * 4;
    let totalChars = 0;
    const filtered: MemoryEvent[] = [];

    for (const event of result.events) {
      const charCount = event.summary.length + (event.details?.length || 0);
      if (totalChars + charCount > maxChars) break;
      totalChars += charCount;
      filtered.push(event);
    }

    return filtered;
  }

  // ─── Update ────────────────────────────────────────

  /** Mark a memory as decayed (compressed). */
  async decay(id: string): Promise<void> {
    this.ensureReady();
    this.db!.run("UPDATE memories SET decayed = 1 WHERE id = ?", [id]);
    const cached = this.cache.get(id);
    if (cached) cached.decayed = true;
    this.scheduleSave();
  }

  /** Update memory summary (for compression merges). */
  async updateSummary(id: string, summary: string, details: string): Promise<void> {
    this.ensureReady();
    this.db!.run(
      "UPDATE memories SET summary = ?, details = ?, last_accessed = ? WHERE id = ?",
      [summary, details, Date.now(), id],
    );
    const cached = this.cache.get(id);
    if (cached) {
      cached.summary = summary;
      cached.details = details;
    }
    this.scheduleSave();
  }

  // ─── Delete ────────────────────────────────────────

  /** Delete old, low-importance memories. Returns count deleted. */
  async deleteOld(olderThanMs: number, minImportanceToKeep: number = 4): Promise<number> {
    this.ensureReady();
    const cutoff = Date.now() - olderThanMs;
    this.db!.run(
      "DELETE FROM memories WHERE timestamp < ? AND importance < ? AND decayed = 1",
      [cutoff, minImportanceToKeep],
    );
    const deleted = this.db!.getRowsModified();
    this.scheduleSave();
    this.cache.clear();
    return deleted;
  }

  /** Delete a specific memory by ID. */
  async deleteById(id: string): Promise<boolean> {
    this.ensureReady();
    this.db!.run("DELETE FROM memories WHERE id = ?", [id]);
    const deleted = this.db!.getRowsModified();
    this.cache.delete(id);
    this.scheduleSave();
    return deleted > 0;
  }

  // ─── Stats ─────────────────────────────────────────

  async stats(): Promise<MemoryStoreStats> {
    this.ensureReady();

    const total = this.countAll();
    const decayed = (this.db!.exec("SELECT COUNT(*) as c FROM memories WHERE decayed = 1")[0]
      ?.values[0]?.[0] as number) || 0;

    const typeRows = this.db!.exec(
      "SELECT type, COUNT(*) as c FROM memories GROUP BY type",
    );
    const byType: Record<string, number> = {};
    if (typeRows[0]) {
      for (const row of typeRows[0].values) {
        byType[row[0] as string] = row[1] as number;
      }
    }

    const avgRow = this.db!.exec("SELECT AVG(importance) as avg FROM memories");
    const avgImportance = (avgRow[0]?.values[0]?.[0] as number) || 0;

    const oldestRow = this.db!.exec("SELECT MIN(timestamp) as ts FROM memories");
    const newestRow = this.db!.exec("SELECT MAX(timestamp) as ts FROM memories");

    return {
      totalEntries: total,
      byType,
      avgImportance: Math.round(avgImportance * 100) / 100,
      oldestTimestamp: (oldestRow[0]?.values[0]?.[0] as number) || 0,
      newestTimestamp: (newestRow[0]?.values[0]?.[0] as number) || 0,
      storageSizeBytes: existsSync(this.config.dbPath)
        ? statSync(this.config.dbPath).size
        : 0,
      decayedCount: decayed,
    };
  }

  // ─── Persistence ───────────────────────────────────

  /** Force-save the database to disk. */
  flush(): void {
    if (!this.db) return;
    const data = this.db.export();
    const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    mkdirSync(dirname(this.config.dbPath), { recursive: true });
    writeFileSync(this.config.dbPath, buffer);
  }

  /** Close the database. */
  close(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.maintenanceTimer) { clearInterval(this.maintenanceTimer); this.maintenanceTimer = null; }
    this.flush();
    this.db?.close();
    this.db = null;
    this.initialized = false;
    this.cache.clear();
  }

  // ─── Internals ─────────────────────────────────────

  private createTables(): void {
    this.db!.run(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        summary TEXT NOT NULL,
        details TEXT,
        importance REAL NOT NULL DEFAULT 5,
        emotional_valence REAL DEFAULT 0,
        tags TEXT DEFAULT '[]',
        related_entities TEXT DEFAULT '[]',
        location_x REAL,
        location_y REAL,
        location_z REAL,
        location_dim TEXT,
        decayed INTEGER DEFAULT 0,
        last_accessed INTEGER,
        access_count INTEGER DEFAULT 0,
        source TEXT DEFAULT 'system'
      )
    `);

    // Indexes for fast querying
    this.db!.run(`
      CREATE INDEX IF NOT EXISTS idx_type ON memories(type)
    `);
    this.db!.run(`
      CREATE INDEX IF NOT EXISTS idx_timestamp ON memories(timestamp)
    `);
    this.db!.run(`
      CREATE INDEX IF NOT EXISTS idx_importance ON memories(importance)
    `);
    this.db!.run(`
      CREATE INDEX IF NOT EXISTS idx_decayed ON memories(decayed)
    `);
    this.db!.run(`
      CREATE INDEX IF NOT EXISTS idx_type_time ON memories(type, timestamp)
    `);
  }

  private rowToEvent(row: Record<string, any>): MemoryEvent {
    return {
      id: row.id,
      type: row.type as MemoryType,
      timestamp: row.timestamp,
      summary: row.summary,
      details: row.details || row.summary,
      importance: row.importance,
      emotionalValence: row.emotional_valence || 0,
      tags: this.safeJSONParse(row.tags, []),
      relatedEntities: this.safeJSONParse(row.related_entities, []),
      location: row.location_x != null ? {
        x: row.location_x,
        y: row.location_y,
        z: row.location_z,
        dimension: row.location_dim || "overworld",
      } : undefined,
      decayed: row.decayed === 1,
      lastAccessedAt: row.last_accessed || row.timestamp,
      accessCount: row.access_count || 0,
      source: row.source || "system",
    };
  }

  private touchMemory(id: string): void {
    this.db!.run(
      "UPDATE memories SET last_accessed = ?, access_count = access_count + 1 WHERE id = ?",
      [Date.now(), id],
    );
  }

  private countAll(): number {
    if (!this.db) return 0;
    const result = this.db.exec("SELECT COUNT(*) as c FROM memories");
    return (result[0]?.values[0]?.[0] as number) || 0;
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 1000);
  }

  private ensureReady(): void {
    if (!this.initialized || !this.db) {
      throw new Error("SQLiteMemoryStore not initialized — call init() first");
    }
  }

  private safeJSONParse(str: string, fallback: any): any {
    try {
      return JSON.parse(str);
    } catch {
      return fallback;
    }
  }
}

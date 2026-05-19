/**
 * SQLiteMemoryStore — persistent memory storage via sql.js.
 *
 * All operations are async (delegated to a sync sql.js which is fast enough
 * that workers aren't necessary for typical query volumes).
 * Queries target <50ms typical.
 */
import initSqlJs from "sql.js";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
const DEFAULT_CONFIG = {
    dbPath: "./bots/memory/aimc-memory.db",
    maxQueryLimit: 50,
    autoSave: true,
    cacheSize: 200,
};
// ─── Store ───────────────────────────────────────────
export class SQLiteMemoryStore {
    db = null;
    SQL = null;
    config;
    initialized = false;
    saveTimer = null;
    maintenanceTimer = null;
    writeQueue = [];
    writePending = false;
    cache = new Map();
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    // ─── Init ──────────────────────────────────────────
    async init() {
        if (this.initialized)
            return;
        this.SQL = await initSqlJs();
        mkdirSync(dirname(this.config.dbPath), { recursive: true });
        if (existsSync(this.config.dbPath)) {
            const buffer = readFileSync(this.config.dbPath);
            this.db = new this.SQL.Database(buffer);
        }
        else {
            this.db = new this.SQL.Database();
        }
        this.createTables();
        this.initialized = true;
        this.startAutoMaintenance();
        console.log(`[MemoryStore] Initialized — ${this.countAll()} memories at ${this.config.dbPath}`);
    }
    startAutoMaintenance() {
        if (this.maintenanceTimer)
            return;
        this.maintenanceTimer = setInterval(() => {
            try {
                const deleted = this.deleteOldSync(Date.now() - 7 * 24 * 3600_000, 3);
                if (deleted > 0)
                    console.log(`[MemoryStore] Auto-maintenance: deleted ${deleted} old memories`);
            }
            catch { /* non-critical */ }
        }, 3600_000); // Every hour
    }
    deleteOldSync(olderThanMs, minImportance) {
        if (!this.db)
            return 0;
        const cutoff = Date.now() - olderThanMs;
        this.db.run("DELETE FROM memories WHERE timestamp < ? AND importance < ? AND decayed = 1", [cutoff, minImportance]);
        const deleted = this.db.getRowsModified();
        if (deleted > 0) {
            this.cache.clear();
            this.scheduleSave();
        }
        return deleted;
    }
    // ─── Save ──────────────────────────────────────────
    /** Persist a single memory event. Returns the event with assigned ID. */
    async save(event) {
        this.ensureReady();
        const now = Date.now();
        const memory = {
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
        this.db.run(`INSERT INTO memories (id, type, timestamp, summary, details, importance,
       emotional_valence, tags, related_entities, location_x, location_y, location_z,
       location_dim, decayed, last_accessed, access_count, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
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
        ]);
        // Update cache
        this.cache.set(memory.id, memory);
        if (this.cache.size > this.config.cacheSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey)
                this.cache.delete(firstKey);
        }
        if (this.config.autoSave) {
            this.scheduleSave();
        }
        return memory;
    }
    /** Batch-save multiple candidates. */
    async saveBatch(candidates) {
        const results = [];
        for (const c of candidates) {
            results.push(await this.save(c));
        }
        return results;
    }
    // ─── Query ─────────────────────────────────────────
    /** Query memories with filters. Returns ranked results. */
    async query(q) {
        this.ensureReady();
        const startTime = Date.now();
        const limit = Math.min(q.limit, this.config.maxQueryLimit);
        const conditions = [];
        const params = [];
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
            conditions.push(`location_x IS NOT NULL AND
         ABS(location_x - ?) <= ? AND
         ABS(location_y - ?) <= ? AND
         ABS(location_z - ?) <= ?`);
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
        const stmt = this.db.prepare(sql);
        stmt.bind(params);
        const events = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            events.push(this.rowToEvent(row));
            // Update access metadata
            this.touchMemory(row.id);
        }
        stmt.free();
        // Count total (without limit)
        const countSql = `SELECT COUNT(*) as cnt FROM memories ${whereClause}`;
        const countStmt = this.db.prepare(countSql);
        countStmt.bind(params.slice(1, -2)); // Remove Date.now, limit, offset
        let totalFound = 0;
        if (countStmt.step()) {
            totalFound = countStmt.getAsObject().cnt;
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
    async getRecent(limit = 20, importanceMin = 1) {
        const result = await this.query({
            limit,
            importanceMin,
            timeRange: { start: Date.now() - 86400000, end: Date.now() },
        });
        return result.events;
    }
    /** Get memories by type. */
    async queryByType(type, limit = 20) {
        const result = await this.query({ types: [type], limit });
        return result.events;
    }
    /** Get top memories for context injection (high importance, recent). */
    async getTopForContext(maxTokens = 500, limit = 8) {
        // Prioritize: high importance + recent + not decayed
        const result = await this.query({
            limit,
            importanceMin: 3,
            includeDecayed: false,
        });
        // Token-aware truncation: estimate ~4 chars per token
        const maxChars = maxTokens * 4;
        let totalChars = 0;
        const filtered = [];
        for (const event of result.events) {
            const charCount = event.summary.length + (event.details?.length || 0);
            if (totalChars + charCount > maxChars)
                break;
            totalChars += charCount;
            filtered.push(event);
        }
        return filtered;
    }
    // ─── Update ────────────────────────────────────────
    /** Mark a memory as decayed (compressed). */
    async decay(id) {
        this.ensureReady();
        this.db.run("UPDATE memories SET decayed = 1 WHERE id = ?", [id]);
        const cached = this.cache.get(id);
        if (cached)
            cached.decayed = true;
        this.scheduleSave();
    }
    /** Update memory summary (for compression merges). */
    async updateSummary(id, summary, details) {
        this.ensureReady();
        this.db.run("UPDATE memories SET summary = ?, details = ?, last_accessed = ? WHERE id = ?", [summary, details, Date.now(), id]);
        const cached = this.cache.get(id);
        if (cached) {
            cached.summary = summary;
            cached.details = details;
        }
        this.scheduleSave();
    }
    // ─── Delete ────────────────────────────────────────
    /** Delete old, low-importance memories. Returns count deleted. */
    async deleteOld(olderThanMs, minImportanceToKeep = 4) {
        this.ensureReady();
        const cutoff = Date.now() - olderThanMs;
        this.db.run("DELETE FROM memories WHERE timestamp < ? AND importance < ? AND decayed = 1", [cutoff, minImportanceToKeep]);
        const deleted = this.db.getRowsModified();
        this.scheduleSave();
        this.cache.clear();
        return deleted;
    }
    /** Delete a specific memory by ID. */
    async deleteById(id) {
        this.ensureReady();
        this.db.run("DELETE FROM memories WHERE id = ?", [id]);
        const deleted = this.db.getRowsModified();
        this.cache.delete(id);
        this.scheduleSave();
        return deleted > 0;
    }
    // ─── Stats ─────────────────────────────────────────
    async stats() {
        this.ensureReady();
        const total = this.countAll();
        const decayed = this.db.exec("SELECT COUNT(*) as c FROM memories WHERE decayed = 1")[0]
            ?.values[0]?.[0] || 0;
        const typeRows = this.db.exec("SELECT type, COUNT(*) as c FROM memories GROUP BY type");
        const byType = {};
        if (typeRows[0]) {
            for (const row of typeRows[0].values) {
                byType[row[0]] = row[1];
            }
        }
        const avgRow = this.db.exec("SELECT AVG(importance) as avg FROM memories");
        const avgImportance = avgRow[0]?.values[0]?.[0] || 0;
        const oldestRow = this.db.exec("SELECT MIN(timestamp) as ts FROM memories");
        const newestRow = this.db.exec("SELECT MAX(timestamp) as ts FROM memories");
        return {
            totalEntries: total,
            byType,
            avgImportance: Math.round(avgImportance * 100) / 100,
            oldestTimestamp: oldestRow[0]?.values[0]?.[0] || 0,
            newestTimestamp: newestRow[0]?.values[0]?.[0] || 0,
            storageSizeBytes: existsSync(this.config.dbPath)
                ? statSync(this.config.dbPath).size
                : 0,
            decayedCount: decayed,
        };
    }
    // ─── Persistence ───────────────────────────────────
    /** Force-save the database to disk. */
    flush() {
        if (!this.db)
            return;
        const data = this.db.export();
        const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        mkdirSync(dirname(this.config.dbPath), { recursive: true });
        writeFileSync(this.config.dbPath, buffer);
    }
    /** Close the database. */
    close() {
        if (this.saveTimer)
            clearTimeout(this.saveTimer);
        if (this.maintenanceTimer) {
            clearInterval(this.maintenanceTimer);
            this.maintenanceTimer = null;
        }
        this.flush();
        this.db?.close();
        this.db = null;
        this.initialized = false;
        this.cache.clear();
    }
    // ─── Internals ─────────────────────────────────────
    createTables() {
        this.db.run(`
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
        this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_type ON memories(type)
    `);
        this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_timestamp ON memories(timestamp)
    `);
        this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_importance ON memories(importance)
    `);
        this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_decayed ON memories(decayed)
    `);
        this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_type_time ON memories(type, timestamp)
    `);
    }
    rowToEvent(row) {
        return {
            id: row.id,
            type: row.type,
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
    touchMemory(id) {
        this.db.run("UPDATE memories SET last_accessed = ?, access_count = access_count + 1 WHERE id = ?", [Date.now(), id]);
    }
    countAll() {
        if (!this.db)
            return 0;
        const result = this.db.exec("SELECT COUNT(*) as c FROM memories");
        return result[0]?.values[0]?.[0] || 0;
    }
    scheduleSave() {
        if (this.saveTimer)
            clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.flush(), 1000);
    }
    ensureReady() {
        if (!this.initialized || !this.db) {
            throw new Error("SQLiteMemoryStore not initialized — call init() first");
        }
    }
    safeJSONParse(str, fallback) {
        try {
            return JSON.parse(str);
        }
        catch {
            return fallback;
        }
    }
}
//# sourceMappingURL=sqlite-store.js.map
const DEFAULT_RETRIEVER_CONFIG = {
    keywordWeight: 0.7,
    defaultLimit: 8,
    maxContextTokens: 500,
};
// ─── Retriever ───────────────────────────────────────
export class MemoryRetriever {
    config;
    constructor(config) {
        this.config = { ...DEFAULT_RETRIEVER_CONFIG, ...config };
    }
    /**
     * Retrieve relevant memories for LLM context injection.
     *
     * @param store - The SQLite memory store
     * @param queryText - Natural language query (current situation description)
     * @param types - Memory types to include
     * @param currentLocation - Current bot position for spatial relevance
     * @param limit - Max results
     */
    async retrieve(params) {
        const startTime = Date.now();
        const { store, queryText, types, currentLocation, limit } = params;
        const actualLimit = limit || this.config.defaultLimit;
        const ranked = [];
        // ═══ Strategy 1: Keyword search (primary) ═══
        if (queryText) {
            const keywords = this.extractKeywords(queryText);
            const keywordResults = await store.query({
                keywordSearch: keywords.join(" OR "),
                types,
                limit: actualLimit * 2, // Over-fetch for ranking
                includeDecayed: false,
            });
            for (const event of keywordResults.events) {
                const keywordScore = this.computeKeywordScore(event, queryText, keywords);
                ranked.push({
                    event,
                    score: keywordScore * this.config.keywordWeight,
                    matchType: "keyword",
                });
            }
        }
        // ═══ Strategy 2: Recency + importance (fallback/boost) ═══
        const recentResults = await store.getTopForContext(this.config.maxContextTokens, actualLimit);
        for (const event of recentResults) {
            // Skip if already included from keyword search
            if (ranked.some((r) => r.event.id === event.id))
                continue;
            const recencyScore = this.computeRecencyScore(event);
            ranked.push({
                event,
                score: recencyScore * (1 - this.config.keywordWeight),
                matchType: "keyword",
            });
        }
        // ═══ Strategy 3: Spatial proximity boost ═══
        if (currentLocation) {
            for (const entry of ranked) {
                if (entry.event.location) {
                    const spatialBoost = this.computeSpatialBoost(entry.event.location, currentLocation);
                    entry.score += spatialBoost * 0.15; // Up to +0.15 boost
                }
            }
        }
        // Sort by score descending, deduplicate
        const seen = new Set();
        const deduped = ranked
            .filter((r) => {
            if (seen.has(r.event.id))
                return false;
            seen.add(r.event.id);
            return true;
        })
            .sort((a, b) => b.score - a.score)
            .slice(0, actualLimit);
        // Build context text for LLM injection
        const contextText = this.buildContextText(deduped);
        return {
            memories: deduped,
            totalSearched: ranked.length,
            queryTimeMs: Date.now() - startTime,
            contextText,
        };
    }
    /**
     * Quick retrieval for urgent situations (low latency path).
     * Skips keyword search, returns top recent + important.
     */
    async retrieveUrgent(params) {
        const startTime = Date.now();
        const { store, currentLocation } = params;
        const limit = params.limit || 5;
        // Only use recency + importance (fast path, no text processing)
        const events = await store.getTopForContext(300, limit);
        const ranked = events.map((event) => ({
            event,
            score: this.computeRecencyScore(event),
            matchType: "keyword",
        }));
        // Spatial boost
        if (currentLocation) {
            for (const entry of ranked) {
                if (entry.event.location) {
                    entry.score += this.computeSpatialBoost(entry.event.location, currentLocation) * 0.1;
                }
            }
        }
        ranked.sort((a, b) => b.score - a.score);
        return {
            memories: ranked.slice(0, limit),
            totalSearched: events.length,
            queryTimeMs: Date.now() - startTime,
            contextText: this.buildContextText(ranked.slice(0, limit)),
        };
    }
    // ─── Scoring ────────────────────────────────────────
    computeKeywordScore(event, query, keywords) {
        const text = `${event.summary} ${event.details} ${event.tags.join(" ")}`.toLowerCase();
        const queryLower = query.toLowerCase();
        let score = 0;
        // Direct keyword matches
        for (const kw of keywords) {
            if (text.includes(kw))
                score += 0.2;
        }
        // Full query substring match
        if (text.includes(queryLower))
            score += 0.3;
        // Tag exact matches
        for (const tag of event.tags) {
            if (keywords.some((kw) => tag.toLowerCase().includes(kw))) {
                score += 0.15;
            }
        }
        // Importance boost
        score += (event.importance / 10) * 0.2;
        // Recency boost (within last hour)
        const ageMs = Date.now() - event.timestamp;
        if (ageMs < 3600_000)
            score += 0.15;
        else if (ageMs < 86400000)
            score += 0.05;
        return Math.min(1.0, score);
    }
    computeRecencyScore(event) {
        let score = (event.importance / 10) * 0.6;
        // Recency: exponential decay, half-life ~1 hour
        const hoursAgo = (Date.now() - event.timestamp) / 3600_000;
        score += Math.exp(-hoursAgo) * 0.4;
        return Math.min(1.0, score);
    }
    computeSpatialBoost(loc, current) {
        const dx = loc.x - current.x;
        const dy = loc.y - current.y;
        const dz = loc.z - current.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        // Full boost within 16 blocks, linear decay to 0 at 256 blocks
        if (distance < 16)
            return 1.0;
        if (distance > 256)
            return 0;
        return 1.0 - (distance - 16) / (256 - 16);
    }
    // ─── Keyword Extraction ────────────────────────────
    extractKeywords(text) {
        // Simple extraction: lowercase, split, filter stopwords, dedupe
        const stopwords = new Set([
            "the", "a", "an", "is", "was", "were", "be", "been", "being",
            "have", "has", "had", "do", "does", "did", "will", "would",
            "could", "should", "may", "might", "can", "shall", "to", "of",
            "in", "for", "on", "with", "at", "by", "from", "as", "into",
            "through", "during", "before", "after", "above", "below",
            "between", "and", "but", "or", "nor", "not", "so", "yet",
            "both", "either", "neither", "each", "every", "all", "any",
            "few", "more", "most", "other", "some", "such", "only", "own",
            "same", "this", "that", "these", "those", "it", "its",
            "i", "me", "my", "we", "our", "you", "your", "he", "she",
            "him", "her", "they", "them", "what", "which", "who",
            "just", "about", "very", "really", "then", "now", "here",
        ]);
        const words = text.toLowerCase()
            .replace(/[^a-z0-9\s]/g, "")
            .split(/\s+/)
            .filter((w) => w.length > 2 && !stopwords.has(w));
        // Return unique keywords
        return [...new Set(words)].slice(0, 10);
    }
    // ─── Context Text Builder ──────────────────────────
    buildContextText(ranked) {
        if (ranked.length === 0)
            return "";
        const lines = ranked.map((r) => {
            const loc = r.event.location
                ? ` @(${r.event.location.x.toFixed(0)},${r.event.location.y.toFixed(0)},${r.event.location.z.toFixed(0)})`
                : "";
            const age = this.formatAge(Date.now() - r.event.timestamp);
            return `- [${r.event.type}] ${r.event.summary}${loc} (${age}, importance:${r.event.importance})`;
        });
        return lines.join("\n");
    }
    formatAge(ms) {
        const seconds = Math.floor(ms / 1000);
        if (seconds < 60)
            return `${seconds}s ago`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60)
            return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24)
            return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    }
}
//# sourceMappingURL=retriever.js.map
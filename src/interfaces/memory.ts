/**
 * Memory system types — structured memory beyond chat logs.
 */

// ─── Memory Types ────────────────────────────────────────────

export type MemoryType =
  | "event"
  | "location"
  | "relationship"
  | "skill"
  | "failure"
  | "success"
  | "preference"
  | "task"
  | "emotional"
  | "knowledge";

// ─── Memory Entry ────────────────────────────────────────────

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  timestamp: number; // Unix ms
  gameTime?: number; // In-game tick
  summary: string; // 1-2 sentence summary
  details?: string; // Full description
  importance: number; // 1-10
  emotionalValence: number; // -1.0 to 1.0
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

// ─── Memory Retrieval ────────────────────────────────────────

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
    near: { x: number; y: number; z: number };
    radius: number;
  };
  semanticQuery?: string;
  limit: number;
}

export interface RetrievalResult {
  entry: MemoryEntry;
  score: number; // 0-1 relevance
  matchType: "keyword" | "vector" | "hybrid";
}

// ─── Memory Candidate (from LLM) ─────────────────────────────

export interface MemoryCandidateInput {
  type: MemoryType;
  summary: string;
  details?: string;
  importance: number;
  emotionalValence?: number;
  tags?: string[];
  relatedEntityIds?: string[];
  location?: { x: number; y: number; z: number };
}

// ─── Memory Stats ────────────────────────────────────────────

export interface MemoryStats {
  totalEntries: number;
  byType: Record<MemoryType, number>;
  avgImportance: number;
  oldestEntry: number;
  newestEntry: number;
  storageSizeBytes: number;
}

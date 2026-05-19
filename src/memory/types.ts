/**
 * Memory data model — structured memory beyond chat logs.
 *
 * Memory types:
 *   event    — what happened (damage, death, chat, discovery)
 *   location — world coordinates of interest
 *   entity   — player/mob interactions
 *   task     — unfinished goals, work in progress
 *   behavior — player behavior patterns
 *   emotional — high-valence moments (death, triumph)
 *   knowledge — learned facts about the world
 */
import type { MemoryType } from "../interfaces/memory.js";

// ─── Memory Event (Stored Entity) ────────────────────

export interface MemoryEvent {
  id: string;
  type: MemoryType;
  /** Unix ms timestamp */
  timestamp: number;
  /** In-game tick (optional) */
  gameTime?: number;
  /** 1-2 sentence summary */
  summary: string;
  /** Full description */
  details: string;
  /** Importance score 1-10 */
  importance: number;
  /** -1.0 (negative) to 1.0 (positive) */
  emotionalValence: number;
  /** Searchable tags */
  tags: string[];
  /** Related entity names/IDs */
  relatedEntities: string[];
  /** Spatial context */
  location?: {
    x: number;
    y: number;
    z: number;
    dimension: string;
  };
  /** Whether this memory has been compressed */
  decayed: boolean;
  /** Last time this memory was retrieved */
  lastAccessedAt: number;
  /** How many times retrieved */
  accessCount: number;
  /** Optional embedding vector (Phase 5.5 vector search) */
  embedding?: number[];
  /** Source of the memory */
  source: "event" | "llm" | "system" | "compression";
}

// ─── Memory Candidate (input from LLM or system) ──────

export interface MemoryCandidate {
  type: MemoryType;
  summary: string;
  details?: string;
  importance: number; // 1-10
  emotionalValence?: number;
  tags?: string[];
  relatedEntities?: string[];
  location?: { x: number; y: number; z: number; dimension?: string };
  source?: MemoryEvent["source"];
}

// ─── Memory Query ─────────────────────────────────────

export interface MemoryQuery {
  types?: MemoryType[];
  tags?: string[];
  timeRange?: { start: number; end: number };
  importanceMin?: number;
  importanceMax?: number;
  entities?: string[];
  location?: { near: { x: number; y: number; z: number }; radius: number };
  keywordSearch?: string;
  limit: number;
  offset?: number;
  includeDecayed?: boolean;
}

// ─── Memory Query Result ──────────────────────────────

export interface MemoryQueryResult {
  events: MemoryEvent[];
  totalFound: number;
  queryTimeMs: number;
}

// ─── Memory Stats ─────────────────────────────────────

export interface MemoryStoreStats {
  totalEntries: number;
  byType: Record<string, number>;
  avgImportance: number;
  oldestTimestamp: number;
  newestTimestamp: number;
  storageSizeBytes: number;
  decayedCount: number;
}

// ─── Memory Compressor Config ─────────────────────────

export interface CompressionConfig {
  /** Max age (ms) before compression is considered */
  maxAgeMs: number;
  /** Min importance to preserve uncompressed */
  minImportanceToKeep: number;
  /** Max number of uncompressed memories to keep */
  maxUncompressed: number;
  /** Whether to merge similar memories */
  mergeSimilar: boolean;
  /** Max memories to compress per cycle */
  batchSize: number;
}

// ─── Re-export from interfaces ────────────────────────

export type { MemoryType } from "../interfaces/memory.js";

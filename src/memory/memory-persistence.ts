/**
 * MemoryPersistence — JSON-based persistence for Phase 4-E memory layers (Phase 4-E).
 *
 * Handles: relationship-state.json + shared-experience.json
 *
 * Features:
 *   - Atomic writes (temp file → rename)
 *   - Schema versioning with migration support
 *   - Corruption fallback (returns defaults)
 *   - Auto-save intervals
 *   - Bounded file size warnings
 *
 * MUST NOT:
 *   - Block execution on save/load
 *   - Create new execution paths
 *   - Access Mineflayer or bot state
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { RelationshipState } from "./relationship-state.js";
import { createRelationshipState } from "./relationship-state.js";
import type { SharedExperience } from "./shared-experience.js";

// ─── Config ────────────────────────────────────────────

export interface PersistenceConfig {
  /** Directory for JSON persistence files */
  dataDir: string;
  /** Current schema version (incremented on breaking changes) */
  schemaVersion: number;
  /** Max file size in bytes before warning (default 5MB) */
  maxFileSizeBytes: number;
}

const DEFAULT_PERSISTENCE_CONFIG: PersistenceConfig = {
  dataDir: "./aimc_data",
  schemaVersion: 1,
  maxFileSizeBytes: 5 * 1024 * 1024,
};

// ─── File Names ────────────────────────────────────────

const RELATIONSHIP_FILE = "relationship-state.json";
const EXPERIENCE_FILE = "shared-experience.json";

// ─── Atomic Write ──────────────────────────────────────

function atomicWrite(filePath: string, data: unknown): void {
  const tmpPath = filePath + ".tmp";

  // Ensure directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const json = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmpPath, json, "utf-8");

  // Atomic rename
  try {
    fs.renameSync(tmpPath, filePath);
  } catch {
    // On Windows, rename can fail if target exists — delete first
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    fs.renameSync(tmpPath, filePath);
  }
}

function safeRead<T>(filePath: string, fallback: () => T): { data: T; loaded: boolean } {
  try {
    if (!fs.existsSync(filePath)) {
      return { data: fallback(), loaded: false };
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    if (!raw.trim()) {
      console.warn(`[MemoryPersistence] Empty file: ${filePath} — using fallback`);
      return { data: fallback(), loaded: false };
    }

    const parsed = JSON.parse(raw);
    return { data: parsed as T, loaded: true };
  } catch (err) {
    console.warn(`[MemoryPersistence] Corrupt file: ${filePath} — ${(err as Error).message}. Using fallback.`);
    // Rename corrupt file to .corrupt for debugging
    try {
      const corruptPath = filePath + `.corrupt.${Date.now()}`;
      if (fs.existsSync(filePath)) {
        fs.renameSync(filePath, corruptPath);
      }
    } catch {
      // Best effort
    }
    return { data: fallback(), loaded: false };
  }
}

function checkFileSize(filePath: string, maxBytes: number): void {
  try {
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.size > maxBytes) {
        console.warn(
          `[MemoryPersistence] WARNING: ${path.basename(filePath)} is ${(stat.size / 1024 / 1024).toFixed(1)}MB (max recommended: ${(maxBytes / 1024 / 1024).toFixed(0)}MB)`,
        );
      }
    }
  } catch {
    // Ignore — non-critical
  }
}

// ─── Relationship Persistence ──────────────────────────

export function saveRelationshipState(
  state: RelationshipState,
  config: Partial<PersistenceConfig> = {},
): void {
  const cfg = { ...DEFAULT_PERSISTENCE_CONFIG, ...config };
  const filePath = path.join(cfg.dataDir, RELATIONSHIP_FILE);

  try {
    const wrapper = {
      schemaVersion: cfg.schemaVersion,
      savedAt: Date.now(),
      data: state,
    };
    atomicWrite(filePath, wrapper);
    checkFileSize(filePath, cfg.maxFileSizeBytes);
  } catch (err) {
    console.warn("[MemoryPersistence] Failed to save relationship state:", (err as Error).message);
  }
}

export function loadRelationshipState(
  config: Partial<PersistenceConfig> = {},
): { state: RelationshipState; loaded: boolean } {
  const cfg = { ...DEFAULT_PERSISTENCE_CONFIG, ...config };
  const filePath = path.join(cfg.dataDir, RELATIONSHIP_FILE);

  const result = safeRead<{ schemaVersion: number; data: RelationshipState }>(filePath, () => ({
    schemaVersion: cfg.schemaVersion,
    data: createRelationshipState(),
  }));

  let state = result.data.data;

  // Schema migration: v1 → current
  if (result.loaded && result.data.schemaVersion < cfg.schemaVersion) {
    state = migrateRelationship(result.data.data, result.data.schemaVersion, cfg.schemaVersion);
    console.log(
      `[MemoryPersistence] Migrated relationship state: v${result.data.schemaVersion} → v${cfg.schemaVersion}`,
    );
  }

  // Validate state structure
  if (!state || typeof state.familiarityLevel !== "number") {
    console.warn("[MemoryPersistence] Invalid relationship state structure — using default");
    return { state: createRelationshipState(), loaded: false };
  }

  // Ensure all fields exist (forward compatibility)
  const defaults = createRelationshipState();
  for (const key of Object.keys(defaults) as (keyof RelationshipState)[]) {
    if (!(key in state)) {
      (state as unknown as Record<string, unknown>)[key] = defaults[key];
    }
  }

  return { state, loaded: result.loaded };
}

// ─── Shared Experience Persistence ─────────────────────

export function saveSharedExperiences(
  experiences: SharedExperience[],
  config: Partial<PersistenceConfig> = {},
): void {
  const cfg = { ...DEFAULT_PERSISTENCE_CONFIG, ...config };
  const filePath = path.join(cfg.dataDir, EXPERIENCE_FILE);

  try {
    const wrapper = {
      schemaVersion: cfg.schemaVersion,
      savedAt: Date.now(),
      count: experiences.length,
      data: experiences,
    };
    atomicWrite(filePath, wrapper);
    checkFileSize(filePath, cfg.maxFileSizeBytes);
  } catch (err) {
    console.warn("[MemoryPersistence] Failed to save shared experiences:", (err as Error).message);
  }
}

export function loadSharedExperiences(
  config: Partial<PersistenceConfig> = {},
): { experiences: SharedExperience[]; loaded: boolean } {
  const cfg = { ...DEFAULT_PERSISTENCE_CONFIG, ...config };
  const filePath = path.join(cfg.dataDir, EXPERIENCE_FILE);

  const result = safeRead<{ schemaVersion: number; data: SharedExperience[] }>(filePath, () => ({
    schemaVersion: cfg.schemaVersion,
    data: [],
  }));

  const experiences = result.data.data;

  if (!Array.isArray(experiences)) {
    console.warn("[MemoryPersistence] Invalid shared experiences structure — using empty array");
    return { experiences: [], loaded: false };
  }

  return { experiences, loaded: result.loaded };
}

// ─── Auto-Save ─────────────────────────────────────────

export interface AutoSaveHandle {
  stop: () => void;
  saveNow: () => void;
}

export function createMemoryAutoSave(params: {
  getRelationshipState: () => RelationshipState;
  getExperiences: () => SharedExperience[];
  config?: Partial<PersistenceConfig>;
  intervalMs?: number;
}): AutoSaveHandle {
  const cfg = { ...DEFAULT_PERSISTENCE_CONFIG, ...params.config };
  const intervalMs = params.intervalMs ?? 60_000;

  const saveNow = () => {
    try {
      saveRelationshipState(params.getRelationshipState(), cfg);
      saveSharedExperiences(params.getExperiences(), cfg);
    } catch {
      // Silently ignore save errors
    }
  };

  // Save immediately
  saveNow();

  const timer = setInterval(saveNow, intervalMs);

  return {
    stop: () => clearInterval(timer),
    saveNow,
  };
}

// ─── Schema Migration ──────────────────────────────────

function migrateRelationship(
  state: RelationshipState,
  fromVersion: number,
  toVersion: number,
): RelationshipState {
  let migrated = { ...state };

  // v1 → v2: add future fields here when needed
  // if (fromVersion < 2) {
  //   migrated.newField = defaultValue;
  // }

  migrated.schemaVersion = toVersion;
  return migrated;
}

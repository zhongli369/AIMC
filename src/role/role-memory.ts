/**
 * RoleMemory — lightweight JSON persistence for role identity.
 *
 * Saves/Loads CompanionIdentity to/from a JSON file.
 * Safe fallback defaults if file is missing or corrupt.
 *
 * NO database dependency. Designed for single-bot use.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { CompanionIdentity, CompanionRole } from "./role-identity.js";
import { createIdentity } from "./role-identity.js";

// ─── Config ──────────────────────────────────────────

const DEFAULT_FILENAME = "aimc_role_identity.json";

export interface RoleMemoryConfig {
  /** Directory to store role data */
  dataDir: string;
  /** Filename for the identity JSON */
  filename?: string;
}

// ─── Save ────────────────────────────────────────────

/**
 * Persist companion identity to a JSON file.
 * Creates the data directory if it doesn't exist.
 */
export function saveIdentity(
  identity: CompanionIdentity,
  config: RoleMemoryConfig,
): void {
  try {
    const dir = config.dataDir;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const filePath = path.join(dir, config.filename ?? DEFAULT_FILENAME);

    // Write to temp file first, then rename (atomic write)
    const tmpPath = filePath + ".tmp";
    const json = JSON.stringify(identity, null, 2);
    fs.writeFileSync(tmpPath, json, "utf-8");
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.warn("[RoleMemory] Failed to save identity:", (err as Error).message);
  }
}

// ─── Load ────────────────────────────────────────────

/**
 * Load companion identity from a JSON file.
 * Returns a default identity if file is missing, corrupt, or has invalid data.
 */
export function loadIdentity(
  config: RoleMemoryConfig,
  fallbackRole: CompanionRole = "balanced",
): CompanionIdentity {
  try {
    const filePath = path.join(config.dataDir, config.filename ?? DEFAULT_FILENAME);

    if (!fs.existsSync(filePath)) {
      console.log("[RoleMemory] No saved identity found — using default");
      return createIdentity(fallbackRole);
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<CompanionIdentity>;

    // Validate required fields
    if (!parsed.currentRole || !parsed.confidence || !parsed.roleHistory) {
      console.warn("[RoleMemory] Corrupt identity file — using default");
      return createIdentity(fallbackRole);
    }

    // Validate role value
    const validRoles: CompanionRole[] = ["miner", "fighter", "scout", "support", "balanced"];
    if (!validRoles.includes(parsed.currentRole)) {
      console.warn(`[RoleMemory] Invalid role "${parsed.currentRole}" — using default`);
      return createIdentity(fallbackRole);
    }

    // Ensure all fields exist with defaults for missing ones
    const identity: CompanionIdentity = {
      currentRole: parsed.currentRole,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.3,
      roleHistory: Array.isArray(parsed.roleHistory) ? parsed.roleHistory : [],
      dominantTraits: Array.isArray(parsed.dominantTraits) ? parsed.dominantTraits : [],
      createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : Date.now(),
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    };

    console.log(
      `[RoleMemory] Loaded identity: ${identity.currentRole} (confidence: ${(identity.confidence * 100).toFixed(0)}%, ${identity.roleHistory.length} history entries)`,
    );
    return identity;
  } catch (err) {
    console.warn("[RoleMemory] Failed to load identity:", (err as Error).message);
    return createIdentity(fallbackRole);
  }
}

// ─── Auto-Save ───────────────────────────────────────

/**
 * Create an auto-save wrapper that periodically persists identity.
 * Returns a cleanup function to stop auto-save.
 */
export function createAutoSave(
  getIdentity: () => CompanionIdentity,
  config: RoleMemoryConfig,
  intervalMs: number = 60_000, // Every 60 seconds
): () => void {
  const timer = setInterval(() => {
    try {
      saveIdentity(getIdentity(), config);
    } catch {
      // Silently ignore — don't spam on save failure
    }
  }, intervalMs);

  // Save immediately on creation
  try {
    saveIdentity(getIdentity(), config);
  } catch {
    // Ignore
  }

  return () => clearInterval(timer);
}

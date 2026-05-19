/**
 * RoleMemory — lightweight JSON persistence for role identity.
 *
 * Saves/Loads CompanionIdentity to/from a JSON file.
 * Safe fallback defaults if file is missing or corrupt.
 *
 * NO database dependency. Designed for single-bot use.
 */
import type { CompanionIdentity, CompanionRole } from "./role-identity.js";
export interface RoleMemoryConfig {
    /** Directory to store role data */
    dataDir: string;
    /** Filename for the identity JSON */
    filename?: string;
}
/**
 * Persist companion identity to a JSON file.
 * Creates the data directory if it doesn't exist.
 */
export declare function saveIdentity(identity: CompanionIdentity, config: RoleMemoryConfig): void;
/**
 * Load companion identity from a JSON file.
 * Returns a default identity if file is missing, corrupt, or has invalid data.
 */
export declare function loadIdentity(config: RoleMemoryConfig, fallbackRole?: CompanionRole): CompanionIdentity;
/**
 * Create an auto-save wrapper that periodically persists identity.
 * Returns a cleanup function to stop auto-save.
 */
export declare function createAutoSave(getIdentity: () => CompanionIdentity, config: RoleMemoryConfig, intervalMs?: number): () => void;
//# sourceMappingURL=role-memory.d.ts.map
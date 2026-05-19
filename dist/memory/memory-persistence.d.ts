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
import type { RelationshipState } from "./relationship-state.js";
import type { SharedExperience } from "./shared-experience.js";
export interface PersistenceConfig {
    /** Directory for JSON persistence files */
    dataDir: string;
    /** Current schema version (incremented on breaking changes) */
    schemaVersion: number;
    /** Max file size in bytes before warning (default 5MB) */
    maxFileSizeBytes: number;
}
export declare function saveRelationshipState(state: RelationshipState, config?: Partial<PersistenceConfig>): void;
export declare function loadRelationshipState(config?: Partial<PersistenceConfig>): {
    state: RelationshipState;
    loaded: boolean;
};
export declare function saveSharedExperiences(experiences: SharedExperience[], config?: Partial<PersistenceConfig>): void;
export declare function loadSharedExperiences(config?: Partial<PersistenceConfig>): {
    experiences: SharedExperience[];
    loaded: boolean;
};
export interface AutoSaveHandle {
    stop: () => void;
    saveNow: () => void;
}
export declare function createMemoryAutoSave(params: {
    getRelationshipState: () => RelationshipState;
    getExperiences: () => SharedExperience[];
    config?: Partial<PersistenceConfig>;
    intervalMs?: number;
}): AutoSaveHandle;
//# sourceMappingURL=memory-persistence.d.ts.map
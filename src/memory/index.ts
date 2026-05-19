export { SQLiteMemoryStore } from "./sqlite-store.js";
export { ImportanceEngine, scoreImportance } from "./importance.js";
export { MemoryCompressor } from "./compressor.js";
export { MemoryRetriever } from "./retriever.js";

// Phase 4-E: Relationship & Shared Experience
export {
  RelationshipEngine,
  createRelationshipState,
} from "./relationship-state.js";
export type {
  RelationshipState,
  RelationshipSnapshot,
  RelationshipConfig,
} from "./relationship-state.js";

export {
  SharedExperienceTimeline,
} from "./shared-experience.js";
export type {
  SharedExperience,
  ExperienceCategory,
  ExperienceConfig,
} from "./shared-experience.js";

export { MemoryCallbackGenerator } from "./memory-callbacks.js";

export {
  saveRelationshipState,
  loadRelationshipState,
  saveSharedExperiences,
  loadSharedExperiences,
  createMemoryAutoSave,
} from "./memory-persistence.js";
export type {
  PersistenceConfig,
  AutoSaveHandle,
} from "./memory-persistence.js";

export type {
  MemoryEvent,
  MemoryCandidate,
  MemoryQuery,
  MemoryQueryResult,
  MemoryStoreStats,
  CompressionConfig,
  MemoryType,
} from "./types.js";

export type { RankedMemory, RetrievalResult } from "./retriever.js";

/**
 * Role System — companion role specialization & identity layer (Phase 4-D).
 *
 * SOFT influence layer only. Does NOT:
 *   - Modify execution chain
 *   - Bypass SkillRouter or ActionDispatcher
 *   - Create new AI decision paths
 *   - Access Mineflayer directly
 */

export {
  ROLE_PROFILES,
  ALL_ROLES,
  createIdentity,
  getRoleProfile,
  getRoleSkillWeight,
} from "./role-identity.js";
export type {
  CompanionRole,
  RoleProfile,
  CompanionIdentity,
  RoleHistoryEntry,
  BehaviorTrait,
} from "./role-identity.js";

export { RoleAdaptationEngine } from "./role-adaptation.js";
export type { AdaptationConfig } from "./role-adaptation.js";

export {
  saveIdentity,
  loadIdentity,
  createAutoSave,
} from "./role-memory.js";
export type { RoleMemoryConfig } from "./role-memory.js";

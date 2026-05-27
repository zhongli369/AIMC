/**
 * Minecraft/Mineflayer abstraction types.
 */

import type { Bot } from "mineflayer";

// ─── Plugin-augmented Bot type ───────────────────────────────
// Mineflayer plugins extend Bot.prototype at runtime; the stock
// Bot type does not include them, so we widen the reference here.

export interface BotRef extends Omit<Bot, "pathfinder"> {
  pathfinder: {
    goto: (goal: unknown) => Promise<void>;
    stop: () => void;
    setMovements: (movements: unknown) => void;
    setGoal: (goal: unknown, dynamic?: boolean) => void;
  };
  pvp: {
    attack: (entity: unknown) => void;
    stop: () => void;
  };
  collectBlock: {
    collect: (block: unknown) => Promise<void>;
    cancelTask: () => void;
  };
  armorManager: {
    equipAll: () => Promise<void>;
  };
  autoEat: {
    enable: () => void;
    disable: () => void;
  };
  nearestEntities: (predicate?: (entity: unknown) => boolean) => unknown[];
}

// ─── Bot State ───────────────────────────────────────────────

export type BotLifecycleState =
  | "init"
  | "connecting"
  | "logging_in"
  | "spawning"
  | "ready"
  | "active"
  | "idle"
  | "disconnected"
  | "error"
  | "killed";

export interface BotState {
  lifecycle: BotLifecycleState;
  health: number;
  food: number;
  saturation: number;
  position: Vec3Data;
  velocity: Vec3Data;
  yaw: number;
  pitch: number;
  onGround: boolean;
  isInWater: boolean;
  biome: string;
  dimension: string;
  timeOfDay: string;
  weather: string;
  heldItem: ItemData | null;
  gameMode: string;
  experience: { points: number; level: number };
}

// ─── Vector3 ─────────────────────────────────────────────────

export interface Vec3Data {
  x: number;
  y: number;
  z: number;
}

// ─── Item ────────────────────────────────────────────────────

export interface ItemData {
  name: string;
  displayName: string;
  count: number;
  slot: number;
  durability?: number;
  maxDurability?: number;
}

// ─── Entity ──────────────────────────────────────────────────

export interface EntityData {
  name: string;
  type: string;
  position: Vec3Data;
  distance: number;
  health?: number;
  hostile: boolean;
}

// ─── Player Info ─────────────────────────────────────────────

export interface PlayerInfo {
  username: string;
  uuid: string;
  ping: number;
  gamemode?: string;
  position?: Vec3Data;
}

// ─── Block Info ──────────────────────────────────────────────

export interface BlockInfo {
  name: string;
  displayName: string;
  position: Vec3Data;
  hardness: number;
  toolRequired?: string;
  boundingBox: "block" | "empty";
}

// ─── Container Info ──────────────────────────────────────────

export interface ContainerInfo {
  type: "chest" | "furnace" | "barrel" | "shulker" | "ender_chest";
  position: Vec3Data;
  slots: ItemData[];
  emptySlots: number;
  totalSlots: number;
}

// ─── Crafting Recipe ─────────────────────────────────────────

export interface CraftingRecipe {
  itemName: string;
  displayName: string;
  ingredients: { name: string; count: number }[];
  craftingTableRequired: boolean;
}

// ─── Re-exports ──────────────────────────────────────────────

export type { Bot } from "mineflayer";

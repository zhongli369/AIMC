/**
 * AIMC Configuration System — runtime-tunable parameters (Phase 0.5).
 *
 * Single global config instance. Loads config/aimc.config.json at startup,
 * caches in memory. No reload system — keep it simple.
 *
 * PURE CONFIGURATION — NO behavior change, NO new execution paths.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Config Shape ──────────────────────────────────────────

export interface StabilityConfigFile {
  stuckThresholdMs: number;
  loopActionWindowMs: number;
  loopActionCount: number;
  loopCooldownMs: number;
  skillFailureThreshold: number;
  skillDisableMs: number;
  safeModeMinDurationMs: number;
  safeModeAutoExitMs: number;
  safeModeReentryCooldownMs: number;
}

export interface BehaviorConfigFile {
  enableSafeMode: boolean;
  allowCombatInSafeMode: boolean;
  preferExploreInSafeMode: boolean;
}

export interface VoiceConfigFile {
  /** Master voice switch — default off. Set AIMC_VOICE_ENABLED=1 to enable. */
  voiceEnabled: boolean;
  /** Path to whisper.cpp binary (optional, probe on startup) */
  whisperPath?: string;
  /** Path to whisper model file (optional) */
  whisperModelPath?: string;
  /** Edge TTS voice name */
  ttsVoice?: string;
  pressureSensitivity: number;
  enableVoiceTimingBias: boolean;
}

export interface ArbitrationConfigFile {
  voiceWeightMultiplier: number;
  memoryWeightMultiplier: number;
  relationshipProtectionEnabled: boolean;
}

export interface AimcConfig {
  stability: StabilityConfigFile;
  behavior: BehaviorConfigFile;
  fallback: Record<string, string>;
  voice: VoiceConfigFile;
  arbitration: ArbitrationConfigFile;
}

// ─── Defaults (used if config file is missing) ──────────────

const DEFAULTS: AimcConfig = {
  stability: {
    stuckThresholdMs: 8000,
    loopActionWindowMs: 5000,
    loopActionCount: 3,
    loopCooldownMs: 3000,
    skillFailureThreshold: 3,
    skillDisableMs: 7000,
    safeModeMinDurationMs: 10000,
    safeModeAutoExitMs: 15000,
    safeModeReentryCooldownMs: 30000,
  },
  behavior: {
    enableSafeMode: true,
    allowCombatInSafeMode: false,
    preferExploreInSafeMode: true,
  },
  fallback: {
    mine_resource: "explore_area",
    attack_target: "defend_player",
    gather_food: "collect_items",
    follow_player: "explore_area",
    build_shelter: "explore_area",
    collect_items: "explore_area",
    explore_area: "wait",
    defend_player: "follow_player",
  },
  voice: {
    voiceEnabled: false,
    pressureSensitivity: 1.0,
    enableVoiceTimingBias: true,
  },
  arbitration: {
    voiceWeightMultiplier: 1.5,
    memoryWeightMultiplier: 1.2,
    relationshipProtectionEnabled: true,
  },
};

// ─── Singleton ──────────────────────────────────────────────

let _config: AimcConfig | null = null;
let _configLoadError: string | null = null;

function resolveConfigPath(): string {
  // In dev: config/aimc.config.json relative to project root
  // In production (packaged): resources/app.asar has config at same relative path
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    // Walk up from src/config/ to project root
    return resolve(__dirname, "..", "..", "config", "aimc.config.json");
  } catch {
    return resolve(process.cwd(), "config", "aimc.config.json");
  }
}

/**
 * Load config from disk. Called once at startup.
 * On failure, falls back to DEFAULTS silently (system must stay operational).
 */
export function loadConfig(configPath?: string): AimcConfig {
  if (_config !== null) return _config;

  const path = configPath || resolveConfigPath();
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AimcConfig>;
    _config = deepMerge(DEFAULTS, parsed);
    _configLoadError = null;

    // Config load telemetry
    const hash = simpleHash(JSON.stringify(_config));
    console.log(`AIMC_CONFIG_LOADED:${JSON.stringify({ path, hash, success: true })}`);

    return _config;
  } catch (err) {
    _config = { ...DEFAULTS };
    _configLoadError = (err as Error).message;

    console.log(`AIMC_CONFIG_LOADED:${JSON.stringify({
      path,
      success: false,
      error: _configLoadError,
      fallback: "defaults",
    })}`);

    return _config;
  }
}

/** Get the full config (must call loadConfig() first). */
export function getConfig(): AimcConfig {
  return _config ?? DEFAULTS;
}

// ─── Sub-config Accessors ───────────────────────────────────

export function getStabilityConfig(): StabilityConfigFile {
  return getConfig().stability;
}

export function getBehaviorConfig(): BehaviorConfigFile {
  return getConfig().behavior;
}

export function getFallbackMap(): Record<string, string> {
  return getConfig().fallback;
}

/** Get fallback skill for a given skill name. Returns "explore_area" if not found. */
export function getFallbackSkill(skillName: string): string {
  return getConfig().fallback[skillName] ?? "explore_area";
}

export function getVoiceConfig(): VoiceConfigFile {
  return getConfig().voice;
}

/** Master voice switch — config file AND env var must agree. */
export function isVoiceEnabled(): boolean {
  return getConfig().voice.voiceEnabled || process.env.AIMC_VOICE_ENABLED === "1";
}

export function getVoicePressureSensitivity(): number {
  return getConfig().voice.pressureSensitivity;
}

export function isVoiceTimingEnabled(): boolean {
  return getConfig().voice.enableVoiceTimingBias;
}

export function getArbitrationConfig(): ArbitrationConfigFile {
  return getConfig().arbitration;
}

export function isSafeModeEnabled(): boolean {
  return getConfig().behavior.enableSafeMode;
}

export function isCombatAllowedInSafeMode(): boolean {
  return getConfig().behavior.allowCombatInSafeMode;
}

export function preferExploreInSafeMode(): boolean {
  return getConfig().behavior.preferExploreInSafeMode;
}

/** Get any config load error. Returns null if load succeeded. */
export function getConfigLoadError(): string | null {
  return _configLoadError;
}

/** Reload config (useful for runtime tuning without restart). */
export function reloadConfig(configPath?: string): AimcConfig {
  _config = null;
  _configLoadError = null;
  return loadConfig(configPath);
}

// ─── Helpers ────────────────────────────────────────────────

function deepMerge(base: AimcConfig, override: Partial<AimcConfig>): AimcConfig {
  const result = { ...base };
  for (const key of Object.keys(override) as (keyof AimcConfig)[]) {
    const ov = override[key];
    const bv = base[key];
    if (ov && typeof ov === "object" && !Array.isArray(ov) && bv && typeof bv === "object" && !Array.isArray(bv)) {
      result[key] = { ...bv, ...ov } as never;
    } else if (ov !== undefined) {
      result[key] = ov as never;
    }
  }
  return result;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + c;
    hash |= 0;
  }
  return hash.toString(16);
}

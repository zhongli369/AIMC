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
// ─── Defaults (used if config file is missing) ──────────────
const DEFAULTS = {
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
let _config = null;
let _configLoadError = null;
function resolveConfigPath() {
    // In dev: config/aimc.config.json relative to project root
    // In production (packaged): resources/app.asar has config at same relative path
    try {
        const __dirname = dirname(fileURLToPath(import.meta.url));
        // Walk up from src/config/ to project root
        return resolve(__dirname, "..", "..", "config", "aimc.config.json");
    }
    catch {
        return resolve(process.cwd(), "config", "aimc.config.json");
    }
}
/**
 * Load config from disk. Called once at startup.
 * On failure, falls back to DEFAULTS silently (system must stay operational).
 */
export function loadConfig(configPath) {
    if (_config !== null)
        return _config;
    const path = configPath || resolveConfigPath();
    try {
        const raw = readFileSync(path, "utf-8");
        const parsed = JSON.parse(raw);
        _config = deepMerge(DEFAULTS, parsed);
        _configLoadError = null;
        // Config load telemetry
        const hash = simpleHash(JSON.stringify(_config));
        console.log(`AIMC_CONFIG_LOADED:${JSON.stringify({ path, hash, success: true })}`);
        return _config;
    }
    catch (err) {
        _config = { ...DEFAULTS };
        _configLoadError = err.message;
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
export function getConfig() {
    return _config ?? DEFAULTS;
}
// ─── Sub-config Accessors ───────────────────────────────────
export function getStabilityConfig() {
    return getConfig().stability;
}
export function getBehaviorConfig() {
    return getConfig().behavior;
}
export function getFallbackMap() {
    return getConfig().fallback;
}
/** Get fallback skill for a given skill name. Returns "explore_area" if not found. */
export function getFallbackSkill(skillName) {
    return getConfig().fallback[skillName] ?? "explore_area";
}
export function getVoiceConfig() {
    return getConfig().voice;
}
export function getVoicePressureSensitivity() {
    return getConfig().voice.pressureSensitivity;
}
export function isVoiceTimingEnabled() {
    return getConfig().voice.enableVoiceTimingBias;
}
export function getArbitrationConfig() {
    return getConfig().arbitration;
}
export function isSafeModeEnabled() {
    return getConfig().behavior.enableSafeMode;
}
export function isCombatAllowedInSafeMode() {
    return getConfig().behavior.allowCombatInSafeMode;
}
export function preferExploreInSafeMode() {
    return getConfig().behavior.preferExploreInSafeMode;
}
/** Get any config load error. Returns null if load succeeded. */
export function getConfigLoadError() {
    return _configLoadError;
}
/** Reload config (useful for runtime tuning without restart). */
export function reloadConfig(configPath) {
    _config = null;
    _configLoadError = null;
    return loadConfig(configPath);
}
// ─── Helpers ────────────────────────────────────────────────
function deepMerge(base, override) {
    const result = { ...base };
    for (const key of Object.keys(override)) {
        const ov = override[key];
        const bv = base[key];
        if (ov && typeof ov === "object" && !Array.isArray(ov) && bv && typeof bv === "object" && !Array.isArray(bv)) {
            result[key] = { ...bv, ...ov };
        }
        else if (ov !== undefined) {
            result[key] = ov;
        }
    }
    return result;
}
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + c;
        hash |= 0;
    }
    return hash.toString(16);
}
//# sourceMappingURL=aimc-config.js.map
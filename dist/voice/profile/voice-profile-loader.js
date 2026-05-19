/**
 * VoiceProfileLoader — reads voice-profile.json and supplies per-role TTS settings.
 *
 * Used by TextToSpeechAdapter to adjust pitch/rate/volume/pacing based on
 * the AI companion's current role.
 *
 * PURE CONFIGURATION — NO execution, NO behavior change, NO architecture impact.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// ─── Singleton ──────────────────────────────────────────
let _config = null;
let _loadError = null;
function resolveProfilePath() {
    try {
        const __dirname = dirname(fileURLToPath(import.meta.url));
        // Walk from src/voice/profile/ up to project root, then into electron/renderer/ui/
        return resolve(__dirname, "..", "..", "..", "electron", "renderer", "ui", "voice-profile.json");
    }
    catch {
        return resolve(process.cwd(), "electron", "renderer", "ui", "voice-profile.json");
    }
}
// ─── Defaults (falls back if file missing/corrupt) ──────
const DEFAULT_PROFILE = {
    role: "balanced",
    voiceStyle: "versatile",
    tts: { pitch: "+0Hz", rate: "+0%", volume: "+0%", style: "general" },
    narrationPacing: 1.0,
    pauseBetweenUtterancesMs: 180,
};
function buildDefaults() {
    return {
        version: "1.0.0",
        description: "Default voice profiles (file not found)",
        defaultProfile: "balanced",
        profiles: {
            miner: { ...DEFAULT_PROFILE, role: "miner", voiceStyle: "practical", narrationPacing: 1.0, pauseBetweenUtterancesMs: 200 },
            fighter: { ...DEFAULT_PROFILE, role: "fighter", voiceStyle: "direct", tts: { ...DEFAULT_PROFILE.tts, pitch: "+2Hz", rate: "+15%", volume: "+10%" }, narrationPacing: 0.8, pauseBetweenUtterancesMs: 100 },
            scout: { ...DEFAULT_PROFILE, role: "scout", voiceStyle: "curious", tts: { ...DEFAULT_PROFILE.tts, pitch: "+5Hz", rate: "+5%" }, narrationPacing: 1.1, pauseBetweenUtterancesMs: 250 },
            support: { ...DEFAULT_PROFILE, role: "support", voiceStyle: "calm", tts: { ...DEFAULT_PROFILE.tts, pitch: "-3Hz", rate: "-5%" }, narrationPacing: 0.9, pauseBetweenUtterancesMs: 150 },
            balanced: { ...DEFAULT_PROFILE },
        },
    };
}
// ─── Load ───────────────────────────────────────────────
export function loadVoiceProfiles(configPath) {
    if (_config !== null)
        return _config;
    const path = configPath || resolveProfilePath();
    try {
        const raw = readFileSync(path, "utf-8");
        const parsed = JSON.parse(raw);
        // Validate structure
        if (!parsed.profiles || typeof parsed.profiles !== "object") {
            throw new Error("Missing 'profiles' key in voice-profile.json");
        }
        _config = {
            version: parsed.version || "1.0.0",
            description: parsed.description || "",
            defaultProfile: parsed.defaultProfile || "balanced",
            profiles: mergeWithDefaults(parsed.profiles),
        };
        _loadError = null;
    }
    catch (err) {
        _config = buildDefaults();
        _loadError = err.message;
    }
    return _config;
}
function mergeWithDefaults(raw) {
    const defaults = buildDefaults().profiles;
    const result = { ...defaults };
    for (const [key, val] of Object.entries(raw)) {
        if (defaults[key]) {
            result[key] = {
                ...defaults[key],
                ...val,
                tts: { ...defaults[key].tts, ...(val.tts || {}) },
            };
        }
    }
    return result;
}
// ─── Accessors ──────────────────────────────────────────
export function getVoiceProfileConfig() {
    return _config ?? buildDefaults();
}
export function getVoiceProfile(role) {
    const config = getVoiceProfileConfig();
    return config.profiles[role] || config.profiles[config.defaultProfile] || DEFAULT_PROFILE;
}
export function getDefaultVoiceProfile() {
    const config = getVoiceProfileConfig();
    return config.profiles[config.defaultProfile] || DEFAULT_PROFILE;
}
export function getVoiceProfileLoadError() {
    return _loadError;
}
export function reloadVoiceProfiles(configPath) {
    _config = null;
    _loadError = null;
    return loadVoiceProfiles(configPath);
}
//# sourceMappingURL=voice-profile-loader.js.map
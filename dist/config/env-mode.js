/**
 * AIMC Environment Mode (P2)
 *
 * Detects dev vs prod runtime environment.
 * Used for conditional logging, path resolution behavior, and diagnostics.
 *
 * Values:
 *   "dev"  — local development (npm run dev / electron .)
 *   "prod" — packaged build (AIMC Launcher.exe / DMG / AppImage)
 *
 * Auto-detection:
 *   - Explicit: process.env.AIMC_MODE = "dev" | "prod"
 *   - Fallback: checks process.resourcesPath (Electron packaged) or asar path
 *   - Default: "dev"
 *
 * PURE CONFIGURATION — NO execution impact, NO behavior change.
 */
let _detectedMode = null;
function detectMode() {
    // Explicit override takes priority
    const envMode = process.env.AIMC_MODE;
    if (envMode === "dev" || envMode === "prod")
        return envMode;
    // Detect Electron packaged mode
    try {
        // In packaged Electron, process.resourcesPath is set by Electron
        const resourcesPath = process.resourcesPath;
        if (resourcesPath)
            return "prod";
        // Check if running from asar
        const mainFile = process.mainModule?.filename || "";
        if (mainFile.includes(".asar"))
            return "prod";
        // Check argv for electron path hints
        const execPath = process.execPath.toLowerCase();
        if (execPath.includes("aimc launcher") || execPath.includes("aimc_launcher"))
            return "prod";
    }
    catch {
        // Ignore — fall through to default
    }
    return "dev";
}
export function getMode() {
    if (_detectedMode === null) {
        _detectedMode = detectMode();
    }
    return _detectedMode;
}
export function isDev() {
    return getMode() === "dev";
}
export function isProd() {
    return getMode() === "prod";
}
/** One-line mode label for log output. */
export function modeLabel() {
    return isProd() ? "PROD" : "DEV";
}
/** Resolve the mode (call once at startup to cache). */
export function initEnvMode() {
    _detectedMode = null;
    const mode = getMode();
    console.log(`AIMC_MODE: ${mode.toUpperCase()} — ${isProd() ? "packaged build" : "development"}`);
    return mode;
}
//# sourceMappingURL=env-mode.js.map
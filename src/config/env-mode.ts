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

export type AimcMode = "dev" | "prod";

let _detectedMode: AimcMode | null = null;

function detectMode(): AimcMode {
  // Explicit override takes priority
  const envMode = process.env.AIMC_MODE;
  if (envMode === "dev" || envMode === "prod") return envMode;

  // Detect Electron packaged mode
  try {
    // In packaged Electron, process.resourcesPath is set by Electron
    const resourcesPath = (process as any).resourcesPath;
    if (resourcesPath) return "prod";

    // Check if running from asar
    const mainFile = (process as any).mainModule?.filename || "";
    if (mainFile.includes(".asar")) return "prod";

    // Check argv for electron path hints
    const execPath = process.execPath.toLowerCase();
    if (execPath.includes("aimc launcher") || execPath.includes("aimc_launcher")) return "prod";
  } catch {
    // Ignore — fall through to default
  }

  return "dev";
}

export function getMode(): AimcMode {
  if (_detectedMode === null) {
    _detectedMode = detectMode();
  }
  return _detectedMode;
}

export function isDev(): boolean {
  return getMode() === "dev";
}

export function isProd(): boolean {
  return getMode() === "prod";
}

/** One-line mode label for log output. */
export function modeLabel(): string {
  return isProd() ? "PROD" : "DEV";
}

/** Resolve the mode (call once at startup to cache). */
export function initEnvMode(): AimcMode {
  _detectedMode = null;
  const mode = getMode();
  console.log(`AIMC_MODE: ${mode.toUpperCase()} — ${isProd() ? "packaged build" : "development"}`);
  return mode;
}

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
export declare function getMode(): AimcMode;
export declare function isDev(): boolean;
export declare function isProd(): boolean;
/** One-line mode label for log output. */
export declare function modeLabel(): string;
/** Resolve the mode (call once at startup to cache). */
export declare function initEnvMode(): AimcMode;
//# sourceMappingURL=env-mode.d.ts.map
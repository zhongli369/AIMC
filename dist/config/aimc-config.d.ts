/**
 * AIMC Configuration System — runtime-tunable parameters (Phase 0.5).
 *
 * Single global config instance. Loads config/aimc.config.json at startup,
 * caches in memory. No reload system — keep it simple.
 *
 * PURE CONFIGURATION — NO behavior change, NO new execution paths.
 */
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
/**
 * Load config from disk. Called once at startup.
 * On failure, falls back to DEFAULTS silently (system must stay operational).
 */
export declare function loadConfig(configPath?: string): AimcConfig;
/** Get the full config (must call loadConfig() first). */
export declare function getConfig(): AimcConfig;
export declare function getStabilityConfig(): StabilityConfigFile;
export declare function getBehaviorConfig(): BehaviorConfigFile;
export declare function getFallbackMap(): Record<string, string>;
/** Get fallback skill for a given skill name. Returns "explore_area" if not found. */
export declare function getFallbackSkill(skillName: string): string;
export declare function getVoiceConfig(): VoiceConfigFile;
export declare function getVoicePressureSensitivity(): number;
export declare function isVoiceTimingEnabled(): boolean;
export declare function getArbitrationConfig(): ArbitrationConfigFile;
export declare function isSafeModeEnabled(): boolean;
export declare function isCombatAllowedInSafeMode(): boolean;
export declare function preferExploreInSafeMode(): boolean;
/** Get any config load error. Returns null if load succeeded. */
export declare function getConfigLoadError(): string | null;
/** Reload config (useful for runtime tuning without restart). */
export declare function reloadConfig(configPath?: string): AimcConfig;
//# sourceMappingURL=aimc-config.d.ts.map
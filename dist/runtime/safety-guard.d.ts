/**
 * SafetyGuard — pre-execution validation for ALL bot actions.
 * Runs BEFORE any Mineflayer call. Can OVERRIDE LLM intents.
 * LLM outputs are UNTRUSTED INPUT — SafetyGuard is the last line of defense.
 */
import type { IntentAction, ValidationResult } from "../interfaces/intent.js";
import type { BotState } from "../interfaces/minecraft.js";
import type { BotRef } from "../interfaces/minecraft.js";
interface SafetyConfig {
    maxFallDistance: number;
    retreatHealthPercent: number;
    protectedItems: string[];
    maxBuildBlocks: number;
    cooldowns: Partial<Record<string, number>>;
    blockedActions: string[];
    /** Min Y level before void danger triggers (overworld) */
    minSafeY: number;
    /** Max Y delta for safe movement (blocks) */
    maxSafeYDelta: number;
    /** Lava search radius for move safety checks */
    lavaSearchRadius: number;
}
export declare class SafetyGuard {
    private config;
    private bot;
    private emergencyLocked;
    private emergencyReason;
    constructor(config?: Partial<SafetyConfig>);
    setBot(bot: BotRef): void;
    clearBot(): void;
    emergencyStop(reason: string): void;
    clearEmergency(): void;
    isEmergencyLocked(): boolean;
    getEmergencyReason(): string;
    blockAll(reason: string): void;
    unblockAll(): void;
    validate(intent: IntentAction, botState?: BotState): ValidationResult;
    private validateSpam;
    private validatePositionSafety;
    private validateAttack;
    private validateDrop;
    private validateDigDown;
    private validateMine;
    private validatePlace;
    private validateMove;
    private validateFollow;
    private isDangerousAction;
    private isPositionAction;
    recordAction(actionType: string): void;
    getCooldownRemaining(actionType: string): number;
    updateConfig(partial: Partial<SafetyConfig>): void;
    getConfig(): Readonly<SafetyConfig>;
}
export {};
//# sourceMappingURL=safety-guard.d.ts.map
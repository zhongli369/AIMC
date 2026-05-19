import type { CompanionRole } from "../../role/role-identity.js";
export interface VoiceProfileTTS {
    pitch: string;
    rate: string;
    volume: string;
    style: string;
}
export interface VoiceProfile {
    role: CompanionRole;
    voiceStyle: string;
    tts: VoiceProfileTTS;
    narrationPacing: number;
    pauseBetweenUtterancesMs: number;
}
export interface VoiceProfileConfig {
    version: string;
    description: string;
    defaultProfile: CompanionRole;
    profiles: Record<CompanionRole, VoiceProfile>;
}
export declare function loadVoiceProfiles(configPath?: string): VoiceProfileConfig;
export declare function getVoiceProfileConfig(): VoiceProfileConfig;
export declare function getVoiceProfile(role: CompanionRole): VoiceProfile;
export declare function getDefaultVoiceProfile(): VoiceProfile;
export declare function getVoiceProfileLoadError(): string | null;
export declare function reloadVoiceProfiles(configPath?: string): VoiceProfileConfig;
//# sourceMappingURL=voice-profile-loader.d.ts.map
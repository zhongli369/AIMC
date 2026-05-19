export { VAD } from "./vad.js";
export type { VADConfig, VADState, VADEvent } from "./vad.js";

export { WhisperSTT } from "./stt-whisper.js";
export type { WhisperConfig, WhisperResult } from "./stt-whisper.js";

export { EdgeTTS, EDGE_VOICES } from "./tts-edge.js";
export type { TTSConfig, TTSAudioChunk, TTSSynthesisState } from "./tts-edge.js";

export { VoiceOrchestrator } from "./voice-orchestrator.js";
export type {
  VoiceState,
  VoiceOrchestratorConfig,
  VoiceLatency,
} from "./voice-orchestrator.js";

// Phase 4-A: Companion Loop
export { VoiceEventBridge, voiceBridge } from "./voice-event-bus.js";
export type {
  VoiceInputEvent,
  VoiceOutputEvent,
  VoiceInterruptEvent,
  VoiceStateEvent,
} from "./voice-event-bus.js";

export { SpeechToTextAdapter } from "./speech-to-text.js";
export type { STTAdapterConfig } from "./speech-to-text.js";

export { TextToSpeechAdapter } from "./text-to-speech.js";
export type { TTSAdapterConfig } from "./text-to-speech.js";

export { createVoiceState, isSafeToInterrupt } from "./voice-state.js";
export type { VoiceState as VoiceBridgeState, NarrationCategory } from "./voice-state.js";

// Phase 4-B: Voice-Driven Timing
export { VoiceIntentAnalyzer } from "./voice-intent-analyzer.js";
export type { VoiceIntentConfig } from "./voice-intent-analyzer.js";

export {
  createNeutralSignal,
  computeTimingModifiers,
  computeSkillBias,
  applyRetryModifiers,
  applyTimeoutModifier,
} from "./voice-pressure.js";
export type {
  VoicePressureLevel,
  VoicePressureSignal,
  VoicePressureSource,
  VoiceTimingModifiers,
  VoiceSkillBias,
} from "./voice-pressure.js";

// P1: Voice Profile System
export {
  loadVoiceProfiles,
  getVoiceProfileConfig,
  getVoiceProfile,
  getDefaultVoiceProfile,
  getVoiceProfileLoadError,
  reloadVoiceProfiles,
} from "./profile/voice-profile-loader.js";
export type {
  VoiceProfileTTS,
  VoiceProfile,
  VoiceProfileConfig,
} from "./profile/voice-profile-loader.js";

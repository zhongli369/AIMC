/**
 * TextToSpeechAdapter — standardized TTS output adapter.
 *
 * Converts AI output → spoken audio with narration templates.
 *
 * Trigger points:
 *   - Chat response (AgentCore → speech text)
 *   - Skill execution result (start/complete/fail narration)
 *   - Fallback event (skill switched)
 *   - Critical alerts (danger, low health)
 *
 * This is OUTPUT ONLY. It does NOT:
 *   - Execute actions
 *   - Route skills
 *   - Modify the execution chain
 *   - Access bot state directly
 */
import { voiceBridge } from "./voice-event-bus.js";
import { getVoiceProfile } from "./profile/voice-profile-loader.js";
const DEFAULT_TTS_CONFIG = {
    narrateActions: true,
    narrateSkillResults: true,
    narrateFallbacks: true,
    narrateAlerts: true,
    maxUtteranceLength: 200,
    language: "zh",
};
// ─── Narration Templates ─────────────────────────────
const NARRATION_TEMPLATES = {
    zh: {
        skill_start: [
            "好的，我来{action}。",
            "正在{action}...",
            "收到，开始{action}。",
            "明白，我去{action}。",
        ],
        skill_complete: [
            "{action}完成了！",
            "已经{action}好了。",
            "{action}搞定。",
            "完成了，{action}。",
        ],
        skill_failed: [
            "{action}失败了，换个方法试试。",
            "{action}没成功，切换备用方案。",
            "这个{action}不行，我换一种方式。",
        ],
        fallback_activated: [
            "切换方案，改用{fallback}。",
            "换个思路，试试{fallback}。",
            "调整策略，转为{fallback}。",
        ],
        critical_alert: [
            "注意！{alert}！",
            "警告：{alert}！",
            "小心！{alert}！",
        ],
        idle_thought: [
            "周围看起来{observation}。",
            "我在观察{observation}。",
            "{observation}。",
        ],
        proactive_action: [
            "我准备{action}。",
            "接下来我{action}。",
            "顺便{action}。",
        ],
    },
    en: {
        skill_start: [
            "Alright, I'll {action}.",
            "{action} now...",
            "Got it, starting {action}.",
            "On my way to {action}.",
        ],
        skill_complete: [
            "{action} done!",
            "Finished {action}.",
            "{action} complete.",
        ],
        skill_failed: [
            "{action} failed, trying another approach.",
            "{action} didn't work, switching plans.",
        ],
        fallback_activated: [
            "Switching to {fallback}.",
            "Trying {fallback} instead.",
        ],
        critical_alert: [
            "Warning: {alert}!",
            "Alert: {alert}!",
            "Watch out! {alert}!",
        ],
        idle_thought: [
            "Looks {observation} around here.",
            "I notice {observation}.",
        ],
        proactive_action: [
            "I'll {action}.",
            "Going to {action}.",
        ],
    },
};
// ─── Adapter ─────────────────────────────────────────
export class TextToSpeechAdapter {
    config;
    onSpeak = null;
    voiceProfile = null;
    constructor(config) {
        this.config = { ...DEFAULT_TTS_CONFIG, ...config };
        // Listen for interrupts from bridge → mute TTS
        voiceBridge.onInterrupt(() => {
            this.mute();
        });
    }
    /** Wire the actual TTS playback callback (EdgeTTS.speak, etc.). */
    setSpeaker(fn) {
        this.onSpeak = fn;
    }
    /**
     * Apply a role-based voice profile to TTS output.
     * Adjusts pitch, rate, volume, and narration pacing.
     * P1 — Voice Profile System.
     */
    applyRoleVoiceProfile(role) {
        try {
            this.voiceProfile = getVoiceProfile(role);
            // Pacing is consumed by the caller (EdgeTTS or narration timing).
            // Pitch/rate/volume are passed through to EdgeTTS in the speaker callback.
        }
        catch {
            this.voiceProfile = null;
        }
    }
    /** Get the current voice profile (for EdgeTTS to read pitch/rate/volume). */
    getCurrentVoiceProfile() {
        return this.voiceProfile;
    }
    // ─── Narration Methods ─────────────────────────────
    /** Narrate a chat response from AgentCore. */
    speakChatResponse(text) {
        if (!text)
            return;
        this.emit(text, "chat_response");
    }
    /** Narrate skill execution starting. */
    speakSkillStart(skillName, actionDesc) {
        if (!this.config.narrateActions)
            return;
        const action = actionDesc || this.skillLabel(skillName);
        const text = this.pickTemplate("skill_start", { action });
        this.emit(text, "skill_start");
    }
    /** Narrate skill execution completed. */
    speakSkillComplete(skillName, actionDesc) {
        if (!this.config.narrateSkillResults)
            return;
        const action = actionDesc || this.skillLabel(skillName);
        const text = this.pickTemplate("skill_complete", { action });
        this.emit(text, "skill_complete");
    }
    /** Narrate skill execution failed. */
    speakSkillFailed(skillName, actionDesc) {
        if (!this.config.narrateSkillResults)
            return;
        const action = actionDesc || this.skillLabel(skillName);
        const text = this.pickTemplate("skill_failed", { action });
        this.emit(text, "skill_failed");
    }
    /** Narrate fallback activation. */
    speakFallback(fromSkill, toSkill) {
        if (!this.config.narrateFallbacks)
            return;
        const text = this.pickTemplate("fallback_activated", {
            action: this.skillLabel(fromSkill),
            fallback: this.skillLabel(toSkill),
        });
        this.emit(text, "fallback_activated");
    }
    /** Narrate a critical alert (danger, low health, etc.). */
    speakAlert(alertText) {
        if (!this.config.narrateAlerts)
            return;
        const text = this.pickTemplate("critical_alert", { alert: alertText });
        this.emit(text, "critical_alert");
    }
    /** Narrate an idle observation. */
    speakIdleThought(observation) {
        const text = this.pickTemplate("idle_thought", { observation });
        this.emit(text, "idle_thought");
    }
    /** Narrate a proactive action. */
    speakProactiveAction(actionDesc) {
        if (!this.config.narrateActions)
            return;
        const text = this.pickTemplate("proactive_action", { action: actionDesc });
        this.emit(text, "proactive_action");
    }
    /** Narrate an execution result (auto-detects category from result). */
    speakExecutionResult(result, skillName) {
        if (result.success && skillName) {
            this.speakSkillComplete(skillName);
        }
        else if (!result.success && skillName) {
            this.speakSkillFailed(skillName);
        }
    }
    // ─── Internals ─────────────────────────────────────
    emit(text, category) {
        if (!text || text.length > this.config.maxUtteranceLength) {
            text = text.slice(0, this.config.maxUtteranceLength);
        }
        const event = {
            text,
            category,
            timestamp: Date.now(),
        };
        voiceBridge.emitOutput(event);
        if (this.onSpeak) {
            this.onSpeak(text, category);
        }
    }
    mute() {
        // Signal TTS to stop — handled by voiceBridge interrupt
    }
    pickTemplate(key, vars) {
        const lang = this.config.language;
        const templates = (NARRATION_TEMPLATES[lang] || NARRATION_TEMPLATES.en)[key];
        if (!templates || templates.length === 0)
            return "";
        const template = templates[Math.floor(Math.random() * templates.length)];
        return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] || `{${k}}`);
    }
    skillLabel(skillName) {
        const zh = {
            follow_player: "跟着你",
            mine_resource: "挖矿",
            attack_target: "攻击目标",
            gather_food: "收集食物",
            build_shelter: "建造庇护所",
            collect_items: "捡东西",
            explore_area: "探索周围",
            defend_player: "保护你",
        };
        if (this.config.language === "zh" && zh[skillName]) {
            return zh[skillName];
        }
        return skillName.replace(/_/g, " ");
    }
    // ─── Config ────────────────────────────────────────
    setLanguage(lang) {
        this.config.language = lang;
    }
    setNarrateActions(enabled) {
        this.config.narrateActions = enabled;
    }
}
//# sourceMappingURL=text-to-speech.js.map
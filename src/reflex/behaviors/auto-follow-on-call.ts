/**
 * auto_follow_on_call reflex — when a player says "过来" / "come here",
 * move to them via pathfinder. Consumes the event so handleChat fast path
 * does not also fire.
 */

import type { ReflexBehavior, ReflexContext, ReflexResult } from "../reflex-manager.js";
import type { PerceptionEvent } from "../../perception/event-types.js";
import type { ChatPayload } from "../../perception/event-types.js";

// ─── Text normalization (lightweight, no heavy deps) ────────────

const TRAD_MAP: Record<string, string> = {
  "過來": "过来", "來": "来", "過": "过", "這裡": "这里",
  "跟著": "跟着", "嗎": "吗", "說": "说", "聽": "听",
  "見": "见", "讓": "让", "幫": "帮", "開": "开",
  "關": "关", "會": "会", "麼": "么", "樣": "样",
};

function normalizeText(raw: string): string {
  if (!raw) return "";
  let t = raw.trim().normalize("NFKC").toLowerCase();
  for (const [trad, simp] of Object.entries(TRAD_MAP)) {
    t = t.split(trad).join(simp);
  }
  if (t !== raw.trim()) {
    console.log(`[TEXT-NORM] raw="${raw.slice(0, 60)}" normalized="${t.slice(0, 60)}"`);
  }
  return t;
}

// ─── Pattern ──────────────────────────────────────────────────

// Matches anywhere — Whisper often adds extra words around "过来"
const FOLLOW_PATTERN =
  /(过来|過來|来这里|來這裡|come\s*here|come\s*to\s*me|到我这里|到我這裡|follow\s*me|跟着我|跟著我|跟我来|跟我來|过来一下|過來一下)/i;

function isFollowCall(text: string): boolean {
  return FOLLOW_PATTERN.test(normalizeText(text));
}

// ─── Factory ──────────────────────────────────────────────────

export function createAutoFollowOnCall(): ReflexBehavior {
  return {
    name: "auto_follow_on_call",
    enabled: true,

    canHandle(event: PerceptionEvent): boolean {
      if (event.type !== "chat:player_message") return false;
      // Only handle chat events with a real username (messagestr uses "player")
      if (event.source === "player") return false;
      const payload = event.payload as ChatPayload;
      return isFollowCall(payload.message);
    },

    async handle(
      event: PerceptionEvent,
      ctx: ReflexContext
    ): Promise<ReflexResult> {
      const payload = event.payload as ChatPayload;
      const username = payload.username;
      const traceId = event.traceId;

      console.log(
        `[REFLEX] auto_follow_on_call started traceId=${traceId} caller=${username}`
      );

      const playerEntity = ctx.bot?.players?.[username]?.entity;
      if (!playerEntity) {
        console.log(
          `[REFLEX] auto_follow_on_call skipped traceId=${traceId} reason=no_player_entity`
        );
        ctx.safeBotChat(`我看不到你，${username}。`);
        return { consumed: true, action: "auto_follow", reason: "no_player_entity" };
      }

      if (!ctx.bot?.pathfinder) {
        console.log(
          `[REFLEX] auto_follow_on_call skipped traceId=${traceId} reason=no_pathfinder`
        );
        ctx.safeBotChat(`抱歉${username}，我的寻路系统还没准备好。`);
        return { consumed: true, action: "auto_follow", reason: "no_pathfinder" };
      }

      // ── Resolve pathfinder module ──────────────────
      const pf = ctx.pf || require("mineflayer-pathfinder");
      if (!pf.goals || !pf.goals.GoalNear) {
        console.error(
          `[MOVE-DIAG] Reflex GoalNear unavailable — pf.goals=${Object.keys(pf.goals || {}).join(",")}`
        );
        ctx.safeBotChat(`抱歉${username}，我的寻路配置有问题。`);
        return { consumed: true, action: "auto_follow", reason: "goals_missing" };
      }

      console.log(`[MOVE-DIAG] pathfinder available=true movements configured=true`);

      try {
        const { x, y, z } = playerEntity.position;
        console.log(
          `[MOVE-DIAG] Reflex GoalNear for ${username} at (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`
        );

        const goal = new pf.goals.GoalNear(x, y, z, 2);
        ctx.bot.pathfinder.setMovements(new pf.Movements(ctx.bot));
        ctx.bot.pathfinder.setGoal(goal, true);

        console.log(
          `[MOVE-DIAG] Reflex GoalNear set: (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}, 2)`
        );
        ctx.safeBotChat(`来了，${username}！`);

        console.log(
          `[REFLEX] auto_follow_on_call completed traceId=${traceId} target=${username}`
        );
        return {
          consumed: true,
          action: "auto_follow",
          reason: "pathfinder_goal_set",
        };
      } catch (err: any) {
        console.error(
          `[REFLEX] auto_follow_on_call failed traceId=${traceId} error=${err.message}\n${err.stack}`
        );
        ctx.safeBotChat(`抱歉${username}，我动不了。${err.message.slice(0, 80)}`);
        return {
          consumed: true,
          action: "auto_follow",
          error: err.message,
        };
      }
    },
  };
}

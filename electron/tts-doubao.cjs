/**
 * Doubao (豆包) TTS Provider — V1 HTTP non-streaming.
 *
 * Uses Volcengine (火山引擎) TTS API v1.
 * Docs: https://www.volcengine.com/docs/6561/1257584
 *
 * Env vars required:
 *   DOUBAO_TTS_API_KEY     — Bearer token for Authorization header
 *   DOUBAO_TTS_APP_ID      — App ID from Volcengine console
 *
 * Env vars optional:
 *   DOUBAO_TTS_VOICE       — voice_type (default: zh_female_qingxin)
 *   DOUBAO_TTS_FORMAT      — audio encoding: mp3 / wav (default: mp3)
 *   DOUBAO_TTS_CLUSTER     — app.cluster (default: volcano_tts)
 *   DOUBAO_TTS_ACCESS_TOKEN— app.token field (default: same as API_KEY)
 */

const https = require("https");

const DOUBAO_ENDPOINT = "https://openspeech.bytedance.com/api/v1/tts";

/** Max text length in bytes (V1 limit: 1024 bytes) */
const MAX_TEXT_BYTES = 900;

/** Request timeout ms */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * @param {string} text
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} options.appId
 * @param {string} [options.voice]
 * @param {string} [options.format]
 * @param {string} [options.cluster]
 * @param {string} [options.accessToken]
 * @returns {Promise<Buffer>} MP3/WAV audio buffer
 */
async function doubaoTTS(text, options) {
  const {
    apiKey,
    appId,
    voice = "zh_female_qingxin",
    format = "mp3",
    cluster = "volcano_tts",
    accessToken = apiKey,
  } = options;

  // ── Validate inputs ──────────────────────────────
  if (!text || typeof text !== "string" || !text.trim()) {
    throw new Error("doubao TTS: empty text");
  }

  if (!apiKey) {
    throw new Error("doubao TTS: missing DOUBAO_TTS_API_KEY");
  }
  if (!appId) {
    throw new Error("doubao TTS: missing DOUBAO_TTS_APP_ID");
  }

  // ── Truncate text to fit 1024-byte limit ──────────
  let payload = text.trim();
  if (Buffer.byteLength(payload, "utf-8") > MAX_TEXT_BYTES) {
    // Iterative truncation to stay under byte limit
    while (Buffer.byteLength(payload, "utf-8") > MAX_TEXT_BYTES && payload.length > 0) {
      payload = payload.slice(0, -1);
    }
  }

  const reqid = "aimc-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);

  const body = JSON.stringify({
    app: {
      appid: String(appId),
      token: String(accessToken || "placeholder"),
      cluster: String(cluster),
    },
    user: {
      uid: "aimc_bot",
    },
    audio: {
      voice_type: String(voice),
      encoding: format === "wav" ? "wav" : "mp3",
      speed_ratio: 1.0,
    },
    request: {
      reqid,
      text: payload,
      operation: "query",
    },
  });

  console.log(`[TTS] doubao request started traceId=${reqid} textLen=${payload.length} bytes=${Buffer.byteLength(payload, "utf-8")} voice=${voice}`);

  return new Promise((resolve, reject) => {
    const url = new URL(DOUBAO_ENDPOINT);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: {
          "Authorization": `Bearer;${apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body, "utf-8"),
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");

          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch (err) {
            reject(new Error(`doubao TTS: invalid JSON response (${raw.slice(0, 120)})`));
            return;
          }

          if (parsed.code !== 3000) {
            const errMsg = parsed.message || `code=${parsed.code}`;
            reject(new Error(`doubao TTS: API error — ${errMsg} (code=${parsed.code})`));
            return;
          }

          if (!parsed.data) {
            reject(new Error("doubao TTS: no audio data in response"));
            return;
          }

          try {
            const audio = Buffer.from(parsed.data, "base64");
            console.log(`[TTS] doubao audio received bytes=${audio.length} durationMs=${parsed.addition?.duration || "?"} traceId=${reqid}`);
            resolve(audio);
          } catch (err) {
            reject(new Error(`doubao TTS: base64 decode failed — ${err.message}`));
          }
        });
      },
    );

    req.on("error", (err) => {
      reject(new Error(`doubao TTS: network error — ${err.message}`));
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`doubao TTS: request timeout after ${REQUEST_TIMEOUT_MS}ms`));
    });

    req.write(body);
    req.end();
  });
}

module.exports = { doubaoTTS };

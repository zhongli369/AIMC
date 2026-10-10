/**
 * Doubao (豆包) TTS Provider — V1 HTTP non-streaming.
 *
 * Uses Volcengine (火山引擎) TTS API v1 (OpenSpeech).
 * Docs: https://www.volcengine.com/docs/6561/1257584
 *
 * Auth: Volcengine HMAC-SHA256 Signature V4.
 *
 * Env vars (consumed by legacy-bridge.cjs):
 *   DOUBAO_TTS_ACCESS_KEY_ID     — Volcengine IAM AccessKeyId  (AKLT...)
 *   DOUBAO_TTS_SECRET_ACCESS_KEY — Volcengine IAM SecretAccessKey (base64)
 *   DOUBAO_TTS_API_KEY           — TTS grant token (body.app.token)
 *   DOUBAO_TTS_APP_ID            — App ID (body.app.appid)
 *
 * Env vars optional:
 *   DOUBAO_TTS_VOICE       — voice_type (default: zh_female_qingxin)
 *   DOUBAO_TTS_FORMAT      — mp3 / wav (default: mp3)
 *   DOUBAO_TTS_CLUSTER     — app.cluster (default: volcano_tts)
 */

const https = require("https");
const crypto = require("crypto");

const DOUBAO_ENDPOINT = "https://openspeech.bytedance.com/api/v1/tts";
const REGION = "cn-beijing";
const SERVICE = "openspeech";

/** Max text length in bytes (V1 limit: 1024 bytes) */
const MAX_TEXT_BYTES = 900;

/** Request timeout ms */
const REQUEST_TIMEOUT_MS = 30_000;

// ─── Volcengine Signature V4 ──────────────────────────────

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmacSha256Hex(key, data) {
  return crypto.createHmac("sha256", key).update(data, "utf-8").digest("hex");
}

function hmacSha256Buf(key, data) {
  return crypto.createHmac("sha256", key).update(data, "utf-8").digest();
}

/**
 * Build Volcengine HMAC-SHA256 Signature V4 Authorization header.
 */
function signRequest(method, pathname, hostname, body, accessKeyId, rawSecretAccessKey) {
  const now = new Date();
  // X-Date format: YYYYMMDDTHHMMSSZ (no dashes, no colons, UTC)
  const y = now.getUTCFullYear();
  const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const h = String(now.getUTCHours()).padStart(2, "0");
  const mi = String(now.getUTCMinutes()).padStart(2, "0");
  const s = String(now.getUTCSeconds()).padStart(2, "0");
  const xdate = `${y}${mo}${d}T${h}${mi}${s}Z`;
  const datestamp = `${y}${mo}${d}`;

  // SecretAccessKey may be double-base64-encoded by Volcengine console.
  // Decode once; if the result still looks like base64, decode again.
  let secretKey = rawSecretAccessKey;
  try {
    secretKey = Buffer.from(rawSecretAccessKey, "base64").toString("utf-8");
    // If the result is also valid base64 (no non-base64 chars), decode again
    if (/^[A-Za-z0-9+/=]+$/.test(secretKey) && secretKey.length > 20) {
      secretKey = Buffer.from(secretKey, "base64").toString("utf-8");
    }
  } catch (_) {
    secretKey = rawSecretAccessKey;
  }

  const payloadHash = sha256(body);

  // Canonical headers (sorted by lowercase name)
  const canonicalHeaders =
    `content-type:application/json\n` +
    `host:${hostname}\n` +
    `x-date:${xdate}\n`;
  const signedHeaders = "content-type;host;x-date";

  // Canonical request
  const canonicalRequest = [
    method,
    pathname,
    "",                         // no query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  // String to sign
  const credentialScope = `${datestamp}/${REGION}/${SERVICE}/request`;
  const stringToSign = [
    "HMAC-SHA256",
    xdate,
    credentialScope,
    sha256(canonicalRequest),
  ].join("\n");

  // Calculate signing key (no prefix for OpenSpeech service)
  const kDate = hmacSha256Buf(secretKey, datestamp);
  const kRegion = hmacSha256Buf(kDate, REGION);
  const kService = hmacSha256Buf(kRegion, SERVICE);
  const kSigning = hmacSha256Buf(kService, "request");

  const signature = hmacSha256Hex(kSigning, stringToSign);

  const authorization =
    `HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { authorization, xdate, payloadHash };
}

// ─── Main API ────────────────────────────────────────────

/**
 * @param {string} text
 * @param {object} options
 * @param {string} options.accessKeyId       — Volcengine IAM AccessKeyId
 * @param {string} options.secretAccessKey   — Volcengine IAM SecretAccessKey (base64)
 * @param {string} options.appId             — App ID (body.app.appid)
 * @param {string} [options.voice]           — voice_type
 * @param {string} [options.format]          — mp3 / wav
 * @param {string} [options.cluster]         — app.cluster
 * @param {string} [options.apiKey]          — TTS grant token (body.app.token)
 * @returns {Promise<Buffer>} MP3/WAV audio buffer
 */
async function doubaoTTS(text, options) {
  const {
    accessKeyId,
    secretAccessKey,
    appId,
    voice = "zh_female_qingxin",
    format = "mp3",
    cluster = "volcano_tts",
    apiKey,
  } = options;

  // ── Validate inputs ──────────────────────────────
  if (!text || typeof text !== "string" || !text.trim()) {
    throw new Error("doubao TTS: empty text");
  }
  if (!accessKeyId) {
    throw new Error("doubao TTS: missing DOUBAO_TTS_ACCESS_KEY_ID");
  }
  if (!secretAccessKey) {
    throw new Error("doubao TTS: missing DOUBAO_TTS_SECRET_ACCESS_KEY");
  }
  if (!appId) {
    throw new Error("doubao TTS: missing DOUBAO_TTS_APP_ID");
  }

  // ── Truncate text to fit 1024-byte limit ──────────
  let payload = text.trim();
  if (Buffer.byteLength(payload, "utf-8") > MAX_TEXT_BYTES) {
    while (Buffer.byteLength(payload, "utf-8") > MAX_TEXT_BYTES && payload.length > 0) {
      payload = payload.slice(0, -1);
    }
  }

  const reqid = "aimc-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);

  const body = JSON.stringify({
    app: {
      appid: String(appId),
      token: String(apiKey || ""),
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

  const url = new URL(DOUBAO_ENDPOINT);
  const { authorization, xdate } = signRequest(
    "POST", url.pathname, url.hostname, body,
    accessKeyId, secretAccessKey,
  );

  console.log(`[TTS] doubao request started traceId=${reqid} textLen=${payload.length} bytes=${Buffer.byteLength(payload, "utf-8")} voice=${voice}`);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        servername: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: {
          "Authorization": authorization,
          "Content-Type": "application/json",
          "X-Date": xdate,
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

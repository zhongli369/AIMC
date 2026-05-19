/**
 * CJS bridge — loads legacy Mindcraft bot AND new AgentCore pipeline.
 *
 * Protocol (stdin/stdout JSON-lines):
 *   stdin:  {"type":"chat","message":"...","source":"player"}
 *   stdout: AIMC_MSG:{"type":"chat_response","speech":{...},"completed":true}
 *   stdout: AIMC_MSG:{"type":"ready"}
 *   stdout: (everything else = regular log output)
 */

const path = require('path');
const { pathToFileURL } = require('url');

const legacyMain = path.resolve(__dirname, '..', 'src', 'legacy', 'main.js');
const distIndex = path.resolve(__dirname, '..', 'dist', 'index.js');

// ── Model → Env Var Map (mirrors main.cjs) ──────────────

const MODEL_API_KEY_MAP = {
  'deepseek-chat': 'DEEPSEEK_API_KEY',
  'deepseek-reasoner': 'DEEPSEEK_API_KEY',
  'gpt-4o': 'OPENAI_API_KEY',
  'gpt-4o-mini': 'OPENAI_API_KEY',
  'claude-sonnet-4-6': 'ANTHROPIC_API_KEY',
  'claude-opus-4-7': 'ANTHROPIC_API_KEY',
  'claude-haiku-4-5': 'ANTHROPIC_API_KEY',
  'gemini-2.5-pro': 'GEMINI_API_KEY',
  'gemini-2.5-flash': 'GEMINI_API_KEY',
};

// ── Start legacy bot ────────────────────────────────────

import(pathToFileURL(legacyMain).href).catch(err => {
  console.error('Failed to load AIMC legacy module:', err);
  process.exit(1);
});

// ── Init new pipeline ───────────────────────────────────

let settings = {};
try {
  settings = JSON.parse(process.env.SETTINGS_JSON || '{}');
} catch (e) {}

const model = settings.model || 'deepseek-chat';
const apiKeyVar = MODEL_API_KEY_MAP[model] || 'DEEPSEEK_API_KEY';
const apiKey = process.env[apiKeyVar];

let agentReady = false;

if (apiKey) {
  import(pathToFileURL(distIndex).href).then(async (aimc) => {
    const agent = aimc.initAgent({ apiKey, model });
    agentReady = true;
    console.log('[AIMC Bridge] AgentCore pipeline ready — model:', model);

    // Signal readiness to main process
    process.stdout.write('AIMC_MSG:' + JSON.stringify({ type: 'ready', model }) + '\n');

    // ── Stdin: receive chat messages from main process ──
    let stdinBuf = '';
    process.stdin.on('data', (chunk) => {
      stdinBuf += chunk.toString();
      const lines = stdinBuf.split('\n');
      stdinBuf = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'chat' && msg.message) {
            handleChat(agent, msg);
          }
        } catch (_) {
          // Not JSON — ignore (could be piped noise)
        }
      }
    });

  }).catch(err => {
    console.error('[AIMC Bridge] Failed to load new pipeline:', err.message);
  });
} else {
  console.log('[AIMC Bridge] No API key found — AgentCore skipped.');
  process.stdout.write('AIMC_MSG:' + JSON.stringify({ type: 'ready', model: null, error: 'no_api_key' }) + '\n');
}

// ── Chat handler ────────────────────────────────────────

async function handleChat(agent, msg) {
  try {
    const result = await agent.think({
      botState: globalThis.__botState__ || {},
      chatMessage: {
        source: msg.source || 'player',
        message: msg.message,
      },
    });

    process.stdout.write('AIMC_MSG:' + JSON.stringify({
      type: 'chat_response',
      completed: result.completed,
      speech: result.agentOutput?.speech || null,
      fallback: result.fallback || false,
    }) + '\n');
  } catch (err) {
    process.stdout.write('AIMC_MSG:' + JSON.stringify({
      type: 'chat_response',
      completed: false,
      speech: null,
      error: err.message,
    }) + '\n');
  }
}

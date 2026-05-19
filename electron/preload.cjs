/**
 * AIMC Electron Launcher — Preload Script
 *
 * Exposes safe IPC methods to renderer via contextBridge.
 * contextIsolation ensures renderer has zero direct Node access.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aimc", {
  // ─── Config ──────────────────────────────────────────
  loadConfig: () => ipcRenderer.invoke("config:load"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),

  // ─── Bot Control ─────────────────────────────────────
  startBot: (config) => ipcRenderer.invoke("bot:start", config),
  stopBot: () => ipcRenderer.invoke("bot:stop"),
  getBotStatus: () => ipcRenderer.invoke("bot:status"),

  // ─── Events (main → renderer) ───────────────────────
  onBotOutput: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("bot:output", handler);
    return () => ipcRenderer.removeListener("bot:output", handler);
  },
  onBotStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("bot:status", handler);
    return () => ipcRenderer.removeListener("bot:status", handler);
  },

  // ─── Chat (renderer → AgentCore) ─────────────────────
  sendChat: (message) => ipcRenderer.invoke("chat:send", message),
  onChatResponse: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("bot:chat-response", handler);
    return () => ipcRenderer.removeListener("bot:chat-response", handler);
  },
});

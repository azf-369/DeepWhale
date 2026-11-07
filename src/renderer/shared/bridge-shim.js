/**
 * Dual-Environment Bridge Shim:
 * - In Electron Desktop mode: delegates directly to `window.deepwhale` exposed by preload.js.
 * - In Browser Preview mode (`npm run web`): connects over HTTP + SSE (`/api/...`) seamlessly.
 */
export function getBridge() {
  if (window.deepwhale) {
    return window.deepwhale;
  }

  const listeners = new Map();
  const emitLocal = (channel, payload) => {
    const set = listeners.get(channel);
    if (set) {
      for (const fn of set) fn(payload);
    }
  };

  // Connect SSE stream in browser preview mode
  try {
    const es = new EventSource('/api/events');
    es.onmessage = (ev) => {
      try {
        const { channel, payload } = JSON.parse(ev.data);
        emitLocal(channel, payload);
      } catch (_) {}
    };
  } catch (_) {}

  const postJson = async (url, body = {}) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return res.json();
  };

  const webBridge = {
    isElectron: false,
    setIgnoreMouseEvents: () => {},
    startPetDrag: () => {},
    endPetDrag: () => {},
    showPetContextMenu: () => {
      emitLocal('web:open-chat-drawer', 'chat');
    },
    openChatWindow: async (tab = 'chat') => {
      window.parent?.postMessage({ type: 'deepwhale-open-chat', tab }, '*');
      emitLocal('chat:switch-tab', tab);
      return { open: true };
    },
    toggleChatWindow: async (tab = 'chat') => {
      window.parent?.postMessage({ type: 'deepwhale-toggle-chat', tab }, '*');
      return { open: true };
    },
    closeChatWindow: async () => {
      window.parent?.postMessage({ type: 'deepwhale-close-chat' }, '*');
      return { open: false };
    },
    minimizeChatWindow: async () => ({ ok: true }),
    resetPetPosition: async () => ({ x: 0, y: 0 }),

    getConfig: async () => (await fetch('/api/config')).json(),
    updateConfig: (partial) => postJson('/api/config', partial),
    interactPet: (action) => postJson('/api/interact', { action }),
    triggerPetAction: (payload) => {
      postJson('/api/pet-action', payload).catch(() => {});
    },

    getMessages: async () => (await fetch('/api/messages')).json(),
    clearMessages: () => postJson('/api/messages/clear'),
    sendMessage: (text) => postJson('/api/chat/send', { text }),
    abortStream: () => postJson('/api/chat/abort'),
    testConnection: (apiConfig) => postJson('/api/ai/test', apiConfig || {}),
    checkBalance: (apiConfig) => postJson('/api/ai/balance', apiConfig || {}),

    readClipboard: async () => {
      try {
        return await navigator.clipboard.readText();
      } catch (_) {
        return '';
      }
    },
    writeClipboard: async (text) => {
      try {
        await navigator.clipboard.writeText(String(text || ''));
      } catch (_) {}
      return { ok: true };
    },
    openExternal: async (url) => {
      window.open(url, '_blank', 'noopener,noreferrer');
      return { ok: true };
    },
    on: (channel, cb) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel).add(cb);
      return () => listeners.get(channel)?.delete(cb);
    }
  };

  window.deepwhale = webBridge;
  return webBridge;
}

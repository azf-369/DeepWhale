const { contextBridge, ipcRenderer } = require('electron');

function onChannel(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('deepwhale', {
  isElectron: true,

  // Mouse pass-through & dragging
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send('pet:set-ignore-mouse', ignore),
  startPetDrag: () => ipcRenderer.send('pet:drag-start'),
  endPetDrag: () => ipcRenderer.send('pet:drag-end'),
  showPetContextMenu: () => ipcRenderer.send('pet:context-menu'),

  // Window controls
  openChatWindow: (tab = 'chat') => ipcRenderer.invoke('window:open-chat', tab),
  toggleChatWindow: (tab = 'chat') => ipcRenderer.invoke('window:toggle-chat', tab),
  closeChatWindow: () => ipcRenderer.invoke('window:close-chat'),
  minimizeChatWindow: () => ipcRenderer.invoke('window:minimize-chat'),
  resetPetPosition: () => ipcRenderer.invoke('window:reset-pet'),

  // Configuration & Pet Growth
  getConfig: () => ipcRenderer.invoke('store:get-config'),
  updateConfig: (partial) => ipcRenderer.invoke('store:update-config', partial),
  interactPet: (action) => ipcRenderer.invoke('pet:interact', action),
  triggerPetAction: (payload) => ipcRenderer.send('pet:trigger-action', payload),

  // Chat & AI Service
  getMessages: () => ipcRenderer.invoke('chat:get-messages'),
  clearMessages: () => ipcRenderer.invoke('chat:clear-messages'),
  sendMessage: (text) => ipcRenderer.invoke('chat:send', text),
  abortStream: () => ipcRenderer.invoke('chat:abort'),
  testConnection: (apiConfig) => ipcRenderer.invoke('ai:test-connection', apiConfig),
  checkBalance: (apiConfig) => ipcRenderer.invoke('ai:check-balance', apiConfig),

  // Clipboard Productivity
  readClipboard: () => ipcRenderer.invoke('system:read-clipboard'),
  writeClipboard: (text) => ipcRenderer.invoke('system:write-clipboard', text),
  openExternal: (url) => ipcRenderer.invoke('system:open-external', url),

  // Subscriptions
  on: (channel, callback) => onChannel(channel, callback)
});

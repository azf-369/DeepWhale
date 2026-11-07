/**
 * Zero-dependency Web Preview Server (`npm run web`)
 * Hosts both the floating DeepSeek Whale (`pet.html`) and AI Cockpit (`chat.html`)
 * on an interactive simulated desktop stage at http://127.0.0.1:3988
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { LocalStore } = require('../src/main/store');
const { AIService } = require('../src/main/ai-service');

const ROOT_DIR = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 3988;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const store = new LocalStore();
const aiService = new AIService(store);
const sseClients = new Set();

function broadcastSSE(channel, payload) {
  const frame = `data: ${JSON.stringify({ channel, payload })}\n\n`;
  for (const res of sseClients) {
    res.write(frame);
  }
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (_) {
        resolve({});
      }
    });
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

const STAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>DeepWhale 深海小鲸 · 桌面预览演练场</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 100vw; height: 100vh; overflow: hidden;
      font-family: "Microsoft YaHei UI", system-ui, sans-serif;
      background:
        radial-gradient(circle at 20% 20%, #1e3a8a 0%, transparent 45%),
        radial-gradient(circle at 80% 75%, #0ea5e9 0%, transparent 40%),
        linear-gradient(135deg, #060d24 0%, #0f1f4b 100%);
      color: #e2e8f0;
      position: relative;
    }
    .stage-banner {
      position: fixed; top: 16px; left: 20px;
      padding: 8px 14px; border-radius: 999px;
      background: rgba(15, 23, 42, 0.72);
      border: 1px solid rgba(96, 165, 250, 0.35);
      font-size: 12.5px; color: #bae6fd;
      backdrop-filter: blur(8px);
    }
    #chat-frame {
      position: fixed; right: 410px; bottom: 28px;
      width: 430px; height: 640px; border: none;
      background: transparent;
      transition: opacity 0.22s ease, transform 0.22s ease;
    }
    #chat-frame.closed {
      opacity: 0; pointer-events: none; transform: translateY(14px) scale(0.97);
    }
    #pet-frame {
      position: fixed; right: 28px; bottom: 18px;
      width: 360px; height: 430px; border: none;
      background: transparent;
    }
  </style>
</head>
<body>
  <div class="stage-banner">
    🐳 <strong>DeepWhale 网页预览演练场</strong> · 原生透明穿透桌面版请运行 <code>npm start</code>
  </div>
  <iframe id="chat-frame" src="/src/renderer/chat/chat.html"></iframe>
  <iframe id="pet-frame" src="/src/renderer/pet/pet.html"></iframe>
  <script>
    const chatFrame = document.getElementById('chat-frame');
    window.addEventListener('message', (e) => {
      if (!e.data || !e.data.type) return;
      if (e.data.type === 'deepwhale-open-chat') chatFrame.classList.remove('closed');
      if (e.data.type === 'deepwhale-close-chat') chatFrame.classList.add('closed');
      if (e.data.type === 'deepwhale-toggle-chat') chatFrame.classList.toggle('closed');
    });
  </script>
</body>
</html>`;

function createPreviewServer() {
  return http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const pathname = urlObj.pathname;

    if (pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(STAGE_HTML);
      return;
    }

    if (pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });
      res.write(': connected\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (pathname === '/api/config' && req.method === 'GET') {
      return sendJson(res, 200, store.getConfig());
    }

    if (pathname === '/api/config' && req.method === 'POST') {
      const partial = await readJsonBody(req);
      const updated = store.updateConfig(partial);
      broadcastSSE('config:updated', updated);
      return sendJson(res, 200, updated);
    }

    if (pathname === '/api/interact' && req.method === 'POST') {
      const { action } = await readJsonBody(req);
      const out = store.interactPet(action);
      broadcastSSE('pet:stats-updated', out);
      return sendJson(res, 200, out);
    }

    if (pathname === '/api/pet-action' && req.method === 'POST') {
      const payload = await readJsonBody(req);
      broadcastSSE('pet:external-action', payload);
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/messages' && req.method === 'GET') {
      return sendJson(res, 200, store.getMessages());
    }

    if (pathname === '/api/messages/clear' && req.method === 'POST') {
      const empty = store.clearMessages();
      broadcastSSE('chat:cleared', empty);
      return sendJson(res, 200, empty);
    }

    if (pathname === '/api/chat/abort' && req.method === 'POST') {
      return sendJson(res, 200, { stopped: aiService.abortActiveStream() });
    }

    if (pathname === '/api/chat/send' && req.method === 'POST') {
      const { text } = await readJsonBody(req);
      if (!text || !text.trim()) return sendJson(res, 400, { error: 'empty' });
      try {
        const finalMsg = await aiService.streamChat(text.trim(), {
          onStart: (info) => broadcastSSE('chat:stream-start', info),
          onReasoning: (r) => broadcastSSE('chat:stream-reasoning', r),
          onEmotion: (emotion) => broadcastSSE('chat:stream-emotion', { emotion }),
          onToken: (t) => broadcastSSE('chat:stream-token', t),
          onComplete: (done) => broadcastSSE('chat:stream-done', done),
          onError: (err) => broadcastSSE('chat:stream-error', err)
        });
        return sendJson(res, 200, finalMsg || {});
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    if (pathname === '/api/ai/test' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const out = await aiService.testConnection(body);
      return sendJson(res, 200, out);
    }

    if (pathname === '/api/ai/balance' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const out = await aiService.checkBalance(body);
      return sendJson(res, 200, out);
    }

    // Serve static files inside workspace safely
    const safeRel = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(ROOT_DIR, safeRel);
    if (!filePath.startsWith(ROOT_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
}

if (require.main === module) {
  const server = createPreviewServer();
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`\n🐳 DeepWhale Web Preview running at: http://127.0.0.1:${PORT}\n`);
  });
}

module.exports = { createPreviewServer };

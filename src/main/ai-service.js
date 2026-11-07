const EMOTION_INSTRUCTION = `
【桌宠动作联动协议】
你同时控制着桌面小蓝鲸的实时表情与肢体动作。请在每次回复的最开头加上一个英文方括号动作标签（仅限以下之一）：
[happy] 开心微笑摆鳍 | [spout] 兴奋喷水柱庆祝 | [shy] 害羞脸红扭动 | [think] 沉思歪头 | [excited] 欢呼雀跃 | [sleepy] 犯困打哈欠 | [swim] 悠闲畅游
示例："[happy] 嗨！今天写代码顺利吗？"
注意：标签只能放在回复最开头一次，后面直接跟正常回复正文。`.trim();

const VALID_EMOTIONS = new Set(['happy', 'spout', 'shy', 'think', 'excited', 'sleepy', 'swim']);

function normalizeChatEndpoint(baseUrl) {
  let clean = (baseUrl || 'https://api.deepseek.com').trim().replace(/\/+$/, '');
  if (clean.endsWith('/chat/completions')) return clean;
  return `${clean}/chat/completions`;
}

function normalizeOriginBase(baseUrl) {
  let clean = (baseUrl || 'https://api.deepseek.com').trim().replace(/\/+$/, '');
  clean = clean.replace(/\/chat\/completions$/, '').replace(/\/v1$/, '');
  return clean;
}

function isLocalKeylessEndpoint(baseUrl) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test((baseUrl || '').trim());
}

/**
 * Incremental parser that strips a leading `[emotion]` tag from streamed content
 * without delaying normal text output.
 */
class LeadingEmotionParser {
  constructor(onEmotion, onText) {
    this.onEmotion = onEmotion;
    this.onText = onText;
    this.resolved = false;
    this.buffer = '';
  }

  push(chunk) {
    if (!chunk) return;
    if (this.resolved) {
      this.onText(chunk);
      return;
    }

    this.buffer += chunk;
    const trimmedStart = this.buffer.replace(/^\s+/, '');
    if (!trimmedStart) return;

    if (!trimmedStart.startsWith('[')) {
      this.resolved = true;
      this.onText(this.buffer);
      this.buffer = '';
      return;
    }

    const closeIdx = trimmedStart.indexOf(']');
    if (closeIdx === -1) {
      if (trimmedStart.length > 16) {
        this.resolved = true;
        this.onText(this.buffer);
        this.buffer = '';
      }
      return;
    }

    const rawTag = trimmedStart.slice(1, closeIdx).trim().toLowerCase();
    this.resolved = true;
    if (VALID_EMOTIONS.has(rawTag)) {
      this.onEmotion(rawTag);
      const rest = trimmedStart.slice(closeIdx + 1).replace(/^\s+/, '');
      if (rest) this.onText(rest);
    } else {
      this.onText(this.buffer);
    }
    this.buffer = '';
  }

  flush() {
    if (!this.resolved && this.buffer) {
      this.resolved = true;
      this.onText(this.buffer);
      this.buffer = '';
    }
  }
}

class AIService {
  constructor(store) {
    this.store = store;
    this.activeAbortController = null;
  }

  abortActiveStream() {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
      return true;
    }
    return false;
  }

  buildConversationPayload(userText) {
    const cfg = this.store.config;
    const persona = this.store.getActivePersona();
    const systemContent = `${persona.effectivePrompt}\n\n${EMOTION_INSTRUCTION}`;

    const historyLimit = Math.max(2, Number(cfg.api.maxHistoryMessages) || 16);
    const past = this.store
      .getMessages()
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content)
      .slice(-historyLimit)
      // Important for DeepSeek-R1: never send `reasoning_content` in historical messages
      .map((m) => ({ role: m.role, content: m.content }));

    return [
      { role: 'system', content: systemContent },
      ...past,
      { role: 'user', content: userText }
    ];
  }

  /**
   * Stream chat response via DeepSeek / OpenAI-compatible SSE API,
   * or fall back gracefully to interactive local companion mode when no API Key is set.
   */
  async streamChat(userText, callbacks = {}) {
    const {
      onStart = () => {},
      onReasoning = () => {},
      onEmotion = () => {},
      onToken = () => {},
      onComplete = () => {},
      onError = () => {}
    } = callbacks;

    this.abortActiveStream();
    const controller = new AbortController();
    this.activeAbortController = controller;

    const cfg = this.store.config;
    const apiKey = this.store.getEffectiveApiKey();
    const model = (cfg.api.model || 'deepseek-chat').trim();
    const endpoint = normalizeChatEndpoint(cfg.api.baseUrl);

    // Save user message & reward pet stats
    const userMsg = this.store.appendMessage({ role: 'user', content: userText, model });
    this.store.interactPet('chat');

    const startedAt = Date.now();
    onStart({ userMessage: userMsg, model });

    // Local Demo Companion fallback if user hasn't configured an API Key yet
    if (!apiKey && !isLocalKeylessEndpoint(cfg.api.baseUrl)) {
      return this._runLocalCompanionDemo(userText, model, controller.signal, {
        startedAt,
        onReasoning,
        onEmotion,
        onToken,
        onComplete,
        onError
      });
    }

    const messages = this.buildConversationPayload(userText);
    const isReasoner = /reasoner|deepseek-r1|\br1\b/i.test(model);

    const requestBody = {
      model,
      messages,
      stream: true
    };
    if (!isReasoner && typeof cfg.api.temperature === 'number') {
      requestBody.temperature = cfg.api.temperature;
    }

    let fullContent = '';
    let fullReasoning = '';
    let detectedEmotion = 'happy';
    let reasoningDurationMs = 0;
    const reasoningStartedAt = Date.now();

    const emotionParser = new LeadingEmotionParser(
      (emo) => {
        detectedEmotion = emo;
        onEmotion(emo);
      },
      (textDelta) => {
        fullContent += textDelta;
        onToken({ delta: textDelta, fullContent });
      }
    );

    try {
      const headers = {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream'
      };
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      if (!response.ok) {
        let errDetail = `${response.status} ${response.statusText}`;
        try {
          const errJson = await response.json();
          errDetail = errJson?.error?.message || errJson?.message || JSON.stringify(errJson);
        } catch (_) {
          const errText = await response.text().catch(() => '');
          if (errText) errDetail = errText.slice(0, 240);
        }
        throw new Error(`API 请求失败 (${response.status}): ${errDetail}`);
      }

      if (!response.body) {
        throw new Error('上游 API 未返回可读流 (ReadableStream)');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let sseBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split(/\r?\n/);
        sseBuffer = lines.pop() || '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || !line.startsWith('data:')) continue;
          const dataStr = line.slice(5).trim();
          if (dataStr === '[DONE]') continue;

          let parsed;
          try {
            parsed = JSON.parse(dataStr);
          } catch (_) {
            continue;
          }

          const delta = parsed?.choices?.[0]?.delta;
          if (!delta) continue;

          if (delta.reasoning_content) {
            fullReasoning += delta.reasoning_content;
            reasoningDurationMs = Date.now() - reasoningStartedAt;
            onReasoning({
              delta: delta.reasoning_content,
              fullReasoning,
              elapsedMs: reasoningDurationMs
            });
          }

          if (delta.content) {
            emotionParser.push(delta.content);
          }
        }
      }

      emotionParser.flush();

      const savedAssistant = this.store.appendMessage({
        role: 'assistant',
        content: fullContent || '（噗噜噜…小鲸刚刚吐了个空泡泡，要不要再试一次？）',
        reasoning: fullReasoning,
        emotion: detectedEmotion,
        model,
        isDemo: false,
        durationMs: Date.now() - startedAt
      });

      this.activeAbortController = null;
      onComplete(savedAssistant);
      return savedAssistant;
    } catch (err) {
      this.activeAbortController = null;
      if (err.name === 'AbortError') {
        emotionParser.flush();
        const partial = this.store.appendMessage({
          role: 'assistant',
          content: fullContent ? `${fullContent}\n\n*(已停止生成)*` : '*(已停止本次回复)*',
          reasoning: fullReasoning,
          emotion: 'swim',
          model,
          durationMs: Date.now() - startedAt
        });
        onComplete(partial);
        return partial;
      }
      onError({ message: err.message || '网络异常，请检查 API 配置' });
      throw err;
    }
  }

  async _runLocalCompanionDemo(userText, model, signal, hooks) {
    const { startedAt, onReasoning, onEmotion, onToken, onComplete, onError } = hooks;
    const sleep = (ms) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        if (signal) {
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              const abortErr = new Error('Aborted');
              abortErr.name = 'AbortError';
              reject(abortErr);
            },
            { once: true }
          );
        }
      });

    try {
      const lower = userText.toLowerCase();
      let emotion = 'happy';
      let reply = '';

      if (/喷水|水柱|庆祝|棒|厉害/.test(userText)) {
        emotion = 'spout';
        reply =
          '噗咻——💦 看我的双弧线深海彩虹水柱！现在我处于**本地陪伴演示模式**，点击右上角 `⚙️ 设置` 填入你的 **DeepSeek API Key**，我就能连上真正的 DeepSeek-V3 / R1 大脑陪你写代码和深度推理啦！';
      } else if (/喜欢|可爱|摸摸|抱抱|夸/.test(userText)) {
        emotion = 'shy';
        reply =
          '呜哇~ 被你这么夸，我的小胸鳍都要拍出浪花啦 (*/ω＼*)！想让我拥有真正的 AI 超能力吗？去 `⚙️ 设置` 粘贴 DeepSeek API Key 就可以实时畅聊咯！';
      } else if (/困|睡|晚安|累/.test(userText)) {
        emotion = 'sleepy';
        reply =
          '呼噜噜…深海的水温刚刚好 🌙 累了就先伸个懒腰歇一会儿吧，我会乖乖趴在桌面角落守着你的。（配置 API Key 后还能解锁深夜树洞长聊模式哦~）';
      } else if (lower.includes('code') || /代码|bug|报错|函数|解释|翻译/.test(userText)) {
        emotion = 'think';
        reply =
          '我闻到了代码的味道！🐋 当前还未配置 API Key（正在运行离线演示模式）。\n\n只需两步开启满血 DeepSeek：\n1. 打开面板顶部 **⚙️ 设置** 标签页\n2. 填入来自 `platform.deepseek.com` 的 **API Key** 并保存\n\n保存后无论是 `deepseek-chat` 极速问答还是 `deepseek-reasoner` 深度思维链都能实时流式对话！';
      } else {
        emotion = 'excited';
        reply = `噗噜噜！收到你的呼叫啦：「${userText.slice(0, 36)}${userText.length > 36 ? '…' : ''}」🐳\n\n我目前处于 **零配置本地陪伴模式**，你可以尽情拖拽我、摸摸我的头、双击看我喷水，或者投喂算力磷虾！\n想要开启真正的 **DeepSeek 实时 AI 对话**，请点击 **⚙️ 设置** 填入你的 API Key 吧~`;
      }

      const demoReasoning =
        /reasoner|r1/i.test(model)
          ? '正在调用深海小鲸本地声呐神经元…检测到尚未填入 API Key，准备切换为元气离线引导模式，同时展示 R1 深度思考折叠卡片效果！'
          : '';

      let fullReasoning = '';
      if (demoReasoning) {
        const rStart = Date.now();
        for (const ch of demoReasoning) {
          await sleep(18);
          fullReasoning += ch;
          onReasoning({
            delta: ch,
            fullReasoning,
            elapsedMs: Date.now() - rStart
          });
        }
      } else {
        await sleep(260);
      }

      onEmotion(emotion);
      let fullContent = '';
      const chunks = reply.match(/.{1,3}/gu) || [reply];
      for (const piece of chunks) {
        await sleep(24);
        fullContent += piece;
        onToken({ delta: piece, fullContent });
      }

      const saved = this.store.appendMessage({
        role: 'assistant',
        content: fullContent,
        reasoning: fullReasoning,
        emotion,
        model: `${model} (本地演示)`,
        isDemo: true,
        durationMs: Date.now() - startedAt
      });

      this.activeAbortController = null;
      onComplete(saved);
      return saved;
    } catch (err) {
      this.activeAbortController = null;
      if (err.name !== 'AbortError') {
        onError({ message: err.message });
      }
      return null;
    }
  }

  async testConnection(tempApiConfig = null) {
    const apiCfg = tempApiConfig || this.store.config.api;
    const apiKey = (apiCfg.apiKey || '').trim() || this.store.getEffectiveApiKey();
    const endpoint = normalizeChatEndpoint(apiCfg.baseUrl);
    const model = (apiCfg.model || 'deepseek-chat').trim();

    if (!apiKey && !isLocalKeylessEndpoint(apiCfg.baseUrl)) {
      return { ok: false, message: '请先填写 API Key（或使用本地 Ollama 地址）' };
    }

    const t0 = Date.now();
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 12,
          stream: false
        })
      });

      const latencyMs = Date.now() - t0;
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          ok: false,
          latencyMs,
          message: `连接失败 (${res.status}): ${text.slice(0, 160) || res.statusText}`
        };
      }
      const data = await res.json();
      const sample = data?.choices?.[0]?.message?.content || 'OK';
      return {
        ok: true,
        latencyMs,
        message: `连接成功！延迟 ${latencyMs}ms，模型响应正常`,
        sample
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - t0,
        message: `请求异常: ${err.message}`
      };
    }
  }

  async checkBalance(tempApiConfig = null) {
    const apiCfg = tempApiConfig || this.store.config.api;
    const apiKey = (apiCfg.apiKey || '').trim() || this.store.getEffectiveApiKey();
    const origin = normalizeOriginBase(apiCfg.baseUrl);

    if (!apiKey) {
      return { supported: false, message: '未配置 API Key' };
    }
    if (!/deepseek\.com/i.test(origin)) {
      return { supported: false, message: '仅 DeepSeek 官方接口支持余额查询' };
    }

    try {
      const res = await fetch(`${origin}/user/balance`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`
        }
      });

      if (!res.ok) {
        return { supported: false, message: `余额查询返回 ${res.status}` };
      }
      const data = await res.json();
      return {
        supported: true,
        isAvailable: Boolean(data.is_available),
        balances: Array.isArray(data.balance_infos) ? data.balance_infos : []
      };
    } catch (err) {
      return { supported: false, message: err.message };
    }
  }
}

module.exports = {
  AIService,
  LeadingEmotionParser,
  normalizeChatEndpoint
};

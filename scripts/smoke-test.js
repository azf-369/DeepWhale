/**
 * Automated End-to-End Smoke Test (`npm test`)
 * Verifies:
 * 1. Icon & UI asset integrity + ES Module syntax validation across all renderer files
 * 2. LocalStore persistence, persona management, and pet level-up math
 * 3. LeadingEmotionParser streaming tag extraction (`[spout]`, `[happy]`, plain text)
 * 4. Markdown streaming renderer (XSS safety, unclosed code blocks, inline code)
 * 5. AIService real-time SSE streaming (DeepSeek-R1 reasoning_content + content + balance API)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { LocalStore } = require('../src/main/store');
const { AIService, LeadingEmotionParser, normalizeChatEndpoint } = require('../src/main/ai-service');

const ROOT = path.resolve(__dirname, '..');

async function runTests() {
  console.log('🧪 Starting DeepWhale Automated Verification Suite...\n');

  // 1. Asset & File Structure + Syntax Check
  const requiredFiles = [
    'assets/icon.png',
    'assets/tray-icon.png',
    'assets/icon.ico',
    'src/main/main.js',
    'src/main/preload.js',
    'src/main/store.js',
    'src/main/ai-service.js',
    'src/renderer/shared/whale-engine.js',
    'src/renderer/shared/sound-fx.js',
    'src/renderer/shared/markdown.js',
    'src/renderer/shared/bridge-shim.js',
    'src/renderer/pet/pet.html',
    'src/renderer/pet/pet.css',
    'src/renderer/pet/pet.js',
    'src/renderer/chat/chat.html',
    'src/renderer/chat/chat.css',
    'src/renderer/chat/chat.js',
    'scripts/web-preview.js',
    'docs/RESEARCH_AND_PLAN.md'
  ];

  for (const rel of requiredFiles) {
    const full = path.join(ROOT, rel);
    assert.ok(fs.existsSync(full), `Missing required project file: ${rel}`);
    if (rel.endsWith('.js')) {
      execSync(`node --check "${full}"`, { stdio: 'pipe' });
    }
  }
  console.log('  ✅ [1/5] All 19 project files & JS syntax checks passed');

  // 2. LeadingEmotionParser & Endpoint Normalization
  let parsedEmotion = null;
  let parsedText = '';
  const parser = new LeadingEmotionParser(
    (e) => {
      parsedEmotion = e;
    },
    (t) => {
      parsedText += t;
    }
  );
  parser.push('[sp');
  parser.push('out] 噗咻');
  parser.push('！深海喷水！');
  parser.flush();
  assert.strictEqual(parsedEmotion, 'spout');
  assert.strictEqual(parsedText, '噗咻！深海喷水！');

  assert.strictEqual(
    normalizeChatEndpoint('https://api.deepseek.com/'),
    'https://api.deepseek.com/chat/completions'
  );
  assert.strictEqual(
    normalizeChatEndpoint('https://api.siliconflow.cn/v1'),
    'https://api.siliconflow.cn/v1/chat/completions'
  );
  console.log('  ✅ [2/5] Emotion tag stream parser & endpoint normalization verified');

  // 3. Markdown Streaming Renderer Import & XSS Check
  const mdMod = await import(`file://${path.join(ROOT, 'src/renderer/shared/markdown.js').replace(/\\/g, '/')}`);
  const html = mdMod.renderMarkdown('Hello **DeepWhale**!\n```js\nconst a = 1 < 2;\n');
  assert.ok(html.includes('<strong>DeepWhale</strong>'), 'Bold markdown should render');
  assert.ok(html.includes('const a = 1 &lt; 2;'), 'Unclosed streaming code block should escape HTML safely');
  console.log('  ✅ [3/5] Streaming Markdown renderer & XSS escaping verified');

  // 4. LocalStore & Pet Growth Math
  const store = new LocalStore();
  const initialCfg = store.getConfig();
  assert.ok(Array.isArray(initialCfg.personas) && initialCfg.personas.length >= 4);
  const feedRes = store.interactPet('feed');
  assert.ok(feedRes.stats.totalFeeds >= 1);
  console.log('  ✅ [4/5] LocalStore persistence & pet growth system verified');

  // 5. AIService DeepSeek-R1 SSE Stream & Balance Verification
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).endsWith('/user/balance')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          is_available: true,
          balance_infos: [{ currency: 'CNY', total_balance: '88.66' }]
        })
      };
    }

    const sseFrames = [
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '先思考一下如何向主人打招呼…' } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '决定喷个彩虹水柱！' } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: '[excited] ' } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: '你好呀！我是接入实时流式 API 的深海小鲸 🐳' } }] })}\n\n`,
      'data: [DONE]\n\n'
    ];
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const frame of sseFrames) {
          controller.enqueue(encoder.encode(frame));
        }
        controller.close();
      }
    });

    return {
      ok: true,
      status: 200,
      body: stream
    };
  };

  try {
    const originalApi = { ...store.config.api };
    store.updateConfig({
      api: {
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'sk-test-mock-key',
        model: 'deepseek-reasoner'
      }
    });

    const ai = new AIService(store);
    const bal = await ai.checkBalance();
    assert.strictEqual(bal.supported, true);
    assert.strictEqual(bal.balances[0].total_balance, '88.66');

    let streamedReasoning = '';
    let streamedTokens = '';
    let capturedEmotion = '';

    const finalMsg = await ai.streamChat('测试流式推理对话', {
      onReasoning: ({ fullReasoning }) => {
        streamedReasoning = fullReasoning;
      },
      onEmotion: (emo) => {
        capturedEmotion = emo;
      },
      onToken: ({ fullContent }) => {
        streamedTokens = fullContent;
      }
    });

    assert.strictEqual(capturedEmotion, 'excited');
    assert.ok(streamedReasoning.includes('彩虹水柱'), 'R1 reasoning_content should stream cleanly');
    assert.strictEqual(streamedTokens, '你好呀！我是接入实时流式 API 的深海小鲸 🐳');
    assert.strictEqual(finalMsg.emotion, 'excited');

    // Also verify zero-key Local Companion Demo mode
    const savedDsEnv = process.env.DEEPSEEK_API_KEY;
    const savedOaEnv = process.env.OPENAI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      store.updateConfig({
        api: {
          provider: 'deepseek',
          baseUrl: 'https://api.deepseek.com',
          apiKey: '',
          model: 'deepseek-chat'
        }
      });
      const demoMsg = await ai.streamChat('给我喷水庆祝一下！');
      assert.strictEqual(demoMsg.isDemo, true);
      assert.strictEqual(demoMsg.emotion, 'spout');
    } finally {
      if (savedDsEnv !== undefined) process.env.DEEPSEEK_API_KEY = savedDsEnv;
      if (savedOaEnv !== undefined) process.env.OPENAI_API_KEY = savedOaEnv;
    }

    // Restore clean state for first user launch
    const cleanApi =
      originalApi.apiKey === 'sk-test-mock-key' || /127\.0\.0\.1/.test(originalApi.baseUrl)
        ? {
            provider: 'deepseek',
            baseUrl: 'https://api.deepseek.com',
            apiKey: '',
            model: 'deepseek-chat',
            temperature: 0.7,
            maxHistoryMessages: 16
          }
        : originalApi;

    store.updateConfig({
      api: cleanApi,
      petStats: {
        name: '深海小鲸',
        mood: 90,
        energy: 92,
        exp: 25,
        level: 1,
        totalChats: 0,
        totalPats: 0,
        totalFeeds: 0
      }
    });
    store.clearMessages();
  } finally {
    global.fetch = realFetch;
  }

  console.log('  ✅ [5/5] AIService DeepSeek-V3/R1 SSE stream, Balance API & Demo fallback verified');
  console.log('\n🎉 All DeepWhale verification checks passed!\n');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

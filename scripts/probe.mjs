// 探测模型提供商支持哪些能力，结果决定后面的实现方式。
// 运行：node --env-file=.env scripts/probe.mjs
// 只打印测试结果，不打印密钥。
import zlib from 'node:zlib';

const BASE = (process.env.LLM_BASE_URL ?? '').trim().replace(/\/+$/, '');
const KEY = (process.env.LLM_API_KEY ?? '').trim();
const MODEL = (process.env.LLM_MODEL ?? '').trim();

if (!BASE || !KEY || !MODEL) {
  console.error('配置不完整：请在 .env 里填好 LLM_BASE_URL、LLM_API_KEY、LLM_MODEL。');
  process.exit(1);
}

/** 打印前去掉密钥、压成一行并截断。 */
function brief(value, max = 200) {
  const text = String(value).split(KEY).join('***').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

class HttpError extends Error {
  constructor(status, body) {
    super(`HTTP ${status}：${brief(body)}`);
    this.status = status;
  }
}

async function request(path, { method = 'POST', body, timeoutMs = 180_000 } = {}) {
  const startedAt = Date.now();
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { res, startedAt };
}

/** 非流式对话，返回回复文本。 */
async function chat(messages, extra = {}) {
  const { res, startedAt } = await request('/chat/completions', {
    body: { model: MODEL, messages, ...extra },
  });
  const raw = await res.text();
  if (!res.ok) throw new HttpError(res.status, raw);
  const json = JSON.parse(raw);
  const content = json.choices?.[0]?.message?.content ?? '';
  return {
    content: typeof content === 'string' ? content : JSON.stringify(content),
    ms: Date.now() - startedAt,
    usage: json.usage,
  };
}

/** 运行一项探测并打印结果；失败时返回错误对象，成功返回 null。 */
async function probe(name, run) {
  try {
    console.log(`[可用]   ${name}：${await run()}`);
    return null;
  } catch (err) {
    const cause = err.cause ? `（${err.cause.code ?? err.cause.message}）` : '';
    console.log(`[不可用] ${name}：${brief(err.message + cause)}`);
    return err;
  }
}

/** 生成一张纯色 PNG，用来测试图片输入。 */
function solidPng(width, height, [r, g, b]) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(typed) >>> 0);
    return Buffer.concat([length, typed, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 每通道 8 位
  header[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3); // 首字节是行滤波类型 0
  for (let x = 0; x < width; x += 1) row.set([r, g, b], 1 + x * 3);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function isAnswerSeven(content) {
  try {
    return JSON.parse(content)?.answer === 7;
  } catch {
    return false;
  }
}

console.log(`提供商：${BASE}\n模型：${MODEL}\n`);

let modelIds = [];
const listError = await probe('模型列表', async () => {
  const { res } = await request('/models', { method: 'GET', timeoutMs: 30_000 });
  const raw = await res.text();
  if (!res.ok) throw new HttpError(res.status, raw);
  modelIds = (JSON.parse(raw).data ?? []).map((m) => m.id).filter(Boolean);
  return `共 ${modelIds.length} 个模型，${modelIds.includes(MODEL) ? '包含' : '不包含'} ${MODEL}`;
});
if (listError instanceof HttpError && [401, 403].includes(listError.status)) {
  console.error('\n密钥被拒绝，请检查 .env 里的 LLM_API_KEY。后面的探测已跳过。');
  process.exit(1);
}

const chatError = await probe('基本对话', async () => {
  const { content, ms, usage } = await chat([{ role: 'user', content: '只回复两个字：你好' }]);
  if (!content.trim()) throw new Error('回复为空');
  const tokens = usage ? `，输入 ${usage.prompt_tokens} / 输出 ${usage.completion_tokens} tokens` : '';
  return `${ms} ms，回复"${brief(content, 30)}"${tokens}`;
});
if (chatError) {
  console.error('\n基本对话不通，后面的探测已跳过。');
  process.exit(1);
}

await probe('流式输出', async () => {
  const { res, startedAt } = await request('/chat/completions', {
    body: {
      model: MODEL,
      stream: true,
      messages: [{ role: 'user', content: '从 1 数到 20，用逗号分隔，不要说别的。' }],
    },
  });
  if (!res.ok) throw new HttpError(res.status, await res.text());
  const decoder = new TextDecoder();
  let buffer = '';
  let pieces = 0;
  let firstAt = 0;
  let sawReasoning = false;
  for await (const bytes of res.body) {
    buffer += decoder.decode(bytes, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let delta;
      try {
        delta = JSON.parse(data).choices?.[0]?.delta;
      } catch {
        continue;
      }
      if (!delta) continue;
      if (delta.reasoning_content || delta.reasoning) sawReasoning = true;
      if (delta.content) {
        pieces += 1;
        firstAt ||= Date.now();
      }
    }
  }
  if (pieces === 0) throw new Error('没有收到任何内容片段');
  const note = pieces < 3 ? '（段数很少，可能是攒好后一次性返回）' : '';
  return `首字 ${firstAt - startedAt} ms，共 ${pieces} 段${note}${sawReasoning ? '，带思考过程' : ''}`;
});

await probe('图片输入', async () => {
  const image = solidPng(64, 64, [220, 30, 30]).toString('base64');
  const { content } = await chat([
    {
      role: 'user',
      content: [
        { type: 'text', text: '这张图片是什么颜色？只回答一个字。' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${image}` } },
      ],
    },
  ]);
  if (!/红|red/i.test(content)) {
    throw new Error(`请求被接受，但回答不是红色："${brief(content, 60)}"，图片可能没有传到模型`);
  }
  return `模型看到了图片，回答"${brief(content, 20)}"`;
});

await probe('结构化输出（json_schema）', async () => {
  const { content } = await chat([{ role: 'user', content: '3 加 4 等于几？' }], {
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'probe_answer',
        strict: true,
        schema: {
          type: 'object',
          properties: { answer: { type: 'integer' } },
          required: ['answer'],
          additionalProperties: false,
        },
      },
    },
  });
  if (!isAnswerSeven(content)) throw new Error(`返回的不是符合格式的 JSON："${brief(content, 80)}"`);
  return '按指定格式返回了 JSON';
});

await probe('JSON 模式（json_object）', async () => {
  const { content } = await chat(
    [{ role: 'user', content: '3 加 4 等于几？用 JSON 回答，格式为 {"answer": 数字}。' }],
    { response_format: { type: 'json_object' } },
  );
  if (!isAnswerSeven(content)) throw new Error(`返回的不是符合格式的 JSON："${brief(content, 80)}"`);
  return '返回了合法 JSON';
});

await probe('思考强度参数（reasoning_effort）', async () => {
  const { ms } = await chat([{ role: 'user', content: '只回复两个字：你好' }], { reasoning_effort: 'low' });
  return `接口接受该参数，${ms} ms`;
});

await probe('Responses 接口（/responses）', async () => {
  const { res } = await request('/responses', { body: { model: MODEL, input: '只回复两个字：你好' } });
  const raw = await res.text();
  if (!res.ok) throw new HttpError(res.status, raw);
  if (!Array.isArray(JSON.parse(raw).output)) throw new Error('返回的不是 Responses 格式');
  return '可用';
});

await probe('语音合成（/audio/speech）', async () => {
  const listed = modelIds.filter((id) => /tts/i.test(id));
  const candidates = (listed.length ? listed : ['gpt-4o-mini-tts', 'tts-1']).slice(0, 3);
  const failures = [];
  for (const model of candidates) {
    const { res } = await request('/audio/speech', {
      body: { model, input: '你好，我们开始讲题。', voice: 'alloy' },
      timeoutMs: 60_000,
    });
    const bytes = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get('content-type') ?? '';
    if (res.ok && bytes.length > 1000 && !type.includes('json')) {
      return `模型 ${model}，返回 ${bytes.length} 字节（${type || '未知类型'}）`;
    }
    failures.push(`${model} HTTP ${res.status}`);
  }
  throw new Error(`没有可用的语音模型，试过 ${failures.join('、')}`);
});

console.log('\n探测完成。');

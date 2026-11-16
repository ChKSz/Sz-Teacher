import type { Settings } from './settings.ts';

/** 按小米 MiMo 官方语音协议合成 WAV，密钥只在服务端使用。 */
export async function synthesizeSpeech(tts: Settings['tts'], text: string, signal?: AbortSignal): Promise<Buffer> {
  if (!tts.apiKey) throw new Error('请先在设置中填写小米语音密钥');
  const abort = signal ? AbortSignal.any([signal, AbortSignal.timeout(300_000)]) : AbortSignal.timeout(300_000);
  let response: Response;
  try {
    response = await fetch(`${tts.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST', redirect: 'error', signal: abort,
      headers: { 'Content-Type': 'application/json', 'api-key': tts.apiKey },
      body: JSON.stringify({ model: tts.model, stream: false,
        messages: [...(tts.style ? [{ role: 'user', content: tts.style }] : []), { role: 'assistant', content: text }],
        audio: { format: 'wav', voice: tts.xiaomiVoice } }),
    });
  } catch {
    throw new Error(signal?.aborted ? '语音请求已取消' : abort.aborted ? '小米语音响应超时，请重试' : '无法连接小米语音服务，请检查接口地址和网络');
  }
  if (!response.ok) {
    const reason = response.status === 401 || response.status === 403 ? '语音密钥无效或没有权限' : response.status === 429 ? '语音额度不足或请求过于频繁' : response.status === 404 ? '语音模型或接口不存在' : '小米语音暂时不可用';
    throw new Error(`${reason}（${response.status}）`);
  }
  const payload = await response.json().catch(() => { throw new Error('小米语音返回的数据格式不正确'); }) as { choices?: { finish_reason?: string; message?: { audio?: { data?: string } } }[] };
  const choice = payload?.choices?.[0];
  if (choice?.finish_reason === 'length') throw new Error('语音内容过长，请缩短后重试');
  const data = choice?.message?.audio?.data;
  if (typeof data !== 'string' || !data || data.length > 128 * 1024 * 1024 || !/^[A-Za-z0-9+/=\s]+$/.test(data)) throw new Error('小米语音没有返回有效音频');
  const audio = Buffer.from(data, 'base64');
  if (audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') throw new Error('小米语音返回的音频格式不正确');
  return audio;
}

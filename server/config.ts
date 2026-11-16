import path from 'node:path';

/** 进程启动时从环境变量读取的配置。供应商设置只用作数据库里没有设置时的初始值。 */
export interface ServerConfig {
  port: number;
  host: string;
  dataDir: string;
  /** 打包后的前端目录；不存在时只提供接口。 */
  webDir: string;
  /** 只在 HTTPS 下发送 Cookie。部署在 Nginx HTTPS 后面时应开启。 */
  secureCookies: boolean;
  /** 位于反向代理后面时，从 X-Forwarded-For 取真实 IP。 */
  trustProxy: boolean;
  initialProvider: { baseUrl: string; apiKey: string; model: string };
  initialTts?: { apiKey: string };
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const root = process.cwd();
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST?.trim() || '127.0.0.1',
    dataDir: path.resolve(root, env.DATA_DIR?.trim() || 'data'),
    webDir: path.resolve(root, env.WEB_DIR?.trim() || 'dist'),
    secureCookies: flag(env.SECURE_COOKIES, false),
    trustProxy: flag(env.TRUST_PROXY, false),
    initialProvider: {
      baseUrl: env.LLM_BASE_URL?.trim() ?? '',
      apiKey: env.LLM_API_KEY?.trim() ?? '',
      model: env.LLM_MODEL?.trim() ?? '',
    },
    initialTts: { apiKey: env.MIMO_API_KEY?.trim() ?? '' },
  };
}

import path from 'node:path';

const env = process.env;

const port = Number(env.PORT || 3000);
const protocol = env.PROTOCOL || 'http';
const baseDomain = (env.BASE_DOMAIN || 'localhost').toLowerCase();
// Port yang terlihat di URL publik. Di belakang reverse proxy (443) kosongkan saja.
const publicPort = env.PUBLIC_PORT ?? (baseDomain === 'localhost' ? String(port) : '');
const portSuffix = publicPort && !['80', '443'].includes(publicPort) ? `:${publicPort}` : '';

export const config = {
  port,
  protocol,
  baseDomain,
  isProd: env.NODE_ENV === 'production',
  secureCookies: protocol === 'https',
  dataDir: path.resolve(env.DATA_DIR || 'data'),
  appOrigin: `${protocol}://${baseDomain}${portSuffix}`,
  ai: {
    // Provider apa pun yang kompatibel dengan API chat completions OpenAI.
    enabled: Boolean(env.AI_API_KEY && env.AI_BASE_URL),
    baseUrl: (env.AI_BASE_URL || '').replace(/\/+$/, ''),
    apiKey: env.AI_API_KEY || '',
    model: env.AI_MODEL || 'deepseek-v4.1-flash',
    maxTokens: Number(env.AI_MAX_TOKENS || 32000),
    monthlyCredits: Number(env.AI_MONTHLY_CREDITS || 30),
    creditsPerPrompt: Number(env.AI_CREDITS_PER_PROMPT || 1),
  },
  siteHost: (username) => `${username}.${baseDomain}`,
  siteUrl: (username) => `${protocol}://${username}.${baseDomain}${portSuffix}`,
};

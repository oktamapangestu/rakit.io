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
    model: env.AI_MODEL || 'deepseek-v4-pro',
    maxTokens: Number(env.AI_MAX_TOKENS || 64000),
    // Antrean: jumlah panggilan ke provider yang boleh berjalan bersamaan, panjang antrean, dan batas tunggu.
    maxConcurrent: Math.max(1, Number(env.AI_MAX_CONCURRENT || 4)),
    queueMax: Math.max(0, Number(env.AI_QUEUE_MAX || 30)),
    queueTimeoutMs: Math.max(5, Number(env.AI_QUEUE_TIMEOUT_S || 120)) * 1000,
    monthlyCredits: Number(env.AI_MONTHLY_CREDITS || 20),
    creditsPerPrompt: Number(env.AI_CREDITS_PER_PROMPT || 1),
  },
  billing: {
    enabled: Boolean(env.KASERA_API_KEY),
    apiKey: env.KASERA_API_KEY || '',
    webhookSecret: env.KASERA_WEBHOOK_SECRET || '',
    livemode: (env.KASERA_API_KEY || '').startsWith('kp_live_'),
    // Format: "kredit:harga,kredit:harga" (harga dalam rupiah).
    packages: (env.CREDIT_PACKAGES || '20:10000,50:20000,150:50000').split(',').map((entry) => {
      const [credits, price] = entry.split(':').map(Number);
      return { id: `p${credits}`, credits, price };
    }).filter((p) => p.credits > 0 && p.price > 0),
  },
  // Email pemilik platform yang boleh membuka dashboard /admin (dipisah koma).
  adminEmails: (env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
  siteHost: (username) => `${username}.${baseDomain}`,
  siteUrl: (username) => `${protocol}://${username}.${baseDomain}${portSuffix}`,
};

import path from 'node:path';

const env = process.env;

const port = Number(env.PORT || 3000);
const protocol = env.PROTOCOL || 'http';
const baseDomain = (env.BASE_DOMAIN || 'localhost').toLowerCase();
// Port yang terlihat di URL publik. Di belakang reverse proxy (443) kosongkan saja.
const publicPort = env.PUBLIC_PORT ?? (baseDomain === 'localhost' ? String(port) : '');
const portSuffix = publicPort && !['80', '443'].includes(publicPort) ? `:${publicPort}` : '';

function planEnv(value, key) {
  const [price, amount] = String(value).split(':').map(Number);
  return { price: price > 0 ? price : 0, [key]: amount > 0 ? amount : 0 };
}

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
    // Default kredit gratis per hari (reset 00.00 WIB, tidak menumpuk); diatur owner di dashboard.
    dailyCredits: Math.max(0, Number(env.AI_DAILY_CREDITS ?? 3) || 0),
    // Bonus kredit sekali untuk akun baru (habis pakai, tidak kembali); diatur owner di dashboard.
    bonusCredits: Math.max(0, Number(env.AI_BONUS_CREDITS ?? 20) || 0),
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
  // Langganan 30 hari. Kosongkan harga (PLAN_PRO=) untuk menyembunyikan paket.
  plans: {
    pro: planEnv(env.PLAN_PRO ?? '49000:300', 'credits'), // harga:kredit per 30 hari
    unlimited: planEnv(env.PLAN_UNLIMITED ?? '149000:60', 'dailyLimit'), // harga:prompt per hari
  },
  google: {
    // OAuth client dari Google Cloud Console (tipe "Web application").
    enabled: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || '',
  },
  maxProjects: Math.max(1, Number(env.MAX_PROJECTS || 5)),
  // Email pemilik platform yang boleh membuka dashboard /admin (dipisah koma).
  adminEmails: (env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
  siteHost: (username) => `${username}.${baseDomain}`,
  siteUrl: (username) => `${protocol}://${username}.${baseDomain}${portSuffix}`,
};

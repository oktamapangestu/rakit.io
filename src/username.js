// Username = subdomain, jadi harus valid sebagai label DNS.
export const USERNAME_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

const RESERVED = new Set([
  'www', 'app', 'api', 'admin', 'administrator', 'root', 'rakit', 'editor', 'dashboard',
  'login', 'register', 'signup', 'signin', 'logout', 'account', 'settings', 'billing',
  'mail', 'email', 'smtp', 'imap', 'pop', 'pop3', 'ftp', 'ssh', 'ns', 'ns1', 'ns2', 'dns',
  'static', 'assets', 'cdn', 'media', 'img', 'files', 'upload', 'uploads',
  'blog', 'docs', 'help', 'support', 'status', 'about', 'contact', 'security',
  'dev', 'test', 'staging', 'preview', 'demo', 'internal', 'localhost',
]);

export function usernameError(username) {
  if (username.length < 3 || username.length > 30) return 'Username harus 3–30 karakter';
  if (!USERNAME_RE.test(username)) {
    return 'Username hanya boleh huruf kecil, angka, dan tanda -, tidak diawali/diakhiri -';
  }
  if (username.includes('--')) return 'Username tidak boleh mengandung "--"';
  if (RESERVED.has(username)) return 'Username ini tidak tersedia';
  return null;
}

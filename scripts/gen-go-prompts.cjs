// Menghasilkan go/internal/ai/prompts.go dari prompt & definisi tool di src/ai.js, supaya teksnya
// persis sama. Jalankan: node scripts/gen-go-prompts.cjs
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'src/ai.js'), 'utf8');
const between = (a, b) => src.slice(src.indexOf(a), src.indexOf(b));
const code = between('const BASE_PROMPT', 'const PROMPTS = ') + between('const VISION_PROMPT', 'const IMAGE_MAX_BYTES');
const out = new Function('config', 'LIMITS', 'COLUMN_TYPES', 'OPERATIONS', `${code}; return { BUILD_PROMPT, PLAN_PROMPT, VISION_PROMPT, TOOLS };`)(
  { baseDomain: '{{BASE_DOMAIN}}' },
  { fileSize: 512 * 1024 },
  ['text', 'number', 'boolean', 'date', 'reference', 'image'],
  ['list', 'view', 'create', 'update', 'delete'],
);

// String JSON juga sah sebagai string Go, kecuali dua karakter pemisah baris Unicode.
const separators = [0x2028, 0x2029];
const lit = (s) => separators.reduce(
  (text, code) => text.split(String.fromCharCode(code)).join(`\\u${code.toString(16)}`),
  JSON.stringify(s),
);

const file = [
  '// Prompt sistem dan definisi tool untuk AI editor. Dihasilkan dari src/ai.js oleh',
  '// scripts/gen-go-prompts.cjs supaya teksnya persis sama; {{BASE_DOMAIN}} diganti dengan domain',
  '// utama saat dipakai.',
  'package ai',
  '',
  `const buildPromptTemplate = ${lit(out.BUILD_PROMPT)}`,
  '',
  `const planPromptTemplate = ${lit(out.PLAN_PROMPT)}`,
  '',
  `const visionPrompt = ${lit(out.VISION_PROMPT)}`,
  '',
  '// toolsJSON: tool mode Builder (format function calling OpenAI).',
  `const toolsJSON = ${lit(JSON.stringify(out.TOOLS))}`,
  '',
].join('\n');
fs.writeFileSync(path.join(root, 'go/internal/ai/prompts.go'), file);
console.log('prompts.go ditulis:', out.BUILD_PROMPT.length, out.PLAN_PROMPT.length, out.VISION_PROMPT.length);

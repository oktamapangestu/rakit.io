// Driver Claude Agent SDK untuk evaluasi rakit (scripts/ai-eval/sandbox-engines.mjs).
//
// Protokol: perintah JSON per baris di stdin ({"type": "prompt", "message": ...}), diteruskan ke satu sesi query()
// (streaming input, jadi prompt lanjutan masuk ke percakapan yang sama). Ke stdout ditulis baris "@@RAKIT {...}":
// tool yang dipanggil, hasil tool, error, dan "settled" (jawaban akhir + token kumulatif) setiap kali satu giliran
// selesai. Model lewat endpoint Anthropic-compatible provider (ANTHROPIC_BASE_URL), model dari RAKIT_MODEL.
//
// Agen: tool bawaan Claude Code (Bash, Read, Write, Edit, Glob, Grep, TodoWrite) + create_table (MCP dalam proses,
// skema sama dengan Builder dari $RAKIT_RUN/create_table.json), dijalankan lewat bridge HTTP di host. Aturan rakit
// ditambahkan ke prompt sistem bawaan Claude Code (preset claude_code + append), atau — mode AGENTS.md — dimuat
// Claude Code sendiri dari /workspace/AGENTS.md.
import fs from 'node:fs';
import readline from 'node:readline';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

const RUN = process.env.RAKIT_RUN;
const emit = (obj) => process.stdout.write(`@@RAKIT ${JSON.stringify(obj)}\n`);

const spec = JSON.parse(fs.readFileSync(`${RUN}/create_table.json`, 'utf8'));
const props = spec.parameters.properties;
const col = props.columns.items.properties;
// Endpoint Anthropic-compatible kelontongai menolak (400 "URL atau data gambar wajib diisi") setiap request yang
// riwayatnya berisi objek {"type": "image"} — termasuk argumen tool_use biasa seperti kolom bertipe image. Jadi tipe
// "picture" juga diterima (dan disarankan) untuk kolom gambar; bridge mengembalikannya ke "image". Proxy AI mode Agen
// mengganti "image" di riwayat menjadi "picture" (go/internal/ai/agentproxy.go).
const columnTypes = [...col.type.enum, 'picture'];
const createTable = tool('create_table', spec.description, {
  name: z.string().describe(props.name.description),
  columns: z.array(z.object({
    name: z.string().describe(col.name.description),
    type: z.enum(columnTypes).describe(`${col.type.description} Use "picture" for an uploaded image.`),
    refTable: z.string().optional().describe(col.refTable.description),
    required: z.boolean().optional(),
    private: z.boolean().optional().describe(col.private.description),
  })),
  public: z.array(z.enum(props.public.items.enum)).describe(props.public.description),
}, async (args) => {
  const res = await fetch(`${process.env.RAKIT_BRIDGE}/create_table`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...args, columns: args.columns.map((c) => (c.type === 'picture' ? { ...c, type: 'image' } : c)) }),
  });
  return { content: [{ type: 'text', text: await res.text() }], isError: !res.ok };
});

// Antrean pesan pengguna untuk streaming input.
const pending = [];
let wake = null;
let closed = false;
async function* userMessages() {
  for (;;) {
    while (pending.length) yield pending.shift();
    if (closed) return;
    await new Promise((resolve) => { wake = resolve; });
  }
}
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let cmd;
  try { cmd = JSON.parse(line); } catch { return; }
  if (cmd.type !== 'prompt') return;
  pending.push({ type: 'user', message: { role: 'user', content: cmd.message }, parent_tool_use_id: null });
  wake?.();
});
rl.on('close', () => { closed = true; wake?.(); });

const model = process.env.RAKIT_MODEL;
const agentsMd = process.env.RAKIT_AGENTS_MD === '1';
const skill = process.env.RAKIT_SKILL === '1';
let lastText = '';
try {
  for await (const msg of query({
    prompt: userMessages(),
    options: {
      cwd: '/workspace',
      model,
      fallbackModel: undefined,
      tools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'TodoWrite', ...(skill ? ['Skill'] : [])],
      // Mode skill (RAKIT_SKILL=1): ~/.claude/skills/rakit/SKILL.md (skill pengguna) diaktifkan.
      ...(skill ? { skills: ['rakit'] } : {}),
      mcpServers: { rakit: createSdkMcpServer({ name: 'rakit', version: '1.0.0', tools: [createTable] }) },
      allowedTools: ['mcp__rakit__create_table'],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      // Mode AGENTS.md (RAKIT_AGENTS_MD=1): Claude Code memuat /workspace/AGENTS.md sendiri sebagai instruksi project
      // (tidak ada CLAUDE.md); settingSources 'project' diperlukan untuk itu.
      systemPrompt: { type: 'preset', preset: 'claude_code', ...(agentsMd ? {} : { append: fs.readFileSync(`${RUN}/prompt.md`, 'utf8') }) },
      settingSources: [...(skill ? ['user'] : []), ...(agentsMd ? ['project'] : [])],
      persistSession: false,
      maxTurns: 100,
      env: { ...process.env, ANTHROPIC_DEFAULT_HAIKU_MODEL: model, ANTHROPIC_DEFAULT_SONNET_MODEL: model, ANTHROPIC_DEFAULT_OPUS_MODEL: model, CLAUDE_CODE_SUBAGENT_MODEL: model },
      stderr: (data) => process.stderr.write(data),
    },
  })) {
    if (msg.type === 'assistant') {
      for (const block of msg.message.content ?? []) {
        if (block.type === 'tool_use') emit({ type: 'tool', name: block.name.replace(/^mcp__rakit__/, ''), args: block.input, response: msg.message.id });
        if (block.type === 'text' && block.text.trim()) lastText = block.text.trim();
      }
      if (msg.error) emit({ type: 'error', message: String(msg.error) });
    }
    if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
      for (const block of msg.message.content) {
        if (block.type !== 'tool_result') continue;
        const text = typeof block.content === 'string' ? block.content : (block.content ?? []).map((c) => c.text ?? '').join('');
        emit({ type: 'result', name: '', error: Boolean(block.is_error), text: text.slice(0, 2000) });
      }
    }
    if (msg.type === 'result') {
      const usage = Object.values(msg.modelUsage ?? {}).reduce((a, u) => ({
        prompt: a.prompt + (u.inputTokens ?? 0) + (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0),
        completion: a.completion + (u.outputTokens ?? 0),
      }), { prompt: 0, completion: 0 });
      if (msg.subtype !== 'success' || msg.is_error) emit({ type: 'error', message: `${msg.subtype}: ${String(msg.result ?? msg.errors ?? '').slice(0, 400)}` });
      emit({ type: 'settled', text: msg.subtype === 'success' && !msg.is_error ? msg.result || lastText : lastText, usage, turns: msg.num_turns });
    }
  }
} catch (err) {
  emit({ type: 'error', message: `${err.name}: ${err.message}`.slice(0, 500) });
  emit({ type: 'settled', text: lastText, usage: { prompt: 0, completion: 0 } });
}

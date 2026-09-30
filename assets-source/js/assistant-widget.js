// Widget Asisten AI untuk website di rakit.icu.
// Pasang: <script src="/api/ai/widget.js" defer></script>
// Opsi (atribut di tag script): data-color="#8b5cf6", data-position="left", data-open="true".
// Bisa juga dibuka lewat JavaScript: rakitAssistant.open() / rakitAssistant.close().
(() => {
  'use strict';
  if (window.rakitAssistant) return; // sudah terpasang

  const script = document.currentScript;
  const color = /^#[0-9a-f]{3,8}$/i.test(script?.dataset.color ?? '') ? script.dataset.color : '#8b5cf6';
  const left = script?.dataset.position === 'left';
  const STORE = 'rakit-asisten';
  const MAX_HISTORY = 20;

  let messages = [];
  try { messages = JSON.parse(sessionStorage.getItem(STORE) || '[]'); } catch { messages = []; }
  const save = () => { try { sessionStorage.setItem(STORE, JSON.stringify(messages.slice(-MAX_HISTORY))); } catch { /* abaikan */ } };

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .wrap { position: fixed; bottom: 20px; ${left ? 'left' : 'right'}: 20px; z-index: 2147483000;
      font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #111827; }
    .bubble { width: 56px; height: 56px; border: 0; border-radius: 50%; background: var(--c); color: #fff; cursor: pointer;
      display: grid; place-items: center; box-shadow: 0 10px 28px rgb(0 0 0 / 0.25); transition: transform .15s; }
    .bubble:hover { transform: scale(1.06); }
    .bubble svg { width: 26px; height: 26px; fill: currentColor; }
    .panel { position: absolute; bottom: 70px; ${left ? 'left' : 'right'}: 0; width: 360px; height: min(560px, calc(100vh - 110px));
      display: flex; flex-direction: column; overflow: hidden; border-radius: 18px; background: #fff;
      box-shadow: 0 20px 60px rgb(0 0 0 / 0.25); animation: in .18s ease-out; }
    .panel[hidden] { display: none; }
    @keyframes in { from { opacity: 0; transform: translateY(10px); } }
    header { display: flex; align-items: center; gap: 10px; padding: 14px 16px; background: var(--c); color: #fff; }
    header .dot { width: 34px; height: 34px; border-radius: 50%; background: rgb(255 255 255 / .22); display: grid; place-items: center; }
    header .dot svg { width: 18px; height: 18px; fill: #fff; }
    header strong { display: block; font-size: 15px; }
    header small { opacity: .85; font-size: 12px; }
    header button { margin-left: auto; width: 32px; height: 32px; border: 0; border-radius: 8px; background: transparent; color: #fff; font-size: 20px; cursor: pointer; }
    header button:hover { background: rgb(255 255 255 / .15); }
    .log { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; background: #f9fafb; }
    .msg { max-width: 85%; padding: 9px 13px; border-radius: 16px; white-space: pre-wrap; word-wrap: break-word; }
    .msg.bot { align-self: flex-start; background: #fff; border: 1px solid #e5e7eb; border-bottom-left-radius: 4px; }
    .msg.me { align-self: flex-end; background: var(--c); color: #fff; border-bottom-right-radius: 4px; }
    .msg.err { align-self: center; max-width: 100%; background: #fef2f2; color: #b91c1c; font-size: 13px; border-radius: 10px; }
    .typing { display: inline-flex; gap: 4px; }
    .typing i { width: 6px; height: 6px; border-radius: 50%; background: #9ca3af; animation: b 1s infinite; }
    .typing i:nth-child(2) { animation-delay: .15s; } .typing i:nth-child(3) { animation-delay: .3s; }
    @keyframes b { 0%, 80%, 100% { opacity: .3; } 40% { opacity: 1; } }
    form { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #e5e7eb; background: #fff; }
    textarea { flex: 1; resize: none; max-height: 110px; padding: 9px 12px; border: 1px solid #d1d5db; border-radius: 12px;
      font: inherit; color: inherit; outline: none; }
    textarea:focus { border-color: var(--c); }
    .send { width: 40px; border: 0; border-radius: 12px; background: var(--c); color: #fff; cursor: pointer; display: grid; place-items: center; }
    .send:disabled { opacity: .5; cursor: default; }
    .send svg { width: 18px; height: 18px; fill: currentColor; }
    .foot { padding: 0 12px 8px; background: #fff; color: #9ca3af; font-size: 11px; text-align: center; }
    @media (max-width: 480px) {
      .wrap { bottom: 14px; ${left ? 'left' : 'right'}: 14px; }
      .panel { position: fixed; inset: auto 8px 84px 8px; width: auto; height: calc(100vh - 110px); }
    }
    @media (prefers-reduced-motion: reduce) { .panel, .typing i { animation: none; } }
  `;
  const ICON_CHAT = 'M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2m3 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3m5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3m5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3';
  const ICON_SPARK = 'M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z';
  const ICON_SEND = 'M3 20.5v-6l8-2.5-8-2.5v-6L22 12z';
  const icon = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;

  async function start() {
    let cfg;
    try {
      cfg = await (await fetch('/api/ai/config', { cache: 'no-store' })).json();
    } catch {
      return;
    }
    if (!cfg.enabled) {
      console.info('[rakit] Asisten AI belum aktif. Aktifkan di editor: menu avatar → Asisten AI website.');
      return;
    }

    const host = document.createElement('div');
    host.id = 'rakit-asisten';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style>
      <div class="wrap" style="--c:${color}">
        <div class="panel" role="dialog" aria-label="Chat dengan asisten" hidden>
          <header><span class="dot">${icon(ICON_SPARK)}</span><div><strong></strong><small>Biasanya membalas dalam hitungan detik</small></div>
            <button type="button" class="close" aria-label="Tutup chat">×</button></header>
          <div class="log" aria-live="polite"></div>
          <form><textarea rows="1" placeholder="Tulis pesan…" aria-label="Pesan"></textarea>
            <button class="send" type="submit" aria-label="Kirim">${icon(ICON_SEND)}</button></form>
          <div class="foot">Jawaban dibuat AI, bisa saja keliru.</div>
        </div>
        <button type="button" class="bubble" aria-label="Buka chat">${icon(ICON_CHAT)}</button>
      </div>`;
    document.body.append(host);

    const $ = (s) => root.querySelector(s);
    const panel = $('.panel');
    const log = $('.log');
    const input = $('textarea');
    const sendBtn = $('.send');
    $('header strong').textContent = cfg.name;
    let busy = false;

    const add = (cls, text) => {
      const el = document.createElement('div');
      el.className = `msg ${cls}`;
      el.textContent = text;
      log.append(el);
      log.scrollTop = log.scrollHeight;
      return el;
    };
    const render = () => {
      log.replaceChildren();
      add('bot', cfg.greeting);
      for (const m of messages) add(m.role === 'user' ? 'me' : 'bot', m.content);
    };
    const open = () => { panel.hidden = false; input.focus(); log.scrollTop = log.scrollHeight; };
    const close = () => { panel.hidden = true; };

    async function send(text) {
      if (busy || !text.trim()) return;
      busy = true;
      sendBtn.disabled = true;
      messages.push({ role: 'user', content: text.trim() });
      save();
      add('me', text.trim());
      const reply = add('bot', '');
      reply.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
      let answer = '';
      try {
        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: messages.slice(-MAX_HISTORY), stream: true }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Asisten sedang tidak bisa menjawab.');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            const event = JSON.parse(line);
            if (event.type === 'delta') {
              answer += event.text;
              reply.textContent = answer;
              log.scrollTop = log.scrollHeight;
            } else if (event.type === 'error') {
              throw new Error(event.error);
            }
          }
        }
        if (!answer) throw new Error('Asisten tidak memberi jawaban. Coba lagi.');
        messages.push({ role: 'assistant', content: answer });
        save();
      } catch (err) {
        if (!answer) {
          reply.remove();
          messages.pop(); // pesan yang gagal dijawab tidak ikut dikirim lagi sebagai riwayat
          save();
        }
        add('err', err.message || 'Asisten sedang tidak bisa menjawab.');
      } finally {
        busy = false;
        sendBtn.disabled = false;
        input.focus();
      }
    }

    $('.bubble').addEventListener('click', () => (panel.hidden ? open() : close()));
    $('.close').addEventListener('click', close);
    $('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value;
      input.value = '';
      input.style.height = '';
      send(text);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        $('form').requestSubmit();
      }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 110)}px`;
    });

    render();
    window.rakitAssistant = { open, close };
    if (script?.dataset.open === 'true') open();
  }

  window.rakitAssistant = { open() {}, close() {} }; // placeholder sampai konfigurasi dimuat
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

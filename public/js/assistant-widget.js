(()=>{"use strict";if(window.rakitAssistant)return;const p=document.currentScript,T=/^#[0-9a-f]{3,8}$/i.test(p?.dataset.color??"")?p.dataset.color:"#8b5cf6",b=p?.dataset.position==="left",k="rakit-asisten",S=20;let r=[];try{r=JSON.parse(sessionStorage.getItem(k)||"[]")}catch{r=[]}const u=()=>{try{sessionStorage.setItem(k,JSON.stringify(r.slice(-S)))}catch{}},$=`
    :host { all: initial; }
    * { box-sizing: border-box; }
    .wrap { position: fixed; bottom: 20px; ${b?"left":"right"}: 20px; z-index: 2147483000;
      font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #111827; }
    .bubble { width: 56px; height: 56px; border: 0; border-radius: 50%; background: var(--c); color: #fff; cursor: pointer;
      display: grid; place-items: center; box-shadow: 0 10px 28px rgb(0 0 0 / 0.25); transition: transform .15s; }
    .bubble:hover { transform: scale(1.06); }
    .bubble svg { width: 26px; height: 26px; fill: currentColor; }
    .panel { position: absolute; bottom: 70px; ${b?"left":"right"}: 0; width: 360px; height: min(560px, calc(100vh - 110px));
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
      .wrap { bottom: 14px; ${b?"left":"right"}: 14px; }
      .panel { position: fixed; inset: auto 8px 84px 8px; width: auto; height: calc(100vh - 110px); }
    }
    @media (prefers-reduced-motion: reduce) { .panel, .typing i { animation: none; } }
  `,O="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2m3 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3m5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3m5 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3",z="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z",I="M3 20.5v-6l8-2.5-8-2.5v-6L22 12z",h=s=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${s}"/></svg>`;async function A(){let s;try{s=await(await fetch("/api/ai/config",{cache:"no-store"})).json()}catch{return}if(!s.enabled){console.info("[rakit] Asisten AI belum aktif. Aktifkan di editor: menu avatar \u2192 Asisten AI website.");return}const g=document.createElement("div");g.id="rakit-asisten";const C=g.attachShadow({mode:"open"});C.innerHTML=`<style>${$}</style>
      <div class="wrap" style="--c:${T}">
        <div class="panel" role="dialog" aria-label="Chat dengan asisten" hidden>
          <header><span class="dot">${h(z)}</span><div><strong></strong><small>Biasanya membalas dalam hitungan detik</small></div>
            <button type="button" class="close" aria-label="Tutup chat">\xD7</button></header>
          <div class="log" aria-live="polite"></div>
          <form><textarea rows="1" placeholder="Tulis pesan\u2026" aria-label="Pesan"></textarea>
            <button class="send" type="submit" aria-label="Kirim">${h(I)}</button></form>
          <div class="foot">Jawaban dibuat AI, bisa saja keliru.</div>
        </div>
        <button type="button" class="bubble" aria-label="Buka chat">${h(O)}</button>
      </div>`,document.body.append(g);const o=e=>C.querySelector(e),x=o(".panel"),i=o(".log"),t=o("textarea"),E=o(".send");o("header strong").textContent=s.name;let m=!1;const d=(e,n)=>{const a=document.createElement("div");return a.className=`msg ${e}`,a.textContent=n,i.append(a),i.scrollTop=i.scrollHeight,a},H=()=>{i.replaceChildren(),d("bot",s.greeting);for(const e of r)d(e.role==="user"?"me":"bot",e.content)},y=()=>{x.hidden=!1,t.focus(),i.scrollTop=i.scrollHeight},w=()=>{x.hidden=!0};async function N(e){if(m||!e.trim())return;m=!0,E.disabled=!0,r.push({role:"user",content:e.trim()}),u(),d("me",e.trim());const n=d("bot","");n.innerHTML='<span class="typing"><i></i><i></i><i></i></span>';let a="";try{const l=await fetch("/api/ai/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:r.slice(-S),stream:!0})});if(!l.ok)throw new Error((await l.json().catch(()=>({}))).error||"Asisten sedang tidak bisa menjawab.");const M=l.body.getReader(),j=new TextDecoder;let c="";for(;;){const{value:D,done:J}=await M.read();if(J)break;c+=j.decode(D,{stream:!0});let v;for(;(v=c.indexOf(`
`))>=0;){const L=c.slice(0,v).trim();if(c=c.slice(v+1),!L)continue;const f=JSON.parse(L);if(f.type==="delta")a+=f.text,n.textContent=a,i.scrollTop=i.scrollHeight;else if(f.type==="error")throw new Error(f.error)}}if(!a)throw new Error("Asisten tidak memberi jawaban. Coba lagi.");r.push({role:"assistant",content:a}),u()}catch(l){a||(n.remove(),r.pop(),u()),d("err",l.message||"Asisten sedang tidak bisa menjawab.")}finally{m=!1,E.disabled=!1,t.focus()}}o(".bubble").addEventListener("click",()=>x.hidden?y():w()),o(".close").addEventListener("click",w),o("form").addEventListener("submit",e=>{e.preventDefault();const n=t.value;t.value="",t.style.height="",N(n)}),t.addEventListener("keydown",e=>{e.key==="Enter"&&!e.shiftKey&&(e.preventDefault(),o("form").requestSubmit())}),t.addEventListener("input",()=>{t.style.height="auto",t.style.height=`${Math.min(t.scrollHeight,110)}px`}),H(),window.rakitAssistant={open:y,close:w},p?.dataset.open==="true"&&y()}window.rakitAssistant={open(){},close(){}},document.readyState==="loading"?document.addEventListener("DOMContentLoaded",A):A()})();

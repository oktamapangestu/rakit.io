// Halaman /desktop/authorize: pengguna rakit.io menyetujui login aplikasi desktop (lihat go/internal/api/sync.go).
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const en = /(?:^|;\s*)lang=en(?:;|$)/.test(document.cookie);
  const T = en
    ? {
        title: 'Sign in to the desktop app',
        loading: 'Loading…',
        loginLead: 'Log in to your rakit.io account first. You will come back to this page afterwards.',
        loginBtn: 'Log in',
        askLead: 'wants to access the account',
        codeLead: 'Make sure this code matches the one shown in the app:',
        askNote: 'The app will be able to see your projects, download them, and publish changes to rakit.io. You can revoke access by pressing Log out in the app.',
        approve: 'Allow',
        deny: 'Deny',
        done: 'Done. Go back to the desktop app — you are signed in there.',
        closeTab: 'You can close this tab.',
        denied: 'Request denied. The desktop app did not get access.',
        noCode: 'The sign-in code is missing. Start again from the desktop app.',
        failed: 'Something went wrong. Try again.',
      }
    : {
        noCode: 'Kode login tidak ada. Mulai lagi dari aplikasi desktop.',
        failed: 'Terjadi kesalahan. Coba lagi.',
      };
  if (en) {
    document.documentElement.lang = 'en';
    document.title = T.title + ' — rakit.io';
    $('#title').textContent = T.title;
    document.querySelectorAll('[data-t]').forEach((el) => {
      if (T[el.dataset.t]) el.textContent = T[el.dataset.t];
    });
  }

  const sections = ['loading', 'login', 'ask', 'done', 'denied'];
  const show = (name) => sections.forEach((s) => { $('#' + s).hidden = s !== name; });
  const fail = (msg) => {
    $('#error').textContent = msg || T.failed;
    $('#error').hidden = false;
  };

  const code = new URLSearchParams(location.search).get('code') || '';
  if (!code) {
    show('');
    fail(T.noCode);
    return;
  }

  fetch('/api/sync/device/' + encodeURIComponent(code), { credentials: 'same-origin' })
    .then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) return show('login');
      if (!res.ok) {
        show('');
        return fail(data.error);
      }
      $('#device').textContent = data.name;
      $('#user').textContent = data.user.username;
      $('#code').textContent = data.code;
      show(data.approved ? 'done' : 'ask');
    })
    .catch(() => { show(''); fail(); });

  async function answer(approve) {
    $('#approve').disabled = $('#deny').disabled = true;
    $('#error').hidden = true;
    try {
      const res = await fetch('/api/sync/device/approve', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, approve }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
      show(approve ? 'done' : 'denied');
    } catch (e) {
      fail(e.message);
      $('#approve').disabled = $('#deny').disabled = false;
    }
  }
  $('#approve').addEventListener('click', () => answer(true));
  $('#deny').addEventListener('click', () => answer(false));
})();

(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const registerForm = $('#registerForm');
  const loginForm = $('#loginForm');
  const forgotForm = $('#forgotForm');
  const resetForm = $('#resetForm');
  const forms = { register: registerForm, login: loginForm, forgot: forgotForm, reset: resetForm };
  let baseDomain = 'rakit.io';
  let googleEnabled = false;
  let current = 'register';
  // Tombol Google hanya untuk daftar/masuk, tidak saat lupa/ganti password.
  const updateGoogle = () => { $('#googleBox').hidden = !googleEnabled || current === 'forgot' || current === 'reset'; };

  fetch('/api/config')
    .then((r) => r.json())
    .then((cfg) => {
      baseDomain = cfg.baseDomain;
      googleEnabled = cfg.googleEnabled;
      updateGoogle();
      $('#forgotLink').hidden = !cfg.passwordReset;
      updateDomain();
    })
    .catch(() => {});

  // Pesan dari alur login Google (mis. dibatalkan atau email sudah terdaftar).
  const oauthError = new URLSearchParams(location.search).get('error');
  if (oauthError) {
    $('#oauthError').textContent = oauthError;
    history.replaceState(null, '', location.pathname);
  }

  // name: register | login | forgot (minta link ganti password) | reset (password baru dari link email).
  function showTab(name) {
    const tab = name === 'register' ? 'register' : 'login';
    document.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.setAttribute('aria-selected', String(btn.dataset.tab === tab));
    });
    current = name;
    for (const [key, form] of Object.entries(forms)) form.hidden = key !== name;
    updateGoogle();
    forms[name].querySelector('input:not([type=hidden])').focus();
  }

  document.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });
  document.querySelectorAll('[data-go]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      showTab(link.dataset.go);
      $('#auth').scrollIntoView({ behavior: 'smooth' });
    });
  });

  const usernameInput = registerForm.elements.username;
  function updateDomain() {
    const name = usernameInput.value || 'namamu';
    $('#previewDomain').textContent = `${name}.${baseDomain}`;
    $('#heroUser').textContent = name;
    $('.domain .base').textContent = baseDomain;
  }
  usernameInput.addEventListener('input', () => {
    const cleaned = usernameInput.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (cleaned !== usernameInput.value) usernameInput.value = cleaned;
    updateDomain();
  });

  async function submit(form, url) {
    const errorEl = $('.error', form);
    const button = $('button[type=submit]', form);
    errorEl.textContent = '';
    button.disabled = true;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Gagal (${res.status})`);
      location.href = '/editor';
    } catch (err) {
      errorEl.textContent = err.message;
      button.disabled = false;
    }
  }

  // Lupa password: jawaban server selalu sama, ada akunnya atau tidak.
  forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = $('.error', forgotForm);
    const notice = $('.notice', forgotForm);
    const button = $('button[type=submit]', forgotForm);
    errorEl.textContent = '';
    notice.textContent = '';
    button.disabled = true;
    try {
      const res = await fetch('/api/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(forgotForm))),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Gagal (${res.status})`);
      notice.textContent = 'Kalau akunnya terdaftar, link untuk membuat password baru sudah dikirim ke emailnya. Cek juga folder spam.';
    } catch (err) {
      errorEl.textContent = err.message;
    }
    button.disabled = false;
  });

  // Link dari email lupa password: /#reset=<token>. Token langsung dihapus dari alamat halaman.
  const resetToken = /^#reset=([\w-]+)$/.exec(location.hash)?.[1];
  if (resetToken) {
    history.replaceState(null, '', location.pathname);
    resetForm.elements.token.value = resetToken;
    showTab('reset');
    $('#auth').scrollIntoView();
  }
  resetForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(resetForm, '/api/reset-password');
  });

  registerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(registerForm, '/api/register');
  });
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(loginForm, '/api/login');
  });

  // Download desktop: sorot tombol untuk OS pengunjung (Windows / macOS / Linux) dan taruh paling atas.
  const ua = `${navigator.userAgentData?.platform ?? ''} ${navigator.platform ?? ''} ${navigator.userAgent}`.toLowerCase();
  const os = /android|iphone|ipad/.test(ua) ? '' : /win/.test(ua) ? 'windows' : /mac/.test(ua) ? 'mac' : /linux|x11/.test(ua) ? 'linux' : '';
  if (os) document.querySelector(`.os-btn[data-os="${os}"]`)?.classList.add('recommended');
})();

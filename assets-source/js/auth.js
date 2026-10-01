(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const registerForm = $('#registerForm');
  const loginForm = $('#loginForm');
  let baseDomain = 'rakit.io';

  fetch('/api/config')
    .then((r) => r.json())
    .then((cfg) => {
      baseDomain = cfg.baseDomain;
      $('#googleBox').hidden = !cfg.googleEnabled;
      updateDomain();
    })
    .catch(() => {});

  // Pesan dari alur login Google (mis. dibatalkan atau email sudah terdaftar).
  const oauthError = new URLSearchParams(location.search).get('error');
  if (oauthError) {
    $('#oauthError').textContent = oauthError;
    history.replaceState(null, '', location.pathname);
  }

  function showTab(name) {
    document.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.setAttribute('aria-selected', String(btn.dataset.tab === name));
    });
    registerForm.hidden = name !== 'register';
    loginForm.hidden = name !== 'login';
    (name === 'register' ? registerForm : loginForm).querySelector('input').focus();
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

  registerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(registerForm, '/api/register');
  });
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(loginForm, '/api/login');
  });
})();

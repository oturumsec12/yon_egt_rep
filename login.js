import { api, setToken, rolePage, showMessage } from './common.js';
const form = document.getElementById('loginForm');
const code = document.getElementById('code');
const error = document.getElementById('loginError');
const button = document.getElementById('loginButton');
let submitting = false;
code.addEventListener('input', () => {
  code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  code.setAttribute('aria-invalid', 'false');
  showMessage(error, '');
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting) return;
  if (!/^[A-Z0-9]{6}$/.test(code.value)) {
    showMessage(error, 'Lütfen 6 karakterli giriş kodunuzu yazın.', 'error');
    code.setAttribute('aria-invalid', 'true'); code.focus(); return;
  }
  submitting = true; button.disabled = true; button.textContent = 'Giriş yapılıyor…';
  showMessage(error, '');
  try {
    const result = await api('login', { code: code.value });
    if (!/^[a-f0-9]{64}$/i.test(result.token) || rolePage(result.actor?.role) === 'index.html') throw new Error('Giriş yanıtı doğrulanamadı. Yeniden deneyin.');
    setToken(result.token); location.replace(rolePage(result.actor.role));
  } catch (caught) { showMessage(error, caught.message, 'error'); }
  finally { submitting = false; button.disabled = false; button.textContent = 'Giriş yap'; }
});

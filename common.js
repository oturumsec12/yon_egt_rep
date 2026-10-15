import { SUPABASE_URL, EDGE_FUNCTION } from './config.js';

const SESSION_KEY = 'egitim_session_v1';
let serverTime = Date.now();
let clockStarted = performance.now();
export const getToken = () => sessionStorage.getItem(SESSION_KEY) || '';
export const setToken = token => sessionStorage.setItem(SESSION_KEY, token);
export const clearSession = () => sessionStorage.removeItem(SESSION_KEY);
export function rolePage(role) {
  return ({ MANAGER: 'secim.html', GROUP_ADMIN: 'admin.html', SUPER_ADMIN: 'super_admin.html' })[role] || 'index.html';
}
export function requireSession() {
  if (getToken()) return true;
  location.replace('index.html');
  return false;
}
export function requireRole(actor, roles) {
  if (roles.includes(actor?.role)) return true;
  location.replace(rolePage(actor?.role));
  return false;
}
export function syncClock(iso) {
  const value = Date.parse(iso);
  if (!Number.isFinite(value)) throw new Error('Sunucu zamanı alınamadı. Sayfayı yenileyin.');
  serverTime = value;
  clockStarted = performance.now();
}
export const now = () => serverTime + performance.now() - clockStarted;
export const deadlineOpen = group => !!group && Number.isFinite(Date.parse(group.selection_deadline)) && now() < Date.parse(group.selection_deadline);
export async function api(action, fields = {}) {
  if (!['login', 'health'].includes(action) && !getToken()) {
    location.replace('index.html');
    throw new Error('Oturumunuz sona erdi. Yeniden giriş yapın.');
  }
  if (!/^https:\/\/[^/]+\.supabase\.co\/?$/.test(SUPABASE_URL) || SUPABASE_URL.includes('PROJE_KIMLIGI')) {
    throw new Error('Uygulama bağlantısı henüz yapılandırılmamış. Kurulum sorumlusuna başvurun.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  let response;
  try {
    response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/${EDGE_FUNCTION}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(getToken() ? { 'X-Session-Token': getToken() } : {}) },
      body: JSON.stringify({ action, ...fields }), signal: controller.signal,
    });
  } catch (error) {
    throw new Error(error.name === 'AbortError' ? 'İstek zaman aşımına uğradı. Bağlantınızı kontrol edip yeniden deneyin.' : 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edip yeniden deneyin.');
  } finally { clearTimeout(timer); }
  if (response.status === 401 && action !== 'login') {
    clearSession();
    location.replace('index.html');
    throw new Error('Oturumunuz sona erdi. Yeniden giriş yapın.');
  }
  let result;
  try { result = await response.json(); } catch { throw new Error('Sunucudan geçerli yanıt alınamadı. Yeniden deneyin.'); }
  if (!response.ok || !result.ok) throw new Error(result.error || 'İşlem tamamlanamadı. Yeniden deneyin.');
  return result;
}
export async function bootstrap() {
  const result = await api('bootstrap');
  syncClock(result.serverNow);
  return result;
}
export async function logout() {
  try { if (getToken()) await api('logout'); } catch { /* Yerel oturum her durumda kapatılır. */ }
  finally { clearSession(); location.replace('index.html'); }
}
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function formatDate(iso) {
  return new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' }).format(new Date(`${iso}T12:00:00+03:00`));
}
export const slotLabel = slot => `${formatDate(slot.slot_date)} ${slot.start_time.slice(0, 5)} - ${slot.end_time.slice(0, 5)}`;
export function formatDeadline(iso) {
  return new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
export function localDateTime(iso) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const part = type => parts.find(p => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
export function showMessage(element, message, type = 'info') {
  element.textContent = message;
  element.className = `message ${type}`;
  element.hidden = !message;
}
export function confirmAction(title, message, confirmText = 'Onayla') {
  const dialog = document.getElementById('confirmDialog');
  const confirm = document.getElementById('dialogConfirm');
  const cancel = document.getElementById('dialogCancel');
  document.getElementById('dialogTitle').textContent = title;
  document.getElementById('dialogMessage').textContent = message;
  confirm.textContent = confirmText;
  const previousFocus = document.activeElement;
  return new Promise(resolve => {
    const finish = value => {
      confirm.removeEventListener('click', accept);
      cancel.removeEventListener('click', decline);
      dialog.removeEventListener('cancel', escape);
      dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus();
      resolve(value);
    };
    const accept = () => finish(true);
    const decline = () => finish(false);
    const escape = event => { event.preventDefault(); finish(false); };
    confirm.addEventListener('click', accept);
    cancel.addEventListener('click', decline);
    dialog.addEventListener('cancel', escape);
    dialog.showModal();
    cancel.focus();
  });
}

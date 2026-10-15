import { api, bootstrap, requireSession, requireRole, getToken, logout, deadlineOpen, formatDeadline, formatDate, escapeHtml, showMessage, confirmAction } from './common.js';

const el = id => document.getElementById(id);
let snapshot = null;
let saved = new Set();
let draft = new Set();
let needsReview = false;
let saving = false;
let refreshing = false;
const sameSet = (a, b) => a.size === b.size && [...a].every(id => b.has(id));
const dirty = () => !sameSet(saved, draft);
const group = () => snapshot?.groups.find(value => value.code === snapshot.actor.group_code);

function updateControls() {
  if (!snapshot) return;
  const open = deadlineOpen(group());
  const pending = dirty();
  el('deadlineState').textContent = open ? 'Seçim süresi açık' : 'Seçim süresi sona erdi';
  el('deadlineState').className = `badge ${open ? 'available' : 'neutral'}`;
  el('selectionCount').textContent = `${draft.size} oturum seçildi${pending ? ' · Kaydedilmemiş değişiklikler var' : ' · Kaydedilmiş seçimler'}`;
  el('saveSelections').disabled = saving || refreshing || !open || !pending || (needsReview && !el('reviewChanges').checked);
  el('saveSelections').textContent = saving ? 'Kaydediliyor…' : 'Seçimleri kaydet';
  el('discardChanges').disabled = saving || !pending;
  el('refreshBtn').disabled = saving || refreshing;
  el('reviewArea').hidden = !needsReview || !pending;
  el('calendar').querySelectorAll('input[type="checkbox"]').forEach(input => { input.disabled = saving || !open; });
  if (!open) showMessage(el('draftMessage'), pending ? 'Seçim süresi sona erdi. Kaydedilmemiş değişiklikler uygulanamaz; kaydedilmiş seçimlerinizi görmek için Vazgeç düğmesini kullanabilirsiniz.' : 'Seçim süresi sona erdi. Kaydedilmiş seçimlerinizi görüntüleyebilirsiniz.', 'info');
  else if (needsReview && pending) showMessage(el('draftMessage'), 'Ekrandaki bilgiler değişti. Taslağınız korundu; kaldırılan oturumlar taslaktan çıkarıldı. Güncel oturumları gözden geçirip onay kutusunu işaretledikten sonra tekrar kaydedin.', 'warning');
  else showMessage(el('draftMessage'), pending ? 'Değişiklikleriniz henüz kaydedilmedi.' : '', 'info');
}

function renderSlots() {
  const slots = snapshot.slots.filter(slot => slot.group_code === snapshot.actor.group_code).sort((a, b) => `${a.slot_date} ${a.start_time}`.localeCompare(`${b.slot_date} ${b.start_time}`));
  el('calendar').innerHTML = slots.length ? slots.map(slot => {
    const selected = draft.has(slot.id);
    return `<label class="slot-card selectable ${selected ? 'selected' : 'available'}" data-slot-id="${escapeHtml(slot.id)}">
      <span class="slot-top"><span class="badge ${selected ? 'selected' : 'available'}">${selected ? 'Seçildi' : 'Uygun'}</span><input type="checkbox" name="slot_ids" value="${escapeHtml(slot.id)}" ${selected ? 'checked' : ''} aria-label="${escapeHtml(`${formatDate(slot.slot_date)}, ${slot.start_time.slice(0, 5)} - ${slot.end_time.slice(0, 5)}`)}"></span>
      <span class="slot-date">${escapeHtml(formatDate(slot.slot_date))}</span><span class="slot-time">${escapeHtml(slot.start_time.slice(0, 5))}<span class="time-dash">–</span>${escapeHtml(slot.end_time.slice(0, 5))}</span>
    </label>`;
  }).join('') : '<p class="empty-state">Grubunuz için henüz oturum eklenmemiş.</p>';
  updateControls();
}

async function refresh({ resetDraft = false, manual = false } = {}) {
  if (refreshing || !getToken()) return false;
  refreshing = true; updateControls();
  try {
    const next = await bootstrap();
    if (!requireRole(next.actor, ['MANAGER'])) return false;
    const priorGroup = group();
    const nextGroup = next.groups.find(value => value.code === next.actor.group_code);
    if (!nextGroup) throw new Error('Grup bilgileri alınamadı. Yeniden giriş yapın.');
    const nextSaved = new Set(next.selections.filter(selection => selection.account_id === next.actor.id).map(selection => selection.slot_id));
    const wasDirty = dirty();
    const changed = snapshot && (String(next.actor.selection_revision) !== String(snapshot.actor.selection_revision) || String(nextGroup.schedule_revision) !== String(priorGroup?.schedule_revision));
    const render = !snapshot || changed || resetDraft;
    if (!snapshot || resetDraft || !wasDirty) {
      draft = new Set(nextSaved); needsReview = false; el('reviewChanges').checked = false;
    } else if (changed) {
      const validIds = new Set(next.slots.filter(slot => slot.group_code === next.actor.group_code).map(slot => slot.id));
      draft = new Set([...draft].filter(id => validIds.has(id)));
      needsReview = true; el('reviewChanges').checked = false;
    }
    saved = nextSaved; snapshot = next;
    if (!dirty()) { needsReview = false; el('reviewChanges').checked = false; }
    el('actorCode').textContent = next.actor.code;
    el('groupTitle').textContent = `${nextGroup.name} · ${nextGroup.code}`;
    el('deadlineText').textContent = `${formatDeadline(nextGroup.selection_deadline)} · Türkiye saati`;
    if (render) renderSlots();
    if (manual) showMessage(el('statusMessage'), 'Oturumlar güncellendi.', 'success');
    return true;
  } catch (error) { showMessage(el('statusMessage'), error.message, 'error'); return false; }
  finally { refreshing = false; updateControls(); }
}

el('calendar').addEventListener('change', event => {
  const input = event.target.closest('input[name="slot_ids"]');
  if (!input || saving || !deadlineOpen(group())) return;
  if (input.checked) draft.add(input.value); else draft.delete(input.value);
  const card = input.closest('.slot-card');
  card.classList.toggle('selected', input.checked); card.classList.toggle('available', !input.checked);
  const badge = card.querySelector('.badge'); badge.className = `badge ${input.checked ? 'selected' : 'available'}`; badge.textContent = input.checked ? 'Seçildi' : 'Uygun';
  updateControls();
});
el('reviewChanges').addEventListener('change', updateControls);
el('selectionForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!snapshot || saving || refreshing || !dirty()) return;
  if (!deadlineOpen(group())) { updateControls(); return; }
  if (needsReview && !el('reviewChanges').checked) { el('reviewChanges').focus(); return; }
  saving = true; updateControls(); showMessage(el('statusMessage'), '');
  let committed = false;
  try {
    await api('save_selections', { slot_ids: [...draft], expected_revision: snapshot.actor.selection_revision, expected_schedule_revision: group().schedule_revision });
    committed = true;
    const updated = await refresh({ resetDraft: true });
    if (updated) showMessage(el('statusMessage'), 'Seçimleriniz kaydedildi.', 'success');
    else {
      needsReview = true; el('reviewChanges').checked = false;
      showMessage(el('statusMessage'), 'Seçimleriniz kaydedildi ancak güncel ekran alınamadı. Devam etmeden önce Yenile düğmesini kullanın.', 'warning');
    }
  } catch (error) {
    const message = error.message;
    if (!committed) await refresh();
    showMessage(el('statusMessage'), message, 'error');
  } finally { saving = false; updateControls(); }
});
el('discardChanges').addEventListener('click', async () => {
  if (!dirty() || saving) return;
  if (!(await confirmAction('Değişikliklerden vazgeç', 'Kaydedilmemiş değişiklikleriniz kaldırılacak. Son kaydedilen seçimleriniz gösterilecek.', 'Değişiklikleri kaldır'))) return;
  draft = new Set(saved); needsReview = false; el('reviewChanges').checked = false; renderSlots(); showMessage(el('statusMessage'), 'Kaydedilmiş seçimleriniz gösteriliyor.', 'info');
});
el('refreshBtn').addEventListener('click', () => refresh({ manual: true }));
el('logoutBtn').addEventListener('click', async () => {
  if (saving) return;
  if (dirty() && !(await confirmAction('Çıkış yap', 'Kaydedilmemiş değişiklikleriniz var. Kaydetmeden çıkmak istiyor musunuz?', 'Çıkış yap'))) return;
  draft = new Set(saved);
  await logout();
});
window.addEventListener('beforeunload', event => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } });
if (requireSession()) {
  refresh();
  setInterval(() => { if (getToken() && !saving && !document.getElementById('confirmDialog').open) refresh(); }, 20000);
  setInterval(updateControls, 1000);
}

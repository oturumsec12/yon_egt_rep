import { api, bootstrap, requireSession, requireRole, getToken, logout, deadlineOpen, formatDeadline, formatDate, slotLabel, localDateTime, escapeHtml, showMessage, confirmAction } from './common.js';
import { buildReport, reportSheets } from './report.js';
import { downloadWorkbook } from './excel.js';

const el = id => document.getElementById(id);
const pageRole = document.body.dataset.pageRole;
let snapshot = null;
let busy = false;
let refreshing = false;
let modalOpen = false;
let deadlineDirty = false;
let deadlineEditingGroup = '';
const isSuper = () => snapshot?.actor.role === 'SUPER_ADMIN';
const selectedDeadlineGroup = () => snapshot?.groups.find(group => group.code === el('deadlineGroup')?.value);
const percent = number => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 }).format(number);

function controls() {
  el('refreshBtn').disabled = busy || refreshing || modalOpen;
  el('exportBtn').disabled = !snapshot || busy || refreshing || modalOpen;
  el('logoutBtn').disabled = busy;
  for (const button of el('slotReports').querySelectorAll('[data-delete-slot]')) button.disabled = busy || refreshing || modalOpen;
  if (pageRole === 'SUPER_ADMIN') {
    for (const field of document.querySelectorAll('.admin-tools input, .admin-tools select, .admin-tools button')) field.disabled = !isSuper() || busy || refreshing || modalOpen || !snapshot.groups.length;
    el('deadlineSave').disabled ||= !deadlineDirty;
  }
}

function fillOptions(select, includeAll) {
  if (!select) return;
  const previous = select.value;
  select.innerHTML = `${includeAll ? '<option value="">Tüm gruplar</option>' : ''}${snapshot.groups.map(group => `<option value="${escapeHtml(group.code)}">${escapeHtml(group.name)} · ${escapeHtml(group.code)}</option>`).join('')}`;
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
}

function setDeadlineField() {
  const group = selectedDeadlineGroup();
  deadlineEditingGroup = group?.code || '';
  el('deadlineInput').value = group ? localDateTime(group.selection_deadline) : '';
  deadlineDirty = false;
  showMessage(el('deadlineDraftMessage'), '');
  controls();
}

function render() {
  const allGroups = buildReport(snapshot);
  const filtered = el('groupFilter')?.value || '';
  const groups = allGroups.filter(group => !filtered || group.code === filtered);
  const totalManagers = groups.reduce((sum, group) => sum + group.totalManagers, 0);
  const responded = groups.reduce((sum, group) => sum + group.respondedManagers, 0);
  const totalSlots = groups.reduce((sum, group) => sum + group.slots.length, 0);
  el('actorCode').textContent = snapshot.actor.code;
  el('groupTitle').textContent = isSuper() ? 'Süper admin' : (groups[0] ? `${groups[0].name} · ${groups[0].code}` : 'Grup admini');
  el('reportSummary').innerHTML = `<div class="summary-card"><span>Yönetici</span><strong>${totalManagers}</strong></div><div class="summary-card"><span>En az bir oturum seçen</span><strong>${responded}<small> / ${totalManagers}</small></strong></div><div class="summary-card"><span>Seçimi olmayan</span><strong>${totalManagers - responded}</strong></div><div class="summary-card"><span>Oturum</span><strong>${totalSlots}</strong></div>`;
  el('slotReports').innerHTML = groups.length ? groups.map(group => `<section class="group-report" data-group-code="${escapeHtml(group.code)}" aria-label="${escapeHtml(group.name)}">
    <div class="group-heading"><div><h3>${escapeHtml(group.name)} <span class="group-code">${escapeHtml(group.code)}</span></h3><p>${group.totalManagers} yöneticiden ${group.respondedManagers} kişi en az bir oturum seçti</p></div><div class="group-deadline"><span>Son seçim tarihi</span><strong>${escapeHtml(formatDeadline(group.selection_deadline))}</strong><span>${deadlineOpen(group) ? 'Seçim süresi açık' : 'Seçim süresi sona erdi'}</span></div></div>
    <div class="slot-grid">${group.slots.length ? group.slots.map(slot => `<article class="slot-card report-slot ${slot.best ? 'best' : ''}" data-slot-id="${escapeHtml(slot.id)}">
      <div class="slot-top"><span class="badge ${slot.best ? 'available' : 'neutral'}">${slot.best ? 'En çok seçilen' : 'Ortak seçim'}</span><strong class="percentage">%${percent(slot.percentage)}</strong></div>
      <p class="slot-date">${escapeHtml(formatDate(slot.slot_date))}</p><p class="slot-time">${escapeHtml(slot.start_time.slice(0, 5))}<span class="time-dash">–</span>${escapeHtml(slot.end_time.slice(0, 5))}</p>
      <div class="progress" role="progressbar" aria-label="Ortak seçim oranı" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Number(slot.percentage.toFixed(2))}"><span style="width:${Math.max(0, Math.min(100, slot.percentage))}%"></span></div><p class="participation"><strong>${slot.count}</strong> / ${group.totalManagers} yönetici</p>
      <details class="selected-codes"><summary>Seçen yönetici kodları</summary><p>${slot.codes.length ? slot.codes.map(escapeHtml).join(' · ') : 'Henüz seçim yok.'}</p></details>
      ${isSuper() ? `<button class="button danger subtle-delete" type="button" data-delete-slot="${escapeHtml(slot.id)}">Oturumu sil</button>` : ''}
    </article>`).join('') : '<p class="empty-state">Bu grupta henüz oturum yok.</p>'}</div>
  </section>`).join('') : '<p class="empty-state">Henüz grup bulunmuyor. Gruplar Supabase üzerinden eklenebilir.</p>';
  renderManagers(groups);
  controls();
}

function renderManagers(groups = null) {
  if (!snapshot) return;
  const filtered = el('groupFilter')?.value || '';
  groups ||= buildReport(snapshot).filter(group => !filtered || group.code === filtered);
  const search = el('managerSearch').value.trim().toUpperCase();
  const entries = groups.flatMap(group => group.managers.filter(manager => manager.code.includes(search)).map(manager => ({ group, manager })));
  el('managerReports').innerHTML = entries.length ? `<div class="manager-grid">${entries.map(({ group, manager }) => `<article class="manager-card" data-manager-id="${escapeHtml(manager.id)}"><div class="manager-card-heading"><div><h3>${escapeHtml(manager.code)}</h3><p>${escapeHtml(group.name)} · ${escapeHtml(group.code)}</p></div><span class="badge ${manager.count ? 'selected' : 'neutral'}">${manager.count} seçim</span></div>${manager.slots.length ? `<ul>${manager.slots.map(slot => `<li>${escapeHtml(slotLabel(slot))}</li>`).join('')}</ul>` : '<p class="muted">Henüz seçimi yok.</p>'}</article>`).join('')}</div>` : `<p class="empty-state">${search ? 'Aramanıza uygun yönetici bulunamadı.' : 'Bu kapsamda yönetici bulunmuyor.'}</p>`;
}

function applySnapshot(next) {
  if (!requireRole(next.actor, [pageRole])) return false;
  const oldDeadlineGroup = selectedDeadlineGroup();
  const oldDeadlineValue = el('deadlineInput')?.value;
  snapshot = next;
  if (isSuper()) {
    fillOptions(el('groupFilter'), true); fillOptions(el('slotGroup'), false); fillOptions(el('deadlineGroup'), false);
    const current = selectedDeadlineGroup();
    if (!deadlineDirty || oldDeadlineGroup?.code !== current?.code) setDeadlineField();
    else {
      el('deadlineInput').value = oldDeadlineValue;
      if (String(oldDeadlineGroup?.schedule_revision) !== String(current?.schedule_revision)) showMessage(el('deadlineDraftMessage'), 'Bu grubun bilgileri güncellendi. Yazdığınız tarih korundu; kontrol ederek yeniden kaydedebilirsiniz.', 'warning');
    }
  }
  render();
  return true;
}

async function refresh(manual = false) {
  if (refreshing || !getToken() || modalOpen) return false;
  refreshing = true; controls();
  try {
    const next = await bootstrap();
    if (!applySnapshot(next)) return false;
    if (manual) showMessage(el('statusMessage'), 'Raporlar güncellendi.', 'success');
    return true;
  } catch (error) { showMessage(el('statusMessage'), error.message, 'error'); return false; }
  finally { refreshing = false; controls(); }
}

async function mutate(action, fields, success, afterSuccess) {
  if (!isSuper() || busy || refreshing || modalOpen) return;
  busy = true; controls(); showMessage(el('statusMessage'), '');
  try {
    await api(action, fields);
    afterSuccess?.();
    if (await refresh()) showMessage(el('statusMessage'), success, 'success');
    else showMessage(el('statusMessage'), `${success} Güncel ekran alınamadı. Yenile düğmesini kullanın.`, 'warning');
  } catch (error) {
    const message = error.message;
    await refresh();
    showMessage(el('statusMessage'), message, 'error');
  } finally { busy = false; controls(); }
}

el('refreshBtn').addEventListener('click', () => refresh(true));
el('managerSearch').addEventListener('input', () => renderManagers());
el('groupFilter')?.addEventListener('change', render);
el('logoutBtn').addEventListener('click', async () => {
  if (busy) return;
  if (isSuper() && (deadlineDirty || el('slotDate').value || el('startTime').value || el('endTime').value)) {
    modalOpen = true; controls();
    const confirmed = await confirmAction('Çıkış yap', 'Formlarda kaydedilmemiş bilgiler var. Kaydetmeden çıkmak istiyor musunuz?', 'Çıkış yap');
    modalOpen = false; controls(); if (!confirmed) return;
  }
  if (isSuper()) {
    deadlineDirty = false;
    el('slotDate').value = ''; el('startTime').value = ''; el('endTime').value = '';
  }
  await logout();
});
el('exportBtn').addEventListener('click', async () => {
  if (!snapshot || busy || refreshing || modalOpen) return;
  busy = true; controls(); showMessage(el('statusMessage'), 'Güncel rapor hazırlanıyor…', 'info');
  try {
    const next = await bootstrap();
    if (!applySnapshot(next)) return;
    const stamp = localDateTime(next.serverNow).replace(/[-:]/g, '').replace('T', '_');
    downloadWorkbook(reportSheets(next), `egitim_oturum_raporu_${stamp}.xlsx`);
    showMessage(el('statusMessage'), isSuper() ? 'Tüm grupların güncel Excel raporu indirildi.' : 'Grubunuzun güncel Excel raporu indirildi.', 'success');
  } catch (error) { showMessage(el('statusMessage'), error.message, 'error'); }
  finally { busy = false; controls(); }
});

if (pageRole === 'SUPER_ADMIN') {
  el('deadlineGroup').addEventListener('change', async () => {
    const nextGroup = el('deadlineGroup').value;
    if (deadlineDirty) {
      el('deadlineGroup').value = deadlineEditingGroup;
      modalOpen = true; controls();
      const confirmed = await confirmAction('Grubu değiştir', 'Yazdığınız son tarih henüz kaydedilmedi. Bu değişiklikten vazgeçerek diğer gruba geçmek istiyor musunuz?', 'Diğer gruba geç');
      modalOpen = false; controls();
      if (!confirmed) return;
      el('deadlineGroup').value = nextGroup;
    }
    setDeadlineField();
  });
  el('deadlineInput').addEventListener('input', () => {
    deadlineDirty = el('deadlineInput').value !== (selectedDeadlineGroup() ? localDateTime(selectedDeadlineGroup().selection_deadline) : '');
    showMessage(el('deadlineDraftMessage'), deadlineDirty ? 'Son tarih değişikliğiniz henüz kaydedilmedi.' : '', 'info'); controls();
  });
  el('deadlineForm').addEventListener('submit', async event => {
    event.preventDefault();
    const group = selectedDeadlineGroup();
    if (!group || !deadlineDirty) return;
    const deadline = el('deadlineInput').value;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(deadline) || !el('deadlineInput').validity.valid) {
      showMessage(el('statusMessage'), 'Geçerli bir son seçim tarihi ve saati yazın. Bu alan boş bırakılamaz.', 'error'); el('deadlineInput').focus(); return;
    }
    await mutate('set_deadline', { group_code: group.code, deadline, expected_schedule_revision: group.schedule_revision }, 'Grubun son seçim tarihi güncellendi.', () => { deadlineDirty = false; });
  });
  el('slotForm').addEventListener('submit', async event => {
    event.preventDefault();
    const groupCode = el('slotGroup').value, date = el('slotDate').value, start = el('startTime').value, end = el('endTime').value;
    if (!groupCode || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
      showMessage(el('statusMessage'), 'Grup, oturum tarihi, başlangıç ve bitiş saatlerini doldurun.', 'error'); return;
    }
    if (end <= start) { showMessage(el('statusMessage'), 'Bitiş saati başlangıç saatinden sonra olmalıdır.', 'error'); el('endTime').focus(); return; }
    await mutate('add_slot', { group_code: groupCode, slot_date: date, start_time: start, end_time: end }, 'Oturum eklendi.', () => { el('slotDate').value = ''; el('startTime').value = ''; el('endTime').value = ''; });
  });
  el('slotReports').addEventListener('click', async event => {
    const button = event.target.closest('[data-delete-slot]');
    if (!button || !isSuper() || busy || refreshing || modalOpen) return;
    const slot = snapshot.slots.find(value => value.id === button.dataset.deleteSlot);
    const group = snapshot.groups.find(value => value.code === slot?.group_code);
    if (!slot || !group) return;
    const count = snapshot.selections.filter(selection => selection.slot_id === slot.id).length;
    const revision = group.schedule_revision;
    modalOpen = true; controls();
    const confirmed = await confirmAction('Oturumu sil', `${group.name} · ${slotLabel(slot)}. Bu oturumla birlikte ${count} yöneticinin seçimi silinecek. Bu işlem geri alınamaz.`, 'Oturumu ve seçimleri sil');
    modalOpen = false; controls();
    if (confirmed) await mutate('delete_slot', { slot_id: slot.id, expected_schedule_revision: revision }, 'Oturum ve ona bağlı seçimler silindi.');
  });
  window.addEventListener('beforeunload', event => {
    if (deadlineDirty || el('slotDate').value || el('startTime').value || el('endTime').value) { event.preventDefault(); event.returnValue = ''; }
  });
}
if (requireSession()) {
  refresh();
  setInterval(() => { if (getToken() && !busy && !modalOpen) refresh(); }, 30000);
}

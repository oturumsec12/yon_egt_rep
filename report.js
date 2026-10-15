import { slotLabel } from './common.js';

export function buildReport(snapshot) {
  return [...snapshot.groups].sort((a, b) => a.code.localeCompare(b.code, 'tr')).map(group => {
    const managers = snapshot.managers.filter(manager => manager.group_code === group.code).sort((a, b) => a.code.localeCompare(b.code, 'tr'));
    const slots = snapshot.slots.filter(slot => slot.group_code === group.code).sort((a, b) => `${a.slot_date} ${a.start_time}`.localeCompare(`${b.slot_date} ${b.start_time}`));
    const memberIds = new Set(managers.map(manager => manager.id));
    const selections = snapshot.selections.filter(selection => selection.group_code === group.code && memberIds.has(selection.account_id));
    const slotIds = new Set(slots.map(slot => slot.id));
    const validSelections = selections.filter(selection => slotIds.has(selection.slot_id));
    const slotRows = slots.map(slot => {
      const selected = new Set(validSelections.filter(selection => selection.slot_id === slot.id).map(selection => selection.account_id));
      return { ...slot, count: selected.size, percentage: managers.length ? selected.size / managers.length * 100 : 0, codes: managers.filter(manager => selected.has(manager.id)).map(manager => manager.code) };
    });
    const maximum = Math.max(0, ...slotRows.map(slot => slot.count));
    for (const slot of slotRows) slot.best = maximum > 0 && slot.count === maximum;
    const managerRows = managers.map(manager => {
      const selected = new Set(validSelections.filter(selection => selection.account_id === manager.id).map(selection => selection.slot_id));
      return { ...manager, slots: slots.filter(slot => selected.has(slot.id)), count: selected.size };
    });
    return { ...group, managers: managerRows, slots: slotRows, totalManagers: managers.length, respondedManagers: managerRows.filter(manager => manager.count > 0).length, maximum };
  });
}

export function reportSheets(snapshot) {
  const groups = buildReport(snapshot);
  const slotRows = [['Grup kodu', 'Grup adı', 'Oturum tarih ve saati', 'Seçen yönetici', 'Toplam yönetici', 'Ortak seçim (%)', 'En çok seçilen']];
  const managerRows = [['Grup kodu', 'Grup adı', 'Yönetici kodu', 'Seçim sayısı', 'Oturum tarih ve saati']];
  for (const group of groups) {
    for (const slot of group.slots) slotRows.push([group.code, group.name, slotLabel(slot), slot.count, group.totalManagers, Number(slot.percentage.toFixed(2)), slot.best ? 'Evet' : '']);
    for (const manager of group.managers) {
      if (!manager.slots.length) managerRows.push([group.code, group.name, manager.code, 0, '']);
      for (const slot of manager.slots) managerRows.push([group.code, group.name, manager.code, manager.count, slotLabel(slot)]);
    }
  }
  return [
    { name: 'Oturum Özeti', rows: slotRows, widths: [18, 30, 62, 19, 19, 21, 21] },
    { name: 'Yönetici Seçimleri', rows: managerRows, widths: [18, 30, 20, 18, 62] },
  ];
}

(() => {
  const $ = id => document.getElementById(id);
  let loading = false;
  let editing = false;
  const formatDate = value => value ? new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh' }).format(new Date(value)) : 'غير مجدولة';
  const size = value => `${(value / 1048576).toFixed(2)} MB`;
  const statuses = { running: 'جاري النسخ', completed: 'مكتملة', failed: 'فشلت', expired: 'انتهت مدة الاحتفاظ' };
  async function request(url, options = {}) {
    const res = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'Hisabat' } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'تعذر تنفيذ الطلب');
    return data;
  }
  function notice(text, error = false) { $('backupNotice').textContent = text; $('backupNotice').classList.toggle('error', error); }
  function render(data) {
    $('backupContent').hidden = false;
    const active = data.records.some(r => r.status === 'running');
    $('createBackup').disabled = !data.configured || active;
    $('createBackup').innerHTML = `<span class="material-symbols-outlined">backup</span>${active ? 'جاري النسخ…' : 'نسخة احتياطية الآن'}`;
    $('settingsFields').disabled = !data.configured;
    if (!editing) {
      $('scheduleEnabled').checked = data.settings.enabled;
      $('intervalDays').value = data.settings.intervalDays;
      $('backupTime').value = data.settings.time;
      $('retentionDays').value = data.settings.retentionDays;
    }
    const completed = data.records.filter(r => r.status === 'completed');
    $('lastBackup').textContent = completed.length ? formatDate(completed[0].completedAt) : 'لا توجد نسخ بعد';
    $('lastBackupHint').textContent = completed.length ? 'تم حفظ ملف النسخة المشفّر' : 'ابدأ أول نسخة لحماية بياناتك';
    $('nextBackup').textContent = data.settings.enabled ? formatDate(data.settings.nextRun) : 'النسخ التلقائي متوقف';
    $('backupCount').textContent = `${completed.length} نسخة`;
    $('backupSize').textContent = size(completed.reduce((n, r) => n + r.size, 0));
    $('backupEmpty').hidden = data.records.length > 0;
    document.querySelector('.backup-record-head').hidden = data.records.length === 0;
    $('backupRecords').replaceChildren();
    for (const r of data.records) {
      const row = document.createElement('article'); row.className = 'backup-record';
      row.innerHTML = `<div><time></time><small></small></div><div class="record-type"></div><div class="record-size" dir="ltr"></div><div><span class="backup-badge"></span></div><div class="backup-actions"></div>`;
      row.querySelector('time').textContent = formatDate(r.createdAt);
      row.querySelector('small').textContent = `بواسطة: ${r.requestedBy}`;
      row.querySelector('.record-type').textContent = r.type === 'automatic' ? 'تلقائي' : 'يدوي';
      row.querySelector('.record-size').textContent = r.size ? size(r.size) : '—';
      const badge = row.querySelector('.backup-badge'); badge.textContent = statuses[r.status] || r.status;
      if (Object.hasOwn(statuses, r.status)) badge.classList.add(r.status);
      if (r.status === 'completed') {
        const download = document.createElement('a'); download.href = `/api/backups/${encodeURIComponent(r.id)}/download`; download.textContent = 'تنزيل'; download.setAttribute('download', '');
        const keep = document.createElement('button'); keep.textContent = r.keep ? '★ محفوظة' : '☆ احتفاظ'; keep.setAttribute('aria-pressed', String(r.keep));
        keep.onclick = async () => { keep.disabled = true; try { await request(`/api/backups/${encodeURIComponent(r.id)}`, { method: 'PATCH', body: JSON.stringify({ keep: !r.keep }) }); await load(); } catch (e) { notice(e.message, true); } finally { keep.disabled = false; } };
        row.querySelector('.backup-actions').append(download, keep);
      }
      if (r.status === 'failed') {
        const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'عرض السبب';
        const explanation = document.createElement('p'); explanation.textContent = r.error || 'لم تكتمل العملية'; details.append(summary, explanation); row.append(details);
      }
      $('backupRecords').append(row);
    }
    if (!data.configured) notice('النسخ الاحتياطي غير مفعّل بعد. يلزم ربط عامل التشغيل بالتخزين الخاص قبل إنشاء نسخ أو تشغيل الجدولة.');
    else if (active) notice('جاري إنشاء نسخة احتياطية. تقدر تقفل الصفحة؛ العملية هتكمل في الخلفية.');
    else if (data.records[0]?.status === 'failed') notice('آخر محاولة نسخ فشلت. راجع السبب في السجل وأعد المحاولة.', true);
    else notice('عامل النسخ متصل. النسخ المحفوظة متاحة للمدير فقط.');
  }
  async function load() {
    if (loading) return;
    loading = true;
    try { render(await request('/api/backups')); }
    catch (e) { notice(e.message, true); $('createBackup').disabled = true; $('settingsFields').disabled = true; }
    finally { loading = false; }
  }
  $('createBackup').onclick = async () => {
    $('createBackup').disabled = true;
    try { await request('/api/backups', { method: 'POST', body: '{}' }); await load(); }
    catch (e) { notice(e.message, true); $('createBackup').disabled = false; }
  };
  $('backupSettings').oninput = () => { editing = true; };
  $('backupSettings').onsubmit = async event => {
    event.preventDefault();
    const settings = { enabled: $('scheduleEnabled').checked, intervalDays: Number($('intervalDays').value), time: $('backupTime').value, retentionDays: Number($('retentionDays').value) };
    $('settingsFields').disabled = true;
    try { await request('/api/backups/settings', { method: 'PUT', body: JSON.stringify(settings) }); editing = false; await load(); showToast('تم حفظ إعدادات الجدولة', 'success'); }
    catch (e) { notice(e.message, true); $('settingsFields').disabled = false; }
  };
  $('refreshBackups').onclick = load;
  if (matchMedia('(max-width: 767px)').matches) document.querySelector('.backup-schedule').open = false;
  load();
  const timer = setInterval(() => { if (!document.hidden) load(); }, 15000);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
})();

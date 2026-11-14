const DEFAULTS = { enabled: true, regions: ['West Asia', 'North Africa'], warnVpn: true };
const STATUS_TEXT = {
  ok: 'يعمل بشكل طبيعي.',
  ratelimit: 'اكس أوقفت الطلبات مؤقتا (rate limit). الإضافة ستنتظر وتكمل تلقائيا.',
  badquery: 'اكس غيرت طريقة الطلب. افتح صفحة About لأي حساب مرة واحدة ليتحدث المعرف تلقائيا.',
  noauth: 'لم تلتقط الإضافة الجلسة بعد. حدث صفحة اكس.'
};
const $ = (id) => document.getElementById(id);

async function init() {
  const s = await chrome.storage.local.get(['xoa_settings', 'xoa_stats', 'xoa_status']);
  const st = { ...DEFAULTS, ...(s.xoa_settings || {}) };
  $('enabled').checked = st.enabled;
  $('warnVpn').checked = st.warnVpn;
  $('regions').value = st.regions.join('\n');
  $('checked').textContent = (s.xoa_stats && s.xoa_stats.checked) || 0;
  $('flagged').textContent = (s.xoa_stats && s.xoa_stats.flagged) || 0;
  if (s.xoa_status) $('status').textContent = STATUS_TEXT[s.xoa_status.status] || ('آخر حالة: ' + s.xoa_status.status);
}

$('save').onclick = async () => {
  const regions = $('regions').value.split('\n').map(x => x.trim()).filter(Boolean);
  await chrome.storage.local.set({ xoa_settings: { enabled: $('enabled').checked, warnVpn: $('warnVpn').checked, regions } });
  $('status').textContent = 'تم الحفظ.';
};
$('clear').onclick = async () => {
  await chrome.storage.local.remove(['xoa_cache', 'xoa_stats']);
  $('status').textContent = 'تم مسح الذاكرة المؤقتة.';
  $('checked').textContent = '0'; $('flagged').textContent = '0';
};
init();

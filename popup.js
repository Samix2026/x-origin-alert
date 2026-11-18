const DEFAULTS = { enabled: true, regions: ['West Asia', 'North Africa'], warnVpn: true, warnRenames: true, renameLimit: 10, showAll: true, lang: 'auto' };
const STR = {
  ar: {
    title: 'منبه موقع الحساب في اكس', enabled: 'تشغيل الإضافة', language: 'اللغة:', langAuto: 'تلقائي',
    showAll: 'إظهار دولة كل حساب (وليس التحذيرات فقط)', warnVpn: 'تحذير عند مؤشر VPN',
    warnRenames: 'تحذير عند كثرة تغيير اسم المستخدم', limit: 'الحد:',
    regionsHelp: 'المناطق التي يظهر عندها تحذير (سطر لكل منطقة كما تكتبها اكس):',
    checked: 'حسابات تم فحصها', flagged: 'تحذيرات ظهرت', trusted: 'حسابات موثوقة عندك',
    save: 'حفظ', clear: 'مسح الذاكرة المؤقتة', clearTrust: 'مسح قائمة الموثوقين',
    saved: 'تم الحفظ.', cleared: 'تم مسح الذاكرة المؤقتة.', trustCleared: 'تم مسح قائمة الموثوقين.',
    st: { ok: 'يعمل بشكل طبيعي.', ratelimit: 'اكس أوقفت الطلبات مؤقتا. الإضافة ستنتظر وتكمل تلقائيا.',
      badquery: 'اكس غيرت طريقة الطلب. افتح صفحة About لأي حساب مرة واحدة ليتحدث المعرف تلقائيا.',
      noauth: 'لم تلتقط الإضافة الجلسة بعد. حدث صفحة اكس.' }, last: 'آخر حالة: '
  },
  en: {
    title: 'X Origin Alert', enabled: 'Enable extension', language: 'Language:', langAuto: 'Auto',
    showAll: 'Show every account’s country (not only warnings)', warnVpn: 'Warn on VPN indicator',
    warnRenames: 'Warn on frequent username changes', limit: 'Threshold:',
    regionsHelp: 'Regions that trigger a warning (one per line, as X writes them):',
    checked: 'Accounts checked', flagged: 'Warnings shown', trusted: 'Accounts you trust',
    save: 'Save', clear: 'Clear cache', clearTrust: 'Clear trusted list',
    saved: 'Saved.', cleared: 'Cache cleared.', trustCleared: 'Trusted list cleared.',
    st: { ok: 'Working normally.', ratelimit: 'X paused requests temporarily. The extension will resume automatically.',
      badquery: 'X changed its request format. Open any account’s About page once to refresh it.',
      noauth: 'Session not detected yet. Reload X.' }, last: 'Last status: '
  }
};
const $ = (id) => document.getElementById(id);
let t = STR.ar;

function applyLang(code) {
  const l = code === 'ar' || code === 'en' ? code : ((navigator.language || '').toLowerCase().startsWith('ar') ? 'ar' : 'en');
  t = STR[l];
  document.documentElement.lang = l;
  document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-t]').forEach(e => { e.textContent = t[e.getAttribute('data-t')]; });
}

async function init() {
  const s = await chrome.storage.local.get(['xoa_settings', 'xoa_stats', 'xoa_status', 'xoa_trusted']);
  const st = { ...DEFAULTS, ...(s.xoa_settings || {}) };
  applyLang(st.lang);
  $('enabled').checked = st.enabled;
  $('lang').value = st.lang;
  $('showAll').checked = st.showAll;
  $('warnVpn').checked = st.warnVpn;
  $('warnRenames').checked = st.warnRenames;
  $('renameLimit').value = st.renameLimit;
  $('regions').value = st.regions.join('\n');
  $('checked').textContent = (s.xoa_stats && s.xoa_stats.checked) || 0;
  $('flagged').textContent = (s.xoa_stats && s.xoa_stats.flagged) || 0;
  $('trustedCount').textContent = (s.xoa_trusted || []).length;
  if (s.xoa_status) $('status').textContent = t.st[s.xoa_status.status] || (t.last + s.xoa_status.status);
}

$('lang').onchange = () => applyLang($('lang').value);
$('save').onclick = async () => {
  const regions = $('regions').value.split('\n').map(x => x.trim()).filter(Boolean);
  const renameLimit = Math.max(1, parseInt($('renameLimit').value, 10) || 10);
  await chrome.storage.local.set({ xoa_settings: {
    enabled: $('enabled').checked, lang: $('lang').value, showAll: $('showAll').checked,
    warnVpn: $('warnVpn').checked, warnRenames: $('warnRenames').checked, renameLimit, regions } });
  $('status').textContent = t.saved;
};
$('clear').onclick = async () => {
  await chrome.storage.local.remove(['xoa_cache', 'xoa_stats']);
  $('status').textContent = t.cleared;
  $('checked').textContent = '0'; $('flagged').textContent = '0';
};
$('clearTrust').onclick = async () => {
  await chrome.storage.local.set({ xoa_trusted: [] });
  $('trustedCount').textContent = '0';
  $('status').textContent = t.trustCleared;
};
init();

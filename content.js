// يرصد أسماء الحسابات الظاهرة على الشاشة، ويطلب موقعها بمعدل محدود،
// ويعرض بجانب كل اسم دولة الحساب بعلمها، ويحول الشارة إلى تحذير عند ظهور منطقة من القائمة
// أو مؤشر VPN أو كثرة تغيير اسم المستخدم، ويعرض بطاقة معلومات الحساب عند المرور بالماوس.
(() => {
  const DEFAULTS = {
    enabled: true, regions: ['West Asia', 'North Africa'], warnVpn: true, warnRenames: true,
    renameLimit: 10, showAll: true, lang: 'auto'
  };
  const TTL_OK = 14 * 24 * 3600 * 1000;      // تخزين النتيجة 14 يوما
  const TTL_EMPTY = 2 * 24 * 3600 * 1000;    // حساب بلا بيانات: يومان
  const TTL_FLAG = 24 * 3600 * 1000;         // التحذير يعاد فحصه بعد يوم واحد
  const GAP_MS = 2500;                        // طلب واحد كل 2.5 ثانية كحد أقصى
  const CACHE_KEY = 'xoa_cache';
  const TRUST_KEY = 'xoa_trusted';
  const D = self.XOA_DATA || { flags: {}, name2code: {}, arShort: {}, enShort: {}, regions: {}, regAr: {} };

  let settings = { ...DEFAULTS };
  let cache = {};
  let trusted = new Set();
  let saveTimer = null;
  const pending = new Map();   // username -> [elements]
  const queue = [];
  let busy = false;
  let pausedUntil = 0;
  let reqId = 0;

  const log = (...a) => console.debug('[XOA]', ...a);

  // ---------- اللغة ----------
  const STR = {
    ar: {
      vpn: 'VPN', renames: (n) => `غير اسمه ${n} مرة`, recheck: 'اضغط لإعادة الفحص الآن',
      checking: 'جاري الفحص…', location: 'مكان الحساب', note: 'ملاحظة اكس', vpnNote: 'قد يتصل عبر VPN',
      via: 'الاتصال عبر', created: 'تاريخ الإنشاء', verified: 'التوثيق', since: (d) => 'منذ ' + d,
      notVerified: 'غير موثق', renamesRow: 'تغيير اسم المستخدم',
      renamesVal: (n, d) => `${n} مرة` + (d ? '، آخرها ' + d : ''), never: 'لم يتغير', na: 'غير متاح',
      foot: 'البيانات من اكس. مؤشر وليس حكما.', trust: 'أثق بهذا الحساب', untrust: 'إلغاء الثقة',
      trustedNote: 'موثوق عندك، فلا تظهر عليه تحذيرات', locale: 'ar-SA-u-ca-gregory-nu-latn'
    },
    en: {
      vpn: 'VPN', renames: (n) => `${n} username changes`, recheck: 'Click to re-check now',
      checking: 'Checking…', location: 'Account based in', note: 'X note', vpnNote: 'May connect via VPN',
      via: 'Connected via', created: 'Joined', verified: 'Verified', since: (d) => 'Since ' + d,
      notVerified: 'Not verified', renamesRow: 'Username changes',
      renamesVal: (n, d) => `${n}` + (d ? `, last ${d}` : ''), never: 'None', na: 'Not available',
      foot: 'Data from X. A signal, not a verdict.', trust: 'Trust this account', untrust: 'Remove trust',
      trustedNote: 'Trusted by you, warnings hidden', locale: 'en-US'
    }
  };
  function lang() {
    if (settings.lang === 'ar' || settings.lang === 'en') return settings.lang;
    return (document.documentElement.lang || navigator.language || '').toLowerCase().startsWith('ar') ? 'ar' : 'en';
  }
  const T = () => STR[lang()];

  // ---------- الدول والمناطق ----------
  const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[ً-ْـ]/g, '').replace(/[^a-z0-9؀-ۿ]+/g, ' ')
    .replace(/^the /, '').trim();
  const dn = {};
  function displayName(code, l) {
    if (l === 'ar' && D.arShort[code]) return D.arShort[code];
    if (l === 'en' && D.enShort[code]) return D.enShort[code];
    try { dn[l] = dn[l] || new Intl.DisplayNames([l], { type: 'region' }); return dn[l].of(code) || code; } catch (_) { return code; }
  }
  // يحول اسم المكان كما ترجعه اكس إلى رمز دولة أو مفتاح منطقة
  function geo(name) {
    if (!name) return null;
    const n = norm(name);
    const code = D.name2code[n];
    if (code) return { code, flag: D.flags[code] || null, label: displayName(code, lang()) };
    const regKey = D.regions[n] ? n : D.regAr[n];
    if (regKey) return { region: regKey, label: lang() === 'ar' ? D.regions[regKey] : regKey.replace(/\b\w/g, c => c.toUpperCase()) };
    return { label: name };
  }
  function isWarnRegion(name) {
    if (!name) return false;
    const n = norm(name);
    const key = D.regions[n] ? n : (D.regAr[n] || n);
    return settings.regions.map(norm).includes(key);
  }

  // ---------- التخزين ----------
  async function load() {
    const s = await chrome.storage.local.get(['xoa_settings', CACHE_KEY, TRUST_KEY]);
    settings = { ...DEFAULTS, ...(s.xoa_settings || {}) };
    cache = s[CACHE_KEY] || {};
    trusted = new Set(s[TRUST_KEY] || []);
    const now = Date.now();
    for (const [u, v] of Object.entries(cache)) {
      if (!v || v.exp < now) { delete cache[u]; continue; }
      // تحذير محفوظ أقدم من يوم، أو من نسخة سابقة بلا وقت فحص: يحذف ليعاد فحصه
      if (classify(v, u) && (!v.t || now - v.t > TTL_FLAG)) { delete cache[u]; continue; }
      // نتيجة من نسخة سابقة بلا بيانات البطاقة: يعاد فحصها خلال يوم بالتدريج
      if (!('n' in v)) v.exp = Math.min(v.exp, now + Math.random() * TTL_FLAG);
    }
  }
  function store(u, out) {
    const rec = { b: out.basedIn || null, v: !!out.vpn, s: out.source || null, c: out.created || null,
      n: out.renames || 0, nl: out.renamedAt || null, vs: out.verifiedSince || null, t: Date.now() };
    const ttl = classify(rec) ? TTL_FLAG : (rec.b ? TTL_OK : TTL_EMPTY);
    rec.exp = rec.t + ttl;
    cache[u.toLowerCase()] = rec;
    saveSoon();
  }
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => chrome.storage.local.set({ [CACHE_KEY]: cache }).catch(() => {}), 1500);
  }
  async function bump(key) {
    const s = await chrome.storage.local.get('xoa_stats');
    const st = s.xoa_stats || {};
    st[key] = (st[key] || 0) + 1;
    chrome.storage.local.set({ xoa_stats: st }).catch(() => {});
  }
  function setStatus(status) {
    chrome.storage.local.set({ xoa_status: { status, at: Date.now() } }).catch(() => {});
  }
  function repaintAll() {
    onLeave(true);
    const users = new Set([...document.querySelectorAll('[data-xoa-u]')].map(e => e.getAttribute('data-xoa-u')));
    users.forEach(u => { if (cache[u]) paint(u); });
  }
  chrome.storage.onChanged.addListener((ch) => {
    if (ch.xoa_settings) {
      const wasEnabled = settings.enabled;
      settings = { ...DEFAULTS, ...(ch.xoa_settings.newValue || {}) };
      if (!settings.enabled) { document.querySelectorAll('.xoa-badge').forEach(b => b.remove()); onLeave(true); return; }
      if (!wasEnabled) { document.querySelectorAll('[data-xoa]').forEach(e => e.removeAttribute('data-xoa')); scan(); }
      repaintAll();
    }
    if (ch[TRUST_KEY]) { trusted = new Set(ch[TRUST_KEY].newValue || []); repaintAll(); }
    if (ch[CACHE_KEY] && !ch[CACHE_KEY].newValue) cache = {};
  });

  // ---------- الاتصال بسكربت الصفحة ----------
  function ask(screenName) {
    return new Promise((resolve) => {
      const id = 'r' + (++reqId);
      const onMsg = (ev) => {
        if (ev.source !== window || !ev.data || ev.data.src !== 'xoa-res' || ev.data.id !== id) return;
        window.removeEventListener('message', onMsg);
        resolve(ev.data.out);
      };
      window.addEventListener('message', onMsg);
      window.postMessage({ src: 'xoa-req', id, screenName }, '*');
      setTimeout(() => { window.removeEventListener('message', onMsg); resolve({ status: 'timeout' }); }, 20000);
    });
  }

  // ---------- الطابور ----------
  function enqueue(u, front = false) {
    const i = queue.indexOf(u);
    if (i >= 0) queue.splice(i, 1);
    if (front) queue.unshift(u); else queue.push(u);
    pump();
  }
  async function pump() {
    if (busy || !queue.length) return;
    const wait = pausedUntil - Date.now();
    if (wait > 0) { setTimeout(pump, Math.min(wait, 60000)); return; }
    busy = true;
    const u = queue.shift();
    const els = (pending.get(u) || []).filter(e => e.isConnected);
    if (!els.length && !onPage(u).length) { pending.delete(u); busy = false; pump(); return; }

    const out = await ask(u);
    log(u, out);
    if (out.status === 'ok') {
      store(u, out);
      bump('checked');
      if (classify(cache[u], u)) bump('flagged');
      setStatus('ok');
      paint(u);
    } else if (out.status === 'ratelimit') {
      pausedUntil = out.reset ? out.reset * 1000 + 2000 : Date.now() + 15 * 60 * 1000;
      queue.unshift(u);
      setStatus('ratelimit');
    } else if (out.status === 'nouser') {
      store(u, {});
      paint(u);
    } else {
      setStatus(out.status);
      pending.delete(u);
      if (out.status === 'badquery' || out.status === 'noauth') pausedUntil = Date.now() + 5 * 60 * 1000;
    }
    setTimeout(() => { busy = false; pump(); }, GAP_MS);
  }

  // ---------- التصنيف ----------
  function classify(rec, u) {
    if (!rec) return null;
    if (u && trusted.has(u)) return null;
    const reasons = [];
    if (rec.b && isWarnRegion(rec.b)) reasons.push('region');
    if (settings.warnVpn && rec.v) reasons.push('vpn');
    if (settings.warnRenames && rec.n >= Math.max(1, Number(settings.renameLimit) || 10)) reasons.push('renames');
    return reasons.length ? reasons : null;
  }

  // ---------- الشارات ----------
  const SVG_GLOBE = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>';
  const SVG_WARN = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>';
  function iconFor(g) {
    if (g && g.flag) {
      const img = document.createElement('img');
      img.className = 'xoa-flag'; img.alt = ''; img.src = 'data:image/png;base64,' + g.flag;
      return img;
    }
    const s = document.createElement('span'); s.className = 'xoa-ico'; s.innerHTML = SVG_GLOBE; return s;
  }
  function badge(kind) {
    const b = document.createElement('span');
    b.className = 'xoa-badge ' + (kind === 'warn' ? 'xoa-w' : 'xoa-n');
    b.title = T().recheck;
    b.addEventListener('click', onBadgeClick, true);
    return b;
  }
  function makeBadges(rec, u) {
    const out = [];
    if (!rec) return out;
    const reasons = classify(rec, u) || [];
    const locWarn = reasons.includes('region') || reasons.includes('vpn');
    if (rec.b && (settings.showAll || locWarn)) {
      const g = geo(rec.b);
      const b = badge(locWarn ? 'warn' : 'neutral');
      b.dir = lang() === 'ar' ? 'rtl' : 'ltr';
      b.append(iconFor(g), document.createTextNode(g.label + (reasons.includes('vpn') ? ' · ' + T().vpn : '')));
      out.push(b);
    } else if (!rec.b && reasons.includes('vpn')) {
      const b = badge('warn'); b.dir = 'ltr';
      const s = document.createElement('span'); s.className = 'xoa-ico'; s.innerHTML = SVG_WARN;
      b.append(s, document.createTextNode(T().vpn)); out.push(b);
    }
    if (reasons.includes('renames')) {
      const b = badge('warn'); b.dir = lang() === 'ar' ? 'rtl' : 'ltr';
      const s = document.createElement('span'); s.className = 'xoa-ico'; s.innerHTML = SVG_WARN;
      b.append(s, document.createTextNode(T().renames(rec.n))); out.push(b);
    }
    return out;
  }

  // ---------- بطاقة معلومات الحساب ----------
  const fmt = (ms) => { try { return new Date(ms).toLocaleDateString(T().locale, { month: 'long', year: 'numeric' }); } catch (_) { return ''; } };
  let card = null, cardTimer = null, hideTimer = null, cardFor = null;
  function cardEl() {
    if (card) return card;
    card = document.createElement('div');
    card.className = 'xoa-card';
    card.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    card.addEventListener('mouseleave', () => onLeave());
    document.body.appendChild(card);
    return card;
  }
  function row(label, value, warn, valueNode) {
    const r = document.createElement('div');
    r.className = 'xoa-row' + (warn ? ' xoa-warn' : '');
    const l = document.createElement('span'); l.className = 'xoa-l'; l.textContent = label;
    const v = document.createElement('span'); v.className = 'xoa-v';
    if (valueNode) v.append(valueNode);
    v.append(document.createTextNode(value));
    r.append(l, v);
    return r;
  }
  function renderCard(u) {
    const rec = cache[u];
    const t = T();
    const c = cardEl();
    c.dir = lang() === 'ar' ? 'rtl' : 'ltr';
    c.replaceChildren();
    const h = document.createElement('div'); h.className = 'xoa-h'; h.dir = 'ltr'; h.textContent = '@' + u;
    c.appendChild(h);
    if (!rec || !('n' in rec)) { c.appendChild(row('', t.checking)); return; }
    const reasons = classify(rec, u) || [];
    const g = geo(rec.b);
    c.appendChild(row(t.location, g ? g.label : t.na, reasons.includes('region'), g ? iconFor(g) : null));
    if (rec.v) c.appendChild(row(t.note, t.vpnNote, reasons.includes('vpn')));
    c.appendChild(row(t.via, rec.s || t.na));
    if (rec.c) c.appendChild(row(t.created, fmt(rec.c)));
    c.appendChild(row(t.verified, rec.vs ? t.since(fmt(rec.vs)) : t.notVerified));
    c.appendChild(row(t.renamesRow, rec.n ? t.renamesVal(rec.n, rec.nl ? fmt(rec.nl) : '') : t.never, reasons.includes('renames')));
    if (trusted.has(u)) { const n = document.createElement('div'); n.className = 'xoa-trusted'; n.textContent = t.trustedNote; c.appendChild(n); }
    const btn = document.createElement('button');
    btn.className = 'xoa-trust';
    btn.textContent = trusted.has(u) ? t.untrust : t.trust;
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleTrust(u); }, true);
    c.appendChild(btn);
    const f = document.createElement('div'); f.className = 'xoa-f'; f.textContent = t.foot;
    c.appendChild(f);
  }
  function toggleTrust(u) {
    if (trusted.has(u)) trusted.delete(u); else trusted.add(u);
    chrome.storage.local.set({ [TRUST_KEY]: [...trusted] }).catch(() => {});
    paint(u);
  }
  function placeCard(anchor) {
    const c = cardEl();
    const r = anchor.getBoundingClientRect();
    const w = 300;
    const rtl = c.dir === 'rtl';
    let left = rtl ? r.right - w : r.left;
    left = Math.min(Math.max(8, left), window.innerWidth - w - 8);
    const top = r.bottom + 6;
    c.style.left = left + 'px';
    c.style.top = top + 'px';
    c.classList.add('on');
    const ch = c.getBoundingClientRect().height;
    if (top + ch > window.innerHeight - 8) c.style.top = Math.max(8, r.top - ch - 6) + 'px';
  }
  function onEnter(ev) {
    const block = ev.currentTarget;
    const u = block.getAttribute('data-xoa-u');
    if (!u) return;
    clearTimeout(cardTimer); clearTimeout(hideTimer);
    cardTimer = setTimeout(() => {
      cardFor = u;
      renderCard(u);
      placeCard(block);
      const rec = cache[u];
      if (!rec || !('n' in rec)) {
        if (!pending.has(u)) pending.set(u, []);
        pending.get(u).push(block);
        enqueue(u, true);
      }
    }, 450);
  }
  // إخفاء متأخر قليلا، حتى يقدر المستخدم ينقل الماوس إلى البطاقة ويضغط زر الثقة
  function onLeave(now) {
    clearTimeout(cardTimer);
    clearTimeout(hideTimer);
    const hide = () => { cardFor = null; if (card) card.classList.remove('on'); };
    if (now === true) hide(); else hideTimer = setTimeout(hide, 250);
  }

  function onPage(u) {
    return [...document.querySelectorAll(`[data-xoa-u="${u.toLowerCase()}"]`)];
  }
  function paint(u) {
    u = u.toLowerCase();
    const rec = cache[u];
    const els = new Set([...(pending.get(u) || []), ...onPage(u)]);
    pending.delete(u);
    for (const el of els) {
      if (!el.isConnected) continue;
      el.setAttribute('data-xoa', 'done');
      el.querySelectorAll(':scope > .xoa-badge').forEach(b => b.remove());
      for (const b of makeBadges(rec, u)) el.appendChild(b);
    }
    if (cardFor === u) renderCard(u);
  }
  // الضغط على الشارة: يلغي النتيجة المحفوظة ويعيد الفحص فورا
  function onBadgeClick(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    const badgeEl = ev.currentTarget;
    const block = badgeEl.parentElement;
    const u = block && block.getAttribute('data-xoa-u');
    if (!u) return;
    block.querySelectorAll(':scope > .xoa-badge').forEach(b => { if (b !== badgeEl) b.remove(); });
    badgeEl.textContent = '⏳';
    delete cache[u];
    saveSoon();
    if (!pending.has(u)) pending.set(u, []);
    pending.get(u).push(block);
    enqueue(u, true);
  }

  // ---------- مظهر اكس: فاتح أو داكن ----------
  function syncTheme() {
    try {
      const bg = getComputedStyle(document.body).backgroundColor.match(/\d+/g) || [255, 255, 255];
      const lum = (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]);
      document.documentElement.setAttribute('data-xoa-theme', lum < 100 ? 'dark' : 'light');
    } catch (_) {}
  }

  // ---------- رصد الأسماء على الشاشة ----------
  const RESERVED = new Set(['home', 'explore', 'notifications', 'messages', 'i', 'settings', 'search', 'compose', 'jobs', 'premium', 'tos', 'privacy']);
  function usernameOf(block) {
    for (const a of block.querySelectorAll('a[href^="/"]')) {
      const m = /^\/([A-Za-z0-9_]{1,15})$/.exec(a.getAttribute('href'));
      if (m && !RESERVED.has(m[1].toLowerCase())) return m[1];
    }
    const t = /@([A-Za-z0-9_]{1,15})/.exec(block.textContent || '');
    return t ? t[1] : null;
  }

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      handle(e.target);
    }
  }, { rootMargin: '200px 0px' });

  function handle(block) {
    if (!settings.enabled || block.getAttribute('data-xoa') === 'done') return;
    const u0 = usernameOf(block);
    if (!u0) return;
    const u = u0.toLowerCase();
    block.setAttribute('data-xoa-u', u);
    if (!block.__xoaHover) {
      block.__xoaHover = true;
      block.addEventListener('mouseenter', onEnter);
      block.addEventListener('mouseleave', () => onLeave());
    }
    const isProfile = block.getAttribute('data-testid') === 'UserName';
    const rec = cache[u];
    if (!pending.has(u)) pending.set(u, []);
    pending.get(u).push(block);
    if (rec && rec.exp > Date.now()) {
      paint(u);
      if (isProfile) { pending.set(u, [block]); enqueue(u, true); }
      return;
    }
    enqueue(u, isProfile);
  }

  function scan() {
    if (!settings.enabled) return;
    syncTheme();
    document.querySelectorAll('[data-testid="User-Name"]:not([data-xoa]), [data-testid="UserName"]:not([data-xoa])')
      .forEach(el => { el.setAttribute('data-xoa', 'seen'); io.observe(el); });
  }

  load().then(() => {
    scan();
    new MutationObserver(() => { clearTimeout(scan._t); scan._t = setTimeout(scan, 250); })
      .observe(document.documentElement, { childList: true, subtree: true });
  });
})();

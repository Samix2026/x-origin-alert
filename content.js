// يرصد أسماء الحسابات الظاهرة على الشاشة، ويطلب موقعها بمعدل محدود،
// ويضع علامة تحذير عند ظهور منطقة من القائمة أو مؤشر VPN أو كثرة تغيير اسم المستخدم،
// ويعرض بطاقة معلومات الحساب عند المرور بالماوس على الاسم.
(() => {
  const DEFAULTS = { enabled: true, regions: ['West Asia', 'North Africa'], warnVpn: true, warnRenames: true, renameLimit: 10 };
  const TTL_OK = 14 * 24 * 3600 * 1000;      // تخزين النتيجة 14 يوما
  const TTL_EMPTY = 2 * 24 * 3600 * 1000;    // حساب بلا بيانات: يومان
  const TTL_FLAG = 24 * 3600 * 1000;         // التحذير يعاد فحصه بعد يوم واحد
  const GAP_MS = 2500;                        // طلب واحد كل 2.5 ثانية كحد أقصى
  const CACHE_KEY = 'xoa_cache';

  let settings = { ...DEFAULTS };
  let cache = {};
  let saveTimer = null;
  const pending = new Map();   // username -> [elements]
  const queue = [];
  let busy = false;
  let pausedUntil = 0;
  let reqId = 0;

  const log = (...a) => console.debug('[XOA]', ...a);

  // ---------- التخزين ----------
  async function load() {
    const s = await chrome.storage.local.get(['xoa_settings', CACHE_KEY]);
    settings = { ...DEFAULTS, ...(s.xoa_settings || {}) };
    cache = s[CACHE_KEY] || {};
    const now = Date.now();
    for (const [u, v] of Object.entries(cache)) {
      if (!v || v.exp < now) { delete cache[u]; continue; }
      // تحذير محفوظ أقدم من يوم، أو من نسخة سابقة بلا وقت فحص: يحذف ليعاد فحصه
      if (classify(v) && (!v.t || now - v.t > TTL_FLAG)) { delete cache[u]; continue; }
      // نتيجة من نسخة سابقة بلا بيانات البطاقة: يعاد فحصها خلال يوم بالتدريج
      if (!('n' in v)) v.exp = Math.min(v.exp, now + Math.random() * TTL_FLAG);
    }
  }
  function store(u, out) {
    const rec = { b: out.basedIn || null, v: !!out.vpn, s: out.source || null, c: out.created || null,
      n: out.renames || 0, nl: out.renamedAt || null, vs: out.verifiedSince || null, t: Date.now() };
    const basedIn = rec.b;
    const ttl = classify(rec) ? TTL_FLAG : (basedIn ? TTL_OK : TTL_EMPTY);
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
  async function setStatus(status) {
    chrome.storage.local.set({ xoa_status: { status, at: Date.now() } }).catch(() => {});
  }
  chrome.storage.onChanged.addListener((ch) => {
    if (ch.xoa_settings) {
      settings = { ...DEFAULTS, ...(ch.xoa_settings.newValue || {}) };
      document.querySelectorAll('.xoa-badge').forEach(b => b.remove());
      onLeave();
      document.querySelectorAll('[data-xoa]').forEach(e => e.removeAttribute('data-xoa'));
      scan();
    }
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
    // تخطي من لم يعد ظاهرا على الشاشة
    const els = (pending.get(u) || []).filter(e => e.isConnected);
    if (!els.length && !onPage(u).length) { pending.delete(u); busy = false; pump(); return; }

    const out = await ask(u);
    log(u, out);
    if (out.status === 'ok') {
      store(u, out);
      bump('checked');
      if (classify(cache[u.toLowerCase()])) bump('flagged');
      setStatus('ok');
      paint(u);
    } else if (out.status === 'ratelimit') {
      pausedUntil = out.reset ? out.reset * 1000 + 2000 : Date.now() + 15 * 60 * 1000;
      queue.unshift(u);
      setStatus('ratelimit');
      log('rate limited until', new Date(pausedUntil).toLocaleTimeString());
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

  // ---------- التصنيف والرسم ----------
  function classify(rec) {
    if (!rec) return null;
    const regions = settings.regions.map(r => r.trim().toLowerCase()).filter(Boolean);
    const reasons = [];
    if (rec.b && regions.includes(rec.b.toLowerCase())) reasons.push('region');
    if (settings.warnVpn && rec.v) reasons.push('vpn');
    if (settings.warnRenames && rec.n >= Math.max(1, Number(settings.renameLimit) || 10)) reasons.push('renames');
    return reasons.length ? reasons : null;
  }

  // شارة مستقلة لكل سبب، حتى لا يختلط النص العربي بالإنجليزي
  function makeBadge(rec, reason) {
    const b = document.createElement('span');
    b.className = 'xoa-badge';
    if (reason === 'region') { b.textContent = '⚠ ' + rec.b; b.dir = 'ltr'; }
    if (reason === 'vpn') { b.textContent = '⚠ VPN'; b.dir = 'ltr'; }
    if (reason === 'renames') { b.textContent = `⚠ غير اسمه ${rec.n} مرة`; b.dir = 'rtl'; }
    b.title = 'اضغط لإعادة الفحص الآن';
    b.addEventListener('click', onBadgeClick, true);
    return b;
  }

  // ---------- بطاقة معلومات الحساب ----------
  const fmt = (ms) => { try { return new Date(ms).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { month: 'long', year: 'numeric' }); } catch (_) { return ''; } };
  let card = null, cardTimer = null, cardFor = null;
  function cardEl() {
    if (card) return card;
    card = document.createElement('div');
    card.className = 'xoa-card';
    card.dir = 'rtl';
    document.body.appendChild(card);
    return card;
  }
  function row(label, value, warn) {
    const r = document.createElement('div');
    r.className = 'xoa-row' + (warn ? ' xoa-warn' : '');
    const l = document.createElement('span'); l.className = 'xoa-l'; l.textContent = label;
    const v = document.createElement('span'); v.className = 'xoa-v'; v.textContent = value;
    r.append(l, v);
    return r;
  }
  function renderCard(u) {
    const rec = cache[u];
    const c = cardEl();
    c.replaceChildren();
    const h = document.createElement('div'); h.className = 'xoa-h'; h.dir = 'ltr'; h.textContent = '@' + u;
    c.appendChild(h);
    if (!rec || !('n' in rec)) {
      c.appendChild(row('', 'جاري الفحص…'));
      return;
    }
    const reasons = classify(rec) || [];
    c.appendChild(row('مكان الحساب', rec.b || 'غير متاح', reasons.includes('region')));
    if (rec.v) c.appendChild(row('ملاحظة اكس', 'قد يتصل عبر VPN', reasons.includes('vpn')));
    c.appendChild(row('الاتصال عبر', rec.s || 'غير متاح'));
    if (rec.c) c.appendChild(row('تاريخ الإنشاء', fmt(rec.c)));
    c.appendChild(row('التوثيق', rec.vs ? 'منذ ' + fmt(rec.vs) : 'غير موثق'));
    c.appendChild(row('تغيير اسم المستخدم', rec.n ? `${rec.n} مرة` + (rec.nl ? '، آخرها ' + fmt(rec.nl) : '') : 'لم يتغير', reasons.includes('renames')));
    const f = document.createElement('div'); f.className = 'xoa-f'; f.textContent = 'البيانات من اكس. مؤشر وليس حكما.';
    c.appendChild(f);
  }
  function placeCard(anchor) {
    const c = cardEl();
    const r = anchor.getBoundingClientRect();
    const w = 300;
    let left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
    let top = r.bottom + 8;
    c.style.left = left + 'px';
    c.style.top = top + 'px';
    c.classList.add('on');
    const ch = c.getBoundingClientRect().height;
    if (top + ch > window.innerHeight - 8) c.style.top = Math.max(8, r.top - ch - 8) + 'px';
  }
  function onEnter(ev) {
    const block = ev.currentTarget;
    const u = block.getAttribute('data-xoa-u');
    if (!u) return;
    clearTimeout(cardTimer);
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
  function onLeave() {
    clearTimeout(cardTimer);
    cardFor = null;
    if (card) card.classList.remove('on');
  }

  function onPage(u) {
    return [...document.querySelectorAll(`[data-xoa-u="${u.toLowerCase()}"]`)];
  }
  function paint(u) {
    const rec = cache[u.toLowerCase()];
    const els = new Set([...(pending.get(u) || []), ...onPage(u)]);
    pending.delete(u);
    const reasons = classify(rec) || [];
    for (const el of els) {
      if (!el.isConnected) continue;
      el.setAttribute('data-xoa', 'done');
      el.querySelectorAll(':scope > .xoa-badge').forEach(b => b.remove());
      for (const r of reasons) el.appendChild(makeBadge(rec, r));
    }
    if (cardFor === u.toLowerCase()) renderCard(cardFor);
  }
  // الضغط على العلامة: يلغي النتيجة المحفوظة ويعيد الفحص فورا
  function onBadgeClick(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    const badge = ev.currentTarget;
    const block = badge.parentElement;
    const u = block && block.getAttribute('data-xoa-u');
    if (!u) return;
    block.querySelectorAll(':scope > .xoa-badge').forEach(b => { if (b !== badge) b.remove(); });
    badge.textContent = '⏳';
    delete cache[u];
    saveSoon();
    if (!pending.has(u)) pending.set(u, []);
    pending.get(u).push(block);
    enqueue(u, true);
  }

  // ---------- رصد الأسماء على الشاشة ----------
  const RESERVED = new Set(['home', 'explore', 'notifications', 'messages', 'i', 'settings', 'search', 'compose', 'jobs', 'premium', 'tos', 'privacy']);
  function usernameOf(block) {
    for (const a of block.querySelectorAll('a[href^="/"]')) {
      const m = /^\/([A-Za-z0-9_]{1,15})$/.exec(a.getAttribute('href'));
      if (m && !RESERVED.has(m[1].toLowerCase())) return m[1];
    }
    // صفحة البروفايل: الاسم يظهر كنص @user
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
      block.addEventListener('mouseleave', onLeave);
    }
    const isProfile = block.getAttribute('data-testid') === 'UserName';
    const rec = cache[u];
    if (!pending.has(u)) pending.set(u, []);
    pending.get(u).push(block);
    if (rec && rec.exp > Date.now()) {
      paint(u);
      // صفحة البروفايل تفحص من جديد دائما، وتظهر النتيجة المحفوظة مؤقتا حتى يصل الرد
      if (isProfile) { pending.set(u, [block]); enqueue(u, true); }
      return;
    }
    enqueue(u, isProfile);
  }

  function scan() {
    if (!settings.enabled) return;
    document.querySelectorAll('[data-testid="User-Name"]:not([data-xoa]), [data-testid="UserName"]:not([data-xoa])')
      .forEach(el => { el.setAttribute('data-xoa', 'seen'); io.observe(el); });
  }

  load().then(() => {
    scan();
    new MutationObserver(() => { clearTimeout(scan._t); scan._t = setTimeout(scan, 250); })
      .observe(document.documentElement, { childList: true, subtree: true });
  });
})();

// يرصد أسماء الحسابات الظاهرة على الشاشة، ويطلب موقعها بمعدل محدود،
// ويضع علامة تحذير عند ظهور منطقة من القائمة أو مؤشر VPN.
(() => {
  const DEFAULTS = { enabled: true, regions: ['West Asia', 'North Africa'], warnVpn: true };
  const TTL_OK = 14 * 24 * 3600 * 1000;      // تخزين النتيجة 14 يوما
  const TTL_EMPTY = 2 * 24 * 3600 * 1000;    // حساب بلا بيانات: يومان
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
    for (const [u, v] of Object.entries(cache)) if (!v || v.exp < now) delete cache[u];
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
  function enqueue(u) {
    if (!queue.includes(u)) queue.push(u);
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
    if (!els.length) { pending.delete(u); busy = false; pump(); return; }

    const out = await ask(u);
    log(u, out);
    if (out.status === 'ok') {
      cache[u.toLowerCase()] = { b: out.basedIn, v: !!out.vpn, exp: Date.now() + (out.basedIn ? TTL_OK : TTL_EMPTY) };
      saveSoon();
      bump('checked');
      setStatus('ok');
      paint(u);
    } else if (out.status === 'ratelimit') {
      pausedUntil = out.reset ? out.reset * 1000 + 2000 : Date.now() + 15 * 60 * 1000;
      queue.unshift(u);
      setStatus('ratelimit');
      log('rate limited until', new Date(pausedUntil).toLocaleTimeString());
    } else if (out.status === 'nouser') {
      cache[u.toLowerCase()] = { b: null, v: false, exp: Date.now() + TTL_EMPTY };
      pending.delete(u);
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
    return reasons.length ? reasons : null;
  }

  function makeBadge(rec, reasons) {
    const b = document.createElement('span');
    b.className = 'xoa-badge';
    const parts = [];
    if (reasons.includes('region')) parts.push(rec.b);
    if (reasons.includes('vpn')) parts.push('VPN');
    b.textContent = '⚠ ' + parts.join(' · ');
    const tip = [];
    if (reasons.includes('region')) tip.push(`اكس تعرض موقع هذا الحساب كمنطقة عامة: ${rec.b}، ولا تعرض دولة محددة.`);
    if (reasons.includes('vpn')) tip.push('اكس تشير إلى أن الحساب قد يتصل عبر VPN أو بروكسي، فالموقع المعروض قد لا يكون دقيقا.');
    tip.push('هذا مؤشر وليس حكما. تحقق قبل التفاعل.');
    b.title = tip.join('\n');
    return b;
  }

  function paint(u) {
    const rec = cache[u.toLowerCase()];
    const els = pending.get(u) || [];
    pending.delete(u);
    const reasons = classify(rec);
    if (reasons) bump('flagged');
    for (const el of els) {
      if (!el.isConnected) continue;
      el.setAttribute('data-xoa', 'done');
      if (reasons && !el.querySelector('.xoa-badge')) el.appendChild(makeBadge(rec, reasons));
    }
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
    const u = usernameOf(block);
    if (!u) return;
    const rec = cache[u.toLowerCase()];
    if (!pending.has(u)) pending.set(u, []);
    pending.get(u).push(block);
    if (rec && rec.exp > Date.now()) { paint(u); return; }
    enqueue(u);
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

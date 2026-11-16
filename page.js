// يعمل داخل صفحة اكس نفسها. يعيد استخدام جلسة المستخدم المفتوحة لطلب بيانات
// About this account. لا يرسل أي شيء خارج x.com ولا يحفظ أي بيانات دخول.
(() => {
  if (window.__xoaPage) return;
  window.__xoaPage = true;

  const FALLBACK_QUERY_ID = 'XRqGa7EeokUU5kppkh13EA';
  let queryId = null;
  let headers = null;
  let headersReady = false;

  try { queryId = localStorage.getItem('__xoa_qid'); } catch (_) {}

  const KEEP = ['authorization', 'x-csrf-token', 'x-twitter-auth-type',
    'x-twitter-active-user', 'x-twitter-client-language', 'content-type'];

  function keepHeaders(h) {
    if (!h) return;
    const out = {};
    const put = (k, v) => { if (KEEP.includes(String(k).toLowerCase())) out[String(k).toLowerCase()] = v; };
    if (h instanceof Headers) h.forEach((v, k) => put(k, v));
    else if (Array.isArray(h)) h.forEach(([k, v]) => put(k, v));
    else Object.entries(h).forEach(([k, v]) => put(k, v));
    if (out.authorization) { headers = out; headersReady = true; }
  }

  function noteUrl(url) {
    const m = /\/i\/api\/graphql\/([^/]+)\/AboutAccountQuery/.exec(url || '');
    if (m && m[1] !== queryId) {
      queryId = m[1];
      try { localStorage.setItem('__xoa_qid', queryId); } catch (_) {}
    }
  }

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.includes('/i/api/graphql/')) {
        noteUrl(url);
        keepHeaders((init && init.headers) || (input && input.headers));
      }
    } catch (_) {}
    return origFetch.apply(this, arguments);
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSet = XMLHttpRequest.prototype.setRequestHeader;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, url) { this.__xoaUrl = url; this.__xoaH = {}; return origOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) { try { this.__xoaH[k] = v; } catch (_) {} return origSet.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    try {
      if (String(this.__xoaUrl || '').includes('/i/api/graphql/')) { noteUrl(String(this.__xoaUrl)); keepHeaders(this.__xoaH); }
    } catch (_) {}
    return origSend.apply(this, arguments);
  };

  function detectVpn(about) {
    if (!about || typeof about !== 'object') return false;
    if (about.location_accurate === false) return true;
    // احتياط إذا غيرت اكس اسم الحقل: أي مفتاح يذكر vpn أو proxy بقيمة صحيحة
    for (const [k, v] of Object.entries(about)) {
      if (/vpn|proxy/i.test(k) && v === true) return true;
      if (/accurate/i.test(k) && v === false) return true;
    }
    return false;
  }

  async function lookup(screenName) {
    for (let i = 0; i < 50 && !headersReady; i++) await new Promise(r => setTimeout(r, 100));
    if (!headersReady) return { status: 'noauth' };
    const id = queryId || FALLBACK_QUERY_ID;
    const url = `https://${location.host}/i/api/graphql/${id}/AboutAccountQuery?variables=` +
      encodeURIComponent(JSON.stringify({ screenName }));
    let res;
    try {
      res = await origFetch.call(window, url, { credentials: 'include', headers });
    } catch (e) { return { status: 'neterr' }; }
    if (res.status === 429) {
      return { status: 'ratelimit', reset: Number(res.headers.get('x-rate-limit-reset')) || 0 };
    }
    if (res.status === 404 || res.status === 400) return { status: 'badquery' };
    if (!res.ok) return { status: 'http' + res.status };
    let data;
    try { data = await res.json(); } catch (_) { return { status: 'parse' }; }
    const result = data && data.data && data.data.user_result_by_screen_name && data.data.user_result_by_screen_name.result;
    if (!result) return { status: 'nouser' };
    const about = result.about_profile || null;
    const num = (x) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? n : null; };
    const uc = (about && about.username_changes) || {};
    const created = result.core && result.core.created_at ? Date.parse(result.core.created_at) : NaN;
    const vinfo = result.verification_info && result.verification_info.reason;
    return {
      status: 'ok',
      basedIn: (about && about.account_based_in) || null,
      vpn: detectVpn(about),
      source: (about && about.source) || null,
      created: Number.isFinite(created) ? created : null,
      renames: Number(uc.count) || 0,
      renamedAt: num(uc.last_changed_at_msec),
      verifiedSince: result.is_blue_verified ? num(vinfo && vinfo.verified_since_msec) : null,
      keys: about ? Object.keys(about) : [],
      remaining: Number(res.headers.get('x-rate-limit-remaining'))
    };
  }

  window.addEventListener('message', async (ev) => {
    if (ev.source !== window || !ev.data || ev.data.src !== 'xoa-req') return;
    const { id, screenName } = ev.data;
    const out = await lookup(screenName);
    window.postMessage({ src: 'xoa-res', id, out }, '*');
  });
})();

// Collect anime data; the native app performs secure GitHub sync.
const collected = await (async () => {
// Script Browser: async function body; no import/export or outer wrapper.
// Collects episodes listed on the current page and their player URLs.
const MAX_EPISODES = 300;
const REQUEST_DELAY_MS = 350;
const TIMEOUT_MS = 20000;
const deadline = Date.now() + 10 * 60 * 1000;
const origin = location.origin;
const animeTitle = document.title.split(/\s+[—–|]\s*/)[0].replace(/^[اأإ]نمي\s+/,'').replace(/\s+\d{4}\s+مترجم.*$/,'').trim();
const absolute = (value, base) => {
  try {
    const u = new URL(value, base);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch { return null; }
};
function findAnimeUrl(doc, base) {
  const candidates = [...doc.querySelectorAll('link[rel="canonical"], meta[property="og:url"], .show-info__crumbs-link[href], .breadcrumb a[href], .breadcrumbs a[href]')]
    .map(el => el.getAttribute('href') || el.getAttribute('content'));
  candidates.push(base);
  for (const raw of candidates) {
    const value = absolute(raw, base);
    if (!value) continue;
    const url = new URL(value);
    if (url.origin === origin && /^\/anime\/[^/]+\/?$/.test(url.pathname)) {
      url.hash = ''; url.search = '';
      return url.href;
    }
  }
  return null;
}
let animeUrl = findAnimeUrl(document, location.href);
const clean = value => (value || '').replace(/\s+/g, ' ').trim();
const numberOf = value => {
  const normalized = value.replace(/[٠-٩]/g, c => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
  const m = normalized.match(/(?:الحلقة|حلقة|episode|\bep\b)[\s:_-]*(\d+)/i);
  return m ? Number(m[1]) : null;
};
const candidates = new Map();
for (const a of document.querySelectorAll('a[href]')) {
  const url = absolute(a.getAttribute('href'), location.href);
  if (!url || new URL(url).origin !== origin) continue;
  let decoded = url;
  try { decoded = decodeURIComponent(url); } catch {}
  const text = clean(a.textContent || a.getAttribute('aria-label'));
  const inEpisodes = a.closest('#epsGrid, .epsGrid, #show-episodes, .show-episodes, .episodes-list, .episode-list');
  const number = numberOf(text) ?? numberOf(decoded);
  if (!inEpisodes && number === null) continue;
  if (/الحلقة التالية|الحلقة السابقة|تفاصيل الحلقة/.test(text)) continue;
  const u = new URL(url);
  u.hash = '';
  const key = u.href;
  const old = candidates.get(key);
  if (!old || numberOf(text) !== null) candidates.set(key, { number, title: number === null ? text : `الحلقة ${number}`, url: key });
}
// On Yalanime the watch links identify this show's episodes precisely.
let episodes = [...candidates.values()];
if (episodes.some(e => /\/watch\/?(?:\?|$)/.test(e.url))) {
  episodes = episodes.filter(e => /\/watch\/?(?:\?|$)/.test(e.url));
}
episodes.sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity));
const discovered = episodes.length;
episodes = episodes.slice(0, MAX_EPISODES);
if (!episodes.length) return {
  page: location.href,
  error: 'لم أجد روابط حلقات واضحة. افتح صفحة الأنمي أو قائمة حلقاته. قد يحتاج هذا الموقع محددات خاصة.',
  episodes: []
};
function extract(doc, base) {
  const found = new Map();
  const add = (raw, label, type) => {
    const url = absolute(raw, base);
    if (!url) return;
    const key = url;
    const old = found.get(key);
    const rank = {player:4, media:3, iframe:2, 'host-link':1};
    if (!old || rank[type] > rank[old.type]) {
      const title = clean(label) || old?.label || new URL(url).hostname;
      found.set(key, { label: title, type, url, quality: title.match(/\b(?:FHD|HD|SD|4K|1080p|720p|480p)\b/i)?.[0] || old?.quality || '' });
    }
  };
  for (const el of doc.querySelectorAll('[data-server], [data-embed], [data-video], [data-src], iframe[src], video[src], video source[src], a[href]')) {
    const label = el.textContent || el.getAttribute('title') || el.getAttribute('aria-label') || '';
    for (const attr of ['data-server', 'data-embed', 'data-video']) {
      if (el.hasAttribute(attr)) add(el.getAttribute(attr), label, 'player');
    }
    if (el.tagName === 'IFRAME') add(el.getAttribute('src') || el.getAttribute('data-src'), label, 'iframe');
    if (el.tagName === 'VIDEO' || el.tagName === 'SOURCE') add(el.getAttribute('src'), label, 'media');
    if (el.tagName === 'A') {
      const raw = el.getAttribute('href') || '';
      if (/dood|d000|uqload|mega\.nz|morencius|vidara|streamtape|filemoon|streamwish|mixdrop|\.m3u8(?:\?|$)|\.mp4(?:\?|$)/i.test(raw)) {
        add(raw, label, /\.m3u8(?:\?|$)|\.mp4(?:\?|$)/i.test(raw) ? 'media' : 'host-link');
      }
    }
  }
  return [...found.values()];
}
const results = [];
function findCover(doc, base) {
  const candidates = [
    ...Array.from(doc.querySelectorAll('.anime-poster img, .poster img, .post-thumbnail img, .anime-image img')).map(el => el.getAttribute('data-src') || el.getAttribute('src')),
    ...Array.from(doc.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]')).map(el => el.content),
    ...Array.from(doc.querySelectorAll('img[alt]')).filter(el => animeTitle && el.alt.toLowerCase().includes(animeTitle.toLowerCase())).map(el => el.getAttribute('data-src') || el.getAttribute('src'))
  ];
  return candidates.map(raw => raw ? absolute(raw, base) : null).find(url => url && !/logo|grey\.gif|placeholder|avatar/i.test(url)) || null;
}
let image = findCover(document, location.href);
let coverAttempted = false;
for (const episode of episodes) {
  if (Date.now() >= deadline) break;
  try {
    let doc;
    let base = episode.url;
    const current = new URL(location.href); current.hash = '';
    if (episode.url === current.href) doc = document;
    else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(TIMEOUT_MS, deadline - Date.now()));
      try {
        const response = await fetch(episode.url, { credentials: 'same-origin', signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (new URL(response.url).origin !== origin) throw new Error('Unexpected redirect outside site');
        base = response.url;
        const html = await response.text();
        doc = new DOMParser().parseFromString(html, 'text/html');
      } finally { clearTimeout(timer); }
    }
    if (!image) image = findCover(doc, base);
    if (!animeUrl) animeUrl = findAnimeUrl(doc, base);
    if ((!image || !animeUrl) && !coverAttempted) {
      const details = Array.from(doc.querySelectorAll('a[href]')).find(a => /تفاصيل الحلقة/.test(a.textContent));
      const detailsUrl = details && absolute(details.getAttribute('href'), base);
      if (detailsUrl && new URL(detailsUrl).origin === origin) {
        coverAttempted = true;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
          const response = await fetch(detailsUrl, {credentials:'same-origin', signal:controller.signal});
          if (response.ok && new URL(response.url).origin === origin) {
            const detailsDoc = new DOMParser().parseFromString(await response.text(), 'text/html');
            if (!image) image = findCover(detailsDoc, response.url);
            if (!animeUrl) animeUrl = findAnimeUrl(detailsDoc, response.url);
          }
        } catch {} finally { clearTimeout(timer); }
      }
    }
    const links = extract(doc, base);
    results.push({ ...episode, links, ...(links.length ? {} : { warning: 'لا توجد روابط ظاهرة في HTML؛ قد تتطلب الصفحة JavaScript أو تسجيل دخول.' }) });
  } catch (error) {
    results.push({ ...episode, links: [], error: String(error.message || error) });
  }
  if (episode !== episodes[episodes.length - 1]) await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
}
return {
  title: animeTitle,
  ...(animeUrl ? { animeUrl } : {}),
  ...(image ? { image } : {}),
  page: location.href,
  discovered,
  processed: results.length,
  truncated: discovered > results.length,
  note: 'روابط السيرفرات مستخرجة فقط ولم يتم التحقق من تشغيلها. يجمع الحلقات المدرجة في الصفحة الحالية؛ لا يجتاز صفحات القوائم تلقائياً.',
  episodes: results
};

})();
return { ...collected, action: 'syncAnimeLibrary' };


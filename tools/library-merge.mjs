const titleKey = value => String(value ?? '').normalize('NFKC').trim()
  .replace(/^[اأإ]نمي\s+/, '').replace(/\s+/g, ' ').toLowerCase();
export function pageKey(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return null;
    return `${url.hostname.replace(/^www\./, '').toLowerCase()}${decodeURIComponent(url.pathname).replace(/\/+$/, '')}`;
  } catch { return null; }
}
const numberOf = value => {
  const text = String(value ?? '').replace(/[٠-٩]/g, c => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error('Invalid episode number');
  return Number(text);
};
function safeUrl(value) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) throw new Error('Invalid URL');
  return url.href;
}
export function mergeCollected(library, collected, {onlyExisting = true} = {}) {
  if (!Array.isArray(library.anime)) throw new Error('library.json must contain an anime array');
  const staged = structuredClone(library);
  const counts = {shows: 0, addedEpisodes: 0, updatedEpisodes: 0};
  for (const data of collected) {
    if (typeof data.title !== 'string' || !data.title.trim() || !Array.isArray(data.episodes)) throw new Error('Invalid extracted anime');
    const key = pageKey(data.animeUrl);
    if (!key) throw new Error('Invalid anime URL');
    let show = staged.anime.find(a => a && (
      (key && pageKey(a.animeUrl) === key) ||
      (data.originalUrl && pageKey(a.animeUrl) === pageKey(data.originalUrl)) ||
      (a.title && titleKey(a.title) === titleKey(data.title))
    ));
    // Respect entries removed while a scheduled run was collecting data.
    if (!show && onlyExisting) continue;
    if (!show) { show = {title: data.title, animeUrl: data.animeUrl, episodes: []}; staged.anime.push(show); }
    if (typeof show.title !== 'string' || !show.title.trim()) show.title = data.title;
    show.animeUrl = safeUrl(data.animeUrl);
    if (data.image) show.image = safeUrl(data.image);
    if (!Object.hasOwn(show, 'episodes')) show.episodes = [];
    if (!Array.isArray(show.episodes)) throw new Error('Invalid stored episode list');
    const valid = data.episodes.filter(e => !e.error && Array.isArray(e.links) && e.links.length);
    for (const episode of valid) {
      const number = numberOf(episode.number);
      let old = show.episodes.find(e => numberOf(e.number) === number);
      if (!old) { old = {number, title: episode.title || `الحلقة ${number}`, links: []}; show.episodes.push(old); counts.addedEpisodes++; }
      else counts.updatedEpisodes++;
      if (!old.title || /^مشاهدة(?: الحلقة)?$/.test(old.title.trim())) old.title = `الحلقة ${number}`;
      if (!Array.isArray(old.links)) throw new Error('Invalid stored episode links');
      const rank = {player: 4, media: 3, iframe: 2, 'host-link': 1};
      for (const link of episode.links) {
        safeUrl(link.url);
        const normalized = {...link, label: link.label || new URL(link.url).hostname};
        if (!normalized.quality) normalized.quality = normalized.label.match(/\b(?:FHD|HD|SD|4K|1080p|720p|480p)\b/i)?.[0] || '';
        const existing = old.links.find(l => l.url === link.url);
        if (!existing) old.links.push(normalized);
        else if ((rank[link.type] || 0) >= (rank[existing.type] || 0)) {
          for (const [field, value] of Object.entries(normalized)) if (value !== '' && value != null) existing[field] = value;
        }
      }
    }
    show.episodes.sort((a, b) => numberOf(a.number) - numberOf(b.number));
    counts.shows++;
  }
  return {library: staged, counts};
}

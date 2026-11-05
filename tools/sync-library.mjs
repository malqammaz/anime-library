import {readFile, writeFile, appendFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {DOMParser} from 'linkedom';
import {mergeCollected, pageKey} from './library-merge.mjs';

const SITE = 'https://yalanime.com';
const REPOSITORY = 'malqammaz/anime-library';
const API = `https://api.github.com/repos/${REPOSITORY}/contents/library.json`;
const deadlineMarker = 'const deadline = Date.now() + 10 * 60 * 1000;';
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const allowedPage = raw => {
  const url = new URL(raw);
  if (!/^https?:$/.test(url.protocol) || !['yalanime.com', 'www.yalanime.com'].includes(url.hostname) || url.username || url.password || url.port) throw new Error('Only Yalanime page URLs are supported');
  return new URL(url.pathname + url.search, SITE);
};

// Parse HTML only. No scripts, ads, media players or downloads are executed.
export async function fetchPage(raw, options = {}) {
  let url = allowedPage(raw);
  for (let redirect = 0; redirect < 5; redirect++) {
    const response = await fetch(url, {
      signal: options.signal,
      redirect: 'manual',
      headers: {'User-Agent': 'AnimeLibrarySync/1.0', Accept: 'text/html'},
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const target = response.headers.get('location');
      await response.body?.cancel();
      if (!target) throw new Error('Redirect has no location');
      url = allowedPage(new URL(target, url));
      continue;
    }
    return response;
  }
  throw new Error('Too many redirects');
}

export async function collectShow(show, {source, deadline, fetchHtml = fetchPage}) {
  const pageUrl = allowedPage(show.animeUrl);
  let response = await fetchHtml(pageUrl.href, {signal: AbortSignal.timeout(Math.min(30000, Math.max(1, deadline - Date.now())))});
  if (!response.ok) throw new Error(`Anime page HTTP ${response.status}`);
  let base = new URL(response.url || pageUrl);
  let doc = new DOMParser().parseFromString(await response.text(), 'text/html');
  if (!/^\/anime\/[^/]+\/?$/.test(base.pathname)) {
    const details = [...doc.querySelectorAll('.show-info__crumbs-link[href], .breadcrumb a[href], .breadcrumbs a[href]')]
      .map(a => new URL(a.getAttribute('href'), base))
      .find(url => ['yalanime.com', 'www.yalanime.com'].includes(url.hostname) && /^\/anime\/[^/]+\/?$/.test(url.pathname));
    if (!details) throw new Error('Could not find the anime detail page');
    response = await fetchHtml(allowedPage(details).href, {signal: AbortSignal.timeout(Math.min(30000, Math.max(1, deadline - Date.now())))});
    if (!response.ok) throw new Error(`Anime detail page HTTP ${response.status}`);
    base = new URL(response.url || details);
    doc = new DOMParser().parseFromString(await response.text(), 'text/html');
  }
  if (!source.includes(deadlineMarker)) throw new Error('Collector deadline marker changed');
  const bounded = source.replace(deadlineMarker, 'const deadline = Math.min(runDeadline, Date.now() + 10 * 60 * 1000);');
  const invoke = new AsyncFunction('document', 'location', 'DOMParser', 'fetch', 'runDeadline', bounded);
  const result = await invoke(doc, base, DOMParser, fetchHtml, deadline);
  if (result.error || !result.episodes?.some(e => !e.error && e.links?.length)) throw new Error(result.error || 'No successfully extracted episodes');
  const title = typeof show.title === 'string' && show.title.trim() ? show.title : result.title;
  if (!title) throw new Error('The anime page has no title');
  return {...result, title, animeUrl: base.href, originalUrl: show.animeUrl};
}

async function apiRequest(token, method = 'GET', body) {
  const response = await fetch(API + (method === 'GET' ? '?ref=main' : ''), {
    method, redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: {Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json'},
    ...(body ? {body: JSON.stringify(body)} : {}),
  });
  if (!response.ok) {
    const error = new Error(`GitHub HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}
function decodeLibrary(file) {
  if (file.encoding !== 'base64' || !file.content || !file.sha) throw new Error('Could not read library.json');
  const library = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
  if (!Array.isArray(library.anime)) throw new Error('Invalid library format');
  return library;
}
export async function saveCollected(collected, request) {
  for (let attempt = 0; attempt < 3; attempt++) {
    // Re-read immediately before writing so phone edits and new entries survive.
    const file = await request('GET');
    const latest = decodeLibrary(file);
    const merged = mergeCollected(latest, collected);
    if (JSON.stringify(latest) === JSON.stringify(merged.library)) return {unchanged: true, ...merged.counts};
    try {
      await request('PUT', {
        message: `Sync anime library (${merged.counts.shows} anime)`, branch: 'main', sha: file.sha,
        content: Buffer.from(JSON.stringify(merged.library, null, 2) + '\n').toString('base64'),
      });
      return {unchanged: false, ...merged.counts};
    } catch (error) {
      if (error.status !== 409 || attempt === 2) throw error;
    }
  }
}

export async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
  if (!(limit > 0)) throw new Error('Invalid --limit');
  const token = process.env.GITHUB_TOKEN;
  if (!dryRun && !token) throw new Error('GITHUB_TOKEN is required; use --dry-run to test locally');
  const request = (method, body) => apiRequest(token, method, body);
  const library = dryRun ? JSON.parse(await readFile('library.json', 'utf8')) : decodeLibrary(await request('GET'));
  if (!Array.isArray(library.anime)) throw new Error('Invalid anime list');
  const source = await readFile(new URL('./yalanime-collector.js', import.meta.url), 'utf8');
  const deadline = Date.now() + 90 * 60 * 1000;
  const collected = [], failures = [], skipped = [];
  const seen = new Set();
  const queue = [];
  for (const show of library.anime) {
    if (!show?.animeUrl) { skipped.push({title: show?.title || '', reason: 'Missing animeUrl'}); continue; }
    const key = pageKey(show.animeUrl);
    if (key && seen.has(key)) continue;
    seen.add(key);
    queue.push(show);
  }
  for (const [index, show] of queue.slice(0, limit).entries()) {
    if (Date.now() >= deadline - 30000) {
      failures.push({error: 'Run time limit reached; some anime remain unprocessed'});
      break;
    }
    console.log(`Collecting ${index + 1}/${Math.min(queue.length, limit)}: ${show.title || 'URL-only entry'}`);
    try {
      const result = await collectShow(show, {source, deadline});
      collected.push(result);
      const errors = result.episodes.filter(e => e.error || !e.links?.length).length;
      console.log(`Collected ${result.processed} episodes; ${errors} incomplete`);
      if (result.truncated || errors) failures.push({title: result.title, error: 'Partial extraction; existing data retained'});
    } catch (error) {
      failures.push({title: show.title || '', url: show.animeUrl, error: String(error.message)});
      console.error(`Anime ${index + 1} failed: ${error.message}`);
    }
  }
  const saved = dryRun ? {dryRun: true, ...mergeCollected(library, collected).counts} : await saveCollected(collected, request);
  const report = {saved, extracted: collected.length, failures, skipped};
  await writeFile('sync-report.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY,
      `## Anime library sync\n\nAnime collected: ${collected.length}\n\nNew episodes: ${saved.addedEpisodes}\n\nMerged episodes: ${saved.updatedEpisodes}\n\nFailures/partial results: ${failures.length}\n\nSkipped entries: ${skipped.length}\n\nLibrary unchanged: ${saved.unchanged ?? 'dry run'}\n`);
  }
  // Save successful results first, then mark failures so Actions can report them.
  if (failures.length) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

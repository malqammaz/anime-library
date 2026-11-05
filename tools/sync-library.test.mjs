import {readFile} from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import {collectShow, saveCollected} from './sync-library.mjs';
import {mergeCollected} from './library-merge.mjs';

const source = await readFile(new URL('./yalanime-collector.js', import.meta.url), 'utf8');
const url = 'https://yalanime.com/anime/test/';
const showHtml = `<html><head><title>انمي Test Anime 2026 مترجم كامل - Yalanime</title>
<meta property="og:image" content="https://images.example/poster.jpg"></head>
<body><div id="epsGrid"><a href="/episode-1/watch/">الحلقة 1</a></div></body></html>`;
const playerHtml = `<html><head><title>Episode</title></head><body>
<button data-server="https://player.example/1">Dood FHD</button>
<iframe src="https://player.example/1"></iframe></body></html>`;
const fixtureFetch = async page => ({ok: true, url: page, text: async () => page.includes('/watch/') ? playerHtml : showHtml});
const episode = {number: 1, title: 'الحلقة 1', links: [{url: 'https://player.example/1', label: 'Player HD', type: 'player'}]};
const extracted = () => ({title: 'Test Anime', animeUrl: url, image: 'https://images.example/poster.jpg', episodes: [structuredClone(episode)]});
const file = (library, sha = 'current') => ({sha, encoding: 'base64', content: Buffer.from(JSON.stringify(library)).toString('base64')});

test('Cloud collector extracts title, poster and player links using real HTML parsing', async () => {
  const result = await collectShow({animeUrl: url}, {source, deadline: Date.now() + 60000, fetchHtml: fixtureFetch});
  assert.equal(result.title, 'Test Anime');
  assert.equal(result.image, 'https://images.example/poster.jpg');
  assert.equal(result.processed, 1);
  assert.equal(result.episodes[0].links.length, 1);
  assert.equal(result.episodes[0].links[0].label, 'Dood FHD');
});
test('Collector follows episode breadcrumbs and preserves an existing custom title', async () => {
  const fetchHtml = async page => page.includes('/old-episode/') ? {
    ok: true, url: page, text: async () => `<a class="show-info__crumbs-link" href="${url}">Test</a>`,
  } : fixtureFetch(page);
  const result = await collectShow({title: 'My custom title', animeUrl: 'https://yalanime.com/old-episode/'}, {source, deadline: Date.now() + 60000, fetchHtml});
  assert.equal(result.title, 'My custom title');
  assert.equal(result.animeUrl, url);
});
test('Rejects outside URLs before attempting a request', async () => {
  await assert.rejects(collectShow({animeUrl: 'http://127.0.0.1/'}, {
    source, deadline: Date.now() + 60000, fetchHtml: () => assert.fail('Unexpected request'),
  }), /Only Yalanime/);
});
test('Fills URL-only entries, preserves metadata and is idempotent', () => {
  const library = {custom: true, anime: [{animeUrl: url, watched: true}, {title: 'Other', episodes: []}]};
  const first = mergeCollected(library, [extracted()]);
  assert.equal(first.library.anime.length, 2);
  assert.equal(first.library.anime[0].title, 'Test Anime');
  assert.equal(first.library.anime[0].watched, true);
  assert.equal(first.counts.addedEpisodes, 1);
  assert.deepEqual(mergeCollected(first.library, [extracted()]).library, first.library);
  assert.equal(library.anime[0].title, undefined);
});
test('Retains old player links and ignores failed episodes', () => {
  const library = {anime: [{title: 'Test Anime', animeUrl: url, episodes: [{number: '01', links: [{url: 'https://old.example/1'}]}]}]};
  const data = extracted();
  data.episodes.push({number: 2, error: 'Timed out', links: []});
  const merged = mergeCollected(library, [data]);
  assert.equal(merged.library.anime[0].episodes.length, 1);
  assert.equal(merged.library.anime[0].episodes[0].links.length, 2);
});
test('Does not restore an entry removed during collection', () => {
  const result = mergeCollected({anime: []}, [extracted()]);
  assert.equal(result.library.anime.length, 0);
});
test('Unchanged sync does not send a GitHub write', async () => {
  const stored = mergeCollected({anime: [{animeUrl: url}]}, [extracted()]).library;
  const result = await saveCollected([extracted()], async method => {
    assert.equal(method, 'GET'); return file(stored);
  });
  assert.equal(result.unchanged, true);
});
test('Retries a conflicting write with the latest SHA and keeps concurrent additions', async () => {
  let reads = 0, writes = 0;
  const result = await saveCollected([extracted()], async (method, body) => {
    if (method === 'GET') {
      reads++;
      return file({anime: [{animeUrl: url}, ...(reads > 1 ? [{title: 'Added by phone', episodes: []}] : [])]}, `sha-${reads}`);
    }
    writes++;
    assert.equal(body.sha, `sha-${reads}`);
    if (writes === 1) { const error = new Error('Conflict'); error.status = 409; throw error; }
    const saved = JSON.parse(Buffer.from(body.content, 'base64').toString());
    assert.equal(saved.anime.length, 2);
    assert.equal(saved.anime[1].title, 'Added by phone');
    return {};
  });
  assert.equal(result.unchanged, false);
  assert.equal(writes, 2);
});

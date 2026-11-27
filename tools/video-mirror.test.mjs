import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareVideos} from './video-mirror.mjs';

const mega = `https://mega.nz/file/12345678#${'k'.repeat(43)}`;
const original = {url: mega, type: 'host-link'};
const episode = number => ({number, links: [{...original}]});
const library = numbers => ({anime: [{
  title: 'Anime',
  animeUrl: 'https://yalanime.com/anime/test/',
  episodes: numbers.map(episode),
}]});

test('downloads the latest 20 episodes, reuses assets and prunes after updating links', async () => {
  const assets = [], downloaded = [], deleted = [], failures = [], logs = [];
  const storage = {
    list: async () => [...assets],
    async upload(name) {
      const asset = {name, id: assets.length + 1, state: 'uploaded', size: 100, browser_download_url: `https://github.com/${name}`};
      assets.push(asset);
      return asset;
    },
    async remove(id) { deleted.push(id); },
  };
  const options = {
    storage, deadline: Date.now() + 60000, failures, log: message => logs.push(message),
    async download(url) {
      downloaded.push(url);
      return {path: 'fixture.mp4', extension: '.mp4'};
    },
  };
  const first = library([1, 21, 2, ...Array.from({length: 18}, (_, i) => i + 3)]);
  const firstRun = await prepareVideos(first, options);
  firstRun.apply(first);
  assert.deepEqual(first.anime[0].episodes.slice(0, 3).map(e => e.links.length), [1, 2, 2]);
  assert.deepEqual(downloaded, Array(20).fill(`https://mega.nz/#!12345678!${'k'.repeat(43)}`));
  assert.equal(firstRun.linkedCount, 20);
  assert.deepEqual(logs.filter(message => message.startsWith('[Video 1/20]')), [
    '[Video 1/20] Anime, episode 21: Downloading from MEGA',
    '[Video 1/20] Anime, episode 21: Uploading to GitHub Releases',
    '[Video 1/20] Anime, episode 21: Upload complete',
  ]);

  const unchanged = structuredClone(first);
  const secondRun = await prepareVideos(first, options);
  secondRun.apply(first);
  assert.deepEqual(first, unchanged);
  assert.equal(downloaded.length, 20);
  assert.equal(logs.at(-1), '[Video 20/20] Anime, episode 2: Already on GitHub, skipping download');

  first.anime[0].episodes.push(episode(22));
  const next = await prepareVideos(first, options);
  assert.equal(downloaded.length, 21);
  assert.deepEqual(deleted, []);
  next.apply(first);
  assert.deepEqual(first.anime[0].episodes.slice(0, 3).map(e => e.links.length), [1, 2, 1]);
  assert.deepEqual(first.anime[0].episodes[2].links, [original]);
  await next.prune();
  const expired = assets.find(asset => asset.browser_download_url === unchanged.anime[0].episodes[2].links[0].url);
  assert.deepEqual(deleted, [expired.id]);
  assert.deepEqual(failures, []);
});

test('limits simultaneous downloads to three', {timeout: 3000}, async () => {
  const data = library([1, 2]);
  data.anime.push({...library([1, 2]).anime[0], animeUrl: 'https://yalanime.com/anime/another/'});
  let active = 0, peak = 0;
  const ready = Promise.withResolvers();
  const failures = [];
  const result = await prepareVideos(data, {
    deadline: Date.now() + 60000,
    failures,
    log() {},
    storage: {
      list: async () => [],
      upload: async name => ({id: name, name, state: 'uploaded', size: 100, browser_download_url: `https://github.com/${name}`}),
    },
    async download() {
      peak = Math.max(peak, ++active);
      if (active === 3) ready.resolve();
      await ready.promise;
      active--;
      return {path: 'fixture.mp4', extension: '.mp4'};
    },
  });
  result.apply(data);
  assert.equal(peak, 3);
  assert.equal(result.linkedCount, 4);
  assert.deepEqual(failures, []);
});

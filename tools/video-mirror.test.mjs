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

test('downloads the latest two episodes, reuses assets and prunes after updating links', async () => {
  const assets = [], downloaded = [], deleted = [], failures = [];
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
    storage, deadline: Date.now() + 60000, failures,
    async download(url) {
      downloaded.push(url);
      return {path: 'fixture.mp4', extension: '.mp4'};
    },
  };
  const first = library([1, 3, 2]);
  const firstRun = await prepareVideos(first, options);
  firstRun.apply(first);
  assert.deepEqual(first.anime[0].episodes.map(e => e.links.length), [1, 2, 2]);
  assert.deepEqual(downloaded, Array(2).fill(`https://mega.nz/#!12345678!${'k'.repeat(43)}`));
  assert.equal(firstRun.linkedCount, 2);

  const unchanged = structuredClone(first);
  const secondRun = await prepareVideos(first, options);
  secondRun.apply(first);
  assert.deepEqual(first, unchanged);
  assert.equal(downloaded.length, 2);

  first.anime[0].episodes.push(episode(4));
  const next = await prepareVideos(first, options);
  assert.equal(downloaded.length, 3);
  assert.deepEqual(deleted, []);
  next.apply(first);
  assert.deepEqual(first.anime[0].episodes.map(e => e.links.length), [1, 2, 1, 2]);
  assert.deepEqual(first.anime[0].episodes[2].links, [original]);
  await next.prune();
  assert.deepEqual(deleted, [2]);
  assert.deepEqual(failures, []);
});

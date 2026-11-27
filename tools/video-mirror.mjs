import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {openAsBlob} from 'node:fs';
import {mkdtemp, readdir, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {extname, join} from 'node:path';
import {promisify} from 'node:util';
import {numberOf, pageKey} from './library-merge.mjs';

const exec = promisify(execFile);
const tag = 'episode-videos';
const linkType = 'github-video';
const videoExtensions = new Set(['.mp4', '.mkv', '.webm', '.mov', '.m4v', '.avi']);
const assetPattern = /^(episode-[a-f0-9]{64})\.(?:mp4|mkv|webm|mov|m4v|avi)$/;

function latestEpisodes(library) {
  const entries = new Map();
  for (const show of library.anime) {
    const key = pageKey(show?.animeUrl);
    if (!key) continue;
    const latest = [...(show.episodes ?? [])].sort((a, b) => numberOf(b.number) - numberOf(a.number)).slice(0, 2);
    for (const episode of latest) {
      const id = createHash('sha256').update(JSON.stringify([key, numberOf(episode.number)])).digest('hex');
      entries.set(`episode-${id}`, {show, episode});
    }
  }
  return entries;
}

function megaLink(raw) {
  const match = /^https:\/\/(?:www\.)?mega\.nz\/(?:file|embed)\/([\w-]{8})#([\w-]{43})$/.exec(raw);
  return match && `https://mega.nz/#!${match[1]}!${match[2]}`;
}

async function downloadMega(url, directory, deadline) {
  try {
    await exec('megatools', ['dl', '--no-progress', '--path', directory, url], {
      env: {PATH: process.env.PATH},
      timeout: Math.min(5 * 60 * 1000, Math.max(1, deadline - Date.now())),
      killSignal: 'SIGKILL',
    });
  } catch {
    throw new Error('MEGA download failed or timed out');
  }
  const files = await readdir(directory, {withFileTypes: true});
  if (files.length !== 1 || !files[0].isFile()) throw new Error('Expected one downloaded video');
  const path = join(directory, files[0].name);
  const extension = extname(path).toLowerCase();
  const {size} = await stat(path);
  if (!videoExtensions.has(extension) || size === 0 || size >= 2 ** 31) {
    throw new Error('Unsupported video extension or file size');
  }
  return {path, extension};
}

export function releaseStorage(repository, token) {
  const api = `https://api.github.com/repos/${repository}`;
  async function request(path, {method = 'GET', body, allowMissing = false, upload = false, timeout = 30000} = {}) {
    const response = await fetch(`${upload ? 'https://uploads.github.com/repos/' + repository : api}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(timeout),
      headers: {Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'Content-Type': upload ? 'application/octet-stream' : 'application/json'},
      body: upload || !body ? body : JSON.stringify(body),
    });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub Releases HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  }
  let release;
  return {
    async list() {
      release = await request(`/releases/tags/${tag}`, {allowMissing: true});
      if (!release) return [];
      const assets = [];
      for (let page = 1; ; page++) {
        const batch = await request(`/releases/${release.id}/assets?per_page=100&page=${page}`);
        assets.push(...batch);
        if (batch.length < 100) return assets;
      }
    },
    async upload(name, file, deadline) {
      release ??= await request('/releases', {method: 'POST', body: {
        tag_name: tag, target_commitish: 'main', name: 'Latest episode videos', prerelease: true, make_latest: 'false',
      }});
      const body = await openAsBlob(file);
      return request(`/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, {
        method: 'POST', body, upload: true, timeout: Math.min(5 * 60 * 1000, Math.max(1, deadline - Date.now())),
      });
    },
    remove(id) {
      return request(`/releases/assets/${id}`, {method: 'DELETE', allowMissing: true});
    },
  };
}

export async function prepareVideos(library, {storage, deadline, failures, download = downloadMega}) {
  const assets = await storage.list();
  const available = new Map();
  for (const asset of assets) {
    const match = assetPattern.exec(asset.name);
    if (match && asset.state === 'uploaded' && asset.size > 0) available.set(match[1], asset);
  }

  for (const [key, {show, episode}] of latestEpisodes(library)) {
    if (available.has(key)) continue;
    if (Date.now() >= deadline) {
      failures.push({error: 'Video mirror time limit reached; remaining episodes will be retried'});
      break;
    }
    const url = episode.links.map(link => megaLink(link.url)).find(Boolean);
    if (!url) {
      failures.push({title: show.title, episode: episode.number, error: 'No supported MEGA file link'});
      continue;
    }
    const directory = await mkdtemp(join(tmpdir(), 'anime-video-'));
    try {
      const {path, extension} = await download(url, directory, deadline);
      const name = key + extension;
      for (const asset of assets.filter(asset => asset.name === name && asset.state === 'starter')) {
        await storage.remove(asset.id);
      }
      const asset = await storage.upload(name, path, deadline);
      if (asset.state !== 'uploaded' || !asset.browser_download_url || !asset.size) throw new Error('GitHub did not confirm the upload');
      available.set(key, asset);
      assets.push(asset);
    } catch (error) {
      failures.push({title: show.title, episode: episode.number, error: error.message});
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  }

  let linkedAssets = new Set();
  return {
    apply(current) {
      linkedAssets = new Set();
      for (const show of current.anime) {
        for (const episode of show?.episodes ?? []) {
          episode.links = episode.links.filter(link => link.type !== linkType);
        }
      }
      for (const [key, {episode}] of latestEpisodes(current)) {
        const asset = available.get(key);
        if (!asset) continue;
        linkedAssets.add(asset.id);
        episode.links.unshift({url: asset.browser_download_url, label: 'تحميل من GitHub', type: linkType, quality: ''});
      }
    },
    async prune() {
      for (const asset of assets) {
        if (!assetPattern.test(asset.name) || linkedAssets.has(asset.id)) continue;
        try {
          await storage.remove(asset.id);
        } catch (error) {
          failures.push({error: `Could not remove expired video ${asset.name}: ${error.message}`});
        }
      }
    },
    get linkedCount() { return linkedAssets.size; },
  };
}

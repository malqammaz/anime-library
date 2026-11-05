const endpoint = 'https://api.github.com/repos/malqammaz/anime-library/contents/library.json';
const titleKey = value => String(value ?? '').normalize('NFKC').trim().toLowerCase();
function pageKey(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return null;
    return `${url.hostname.replace(/^www\./, '')}${decodeURIComponent(url.pathname).replace(/\/+$/, '')}`;
  } catch { return null; }
}
const encode = value => {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
};

export async function deleteAnimeFromRepository({anime, token, fetchImpl = fetch}) {
  if (!token?.trim()) throw new Error('أدخل GitHub token بصلاحية Contents: Read and write لمستودع anime-library.');
  const key = pageKey(anime.animeUrl);
  if (!key && !anime.title?.trim()) throw new Error('تعذر تحديد الأنمي المراد حذفه.');
  async function request(method, body) {
    const response = await fetchImpl(endpoint + (method === 'GET' ? '?ref=main' : ''), {
      method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000),
      headers: {Accept: 'application/vnd.github+json', Authorization: `Bearer ${token.trim()}`,
        'X-GitHub-Api-Version': '2022-11-28', ...(body ? {'Content-Type': 'application/json'} : {})},
      ...(body ? {body: JSON.stringify(body)} : {}),
    });
    if (!response.ok) {
      const message = [401, 403, 404].includes(response.status)
        ? 'تعذر الحفظ. تحقق من التوكن وصلاحية Contents: Read and write لمستودع anime-library.'
        : response.status === 409 ? 'تغيرت المكتبة أثناء الحفظ. حاول مرة أخرى.' : `تعذر الحفظ على GitHub (${response.status}).`;
      const error = new Error(message); error.status = response.status; throw error;
    }
    return response.json();
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const file = await request('GET');
    if (file.encoding !== 'base64' || !file.content || !file.sha) throw new Error('تعذر قراءة ملف المكتبة من GitHub.');
    const library = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(file.content.replace(/\s/g, '')), c => c.charCodeAt(0))));
    if (!Array.isArray(library.anime)) throw new Error('صيغة المكتبة غير صحيحة؛ لم يتم حذف أي شيء.');
    const matches = library.anime.map((show, index) => ({show, index})).filter(({show}) =>
      show && (key ? pageKey(show.animeUrl) === key : titleKey(show.title) === titleKey(anime.title)));
    if (matches.length > 1) throw new Error('يوجد أكثر من سجل مطابق؛ راجع المكتبة قبل الحذف.');
    if (!matches.length) return {library, alreadyDeleted: true};
    library.anime.splice(matches[0].index, 1);
    try {
      await request('PUT', {message: `Remove anime: ${anime.title || 'URL-only entry'}`, branch: 'main', sha: file.sha,
        content: encode(JSON.stringify(library, null, 2) + '\n')});
      return {library, alreadyDeleted: false};
    } catch (error) {
      if (error.status !== 409 || attempt === 2) throw error;
    }
  }
}

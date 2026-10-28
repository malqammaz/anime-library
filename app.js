(() => {
  'use strict';
  const KEY = 'anime-library-v1';
  const $ = id => document.getElementById(id);
  const safeUrl = value => { try { const u = new URL(value); return /^https?:$/.test(u.protocol) ? u.href : null; } catch { return null; } };
  const sample = { anime: [{ title: 'The Vermilion Mask', episodes: [
    { number: 1, title: 'الحلقة 1', links: [{label:'Dood',quality:'FHD',url:'https://dood.to/e/n0suxtoym77y'}] },
    { number: 2, title: 'الحلقة 2', links: [{label:'Dood',quality:'FHD',url:'https://dood.to/e/nclsplww5sid'}] },
    { number: 3, title: 'الحلقة 3', links: [{label:'Dood',quality:'FHD',url:'https://dood.to/e/ojsvdvetmz5u'},{label:'Uqload',quality:'FHD',url:'https://uqload.vc/embed-mqgjo0ipz3nm.html'}] }
  ] }] };
  function normalize(data) {
    const list = Array.isArray(data.anime) ? data.anime : Array.isArray(data.episodes) ? [data] : null;
    if (!list) throw new Error('الملف يجب أن يحتوي anime أو episodes.');
    return {anime:list.map((a,i) => {
      if (!a || !Array.isArray(a.episodes)) throw new Error(`قائمة الحلقات غير صحيحة في العنصر ${i+1}.`);
      return {title:String(a.title || a.name || `أنمي ${i+1}`),image:safeUrl(a.image || a.poster || ''),episodes:a.episodes.map((e,j) => {
        if (!e || !Array.isArray(e.links)) throw new Error(`روابط الحلقة ${j+1} غير صحيحة.`);
        return {number:e.number ?? j+1,title:String(e.title || `الحلقة ${e.number ?? j+1}`),links:e.links.map(l => {
          if (!l || typeof l !== 'object') throw new Error('صيغة رابط غير صحيحة.');
          const url = safeUrl(l.url); if (!url) throw new Error('يوجد رابط غير صالح؛ استخدم http أو https.');
          return {label:String(l.label || new URL(url).hostname),quality:String(l.quality || ''),type:String(l.type || ''),url};
        })};
      })};
    })};
  }
  let library = sample;
  let saved = false;
  let listView = false;
  try { listView = localStorage.getItem('anime-library-list-view') === 'true'; } catch {}
  try { const stored = localStorage.getItem(KEY); if (stored) {library=normalize(JSON.parse(stored));saved=true;} } catch {}
  const notify = text => { $('message').textContent=text; $('message').hidden=false; };
  const WATCHED_KEY = 'anime-library-watched-v1';
  let watched = new Set();
  try {
    const stored = JSON.parse(localStorage.getItem(WATCHED_KEY) || '[]');
    if (Array.isArray(stored)) watched = new Set(stored.filter(x => typeof x === 'string'));
  } catch {}
  const showKey = title => title.normalize('NFKC').trim().toLowerCase();
  function toggleWatched(title) {
    const key = showKey(title), updated = new Set(watched);
    if (!updated.delete(key)) updated.add(key);
    try {
      localStorage.setItem(WATCHED_KEY, JSON.stringify([...updated]));
      watched = updated;
      render();
    } catch { notify('تعذر حفظ حالة المشاهدة. تأكد من السماح بالتخزين في المتصفح.'); }
  }
  function route() {
    const match = location.hash.match(/^#anime\/(\d+)(?:\/episode\/(\d+))?$/);
    if (!match) return {};
    const ai=Number(match[1]),ei=match[2] === undefined ? undefined : Number(match[2]);
    if (!library.anime[ai] || (ei!==undefined && !library.anime[ai].episodes[ei])) return {};
    return {ai,ei};
  }
  function crumb(text,href) { const el=document.createElement(href === undefined?'span':'a');el.textContent=text;if(href!==undefined)el.href=href;$('breadcrumbs').append(el); }
  function render() {
    const {ai,ei}=route(),a=library.anime[ai],e=a?.episodes[ei];
    $('title').textContent=e?.title || a?.title || 'مكتبة الأنمي';
    $('subtitle').textContent=e?'اختَر السيرفر لفتح رابط الحلقة.':a?'كل الحلقات، مرتّبة في مجلد واحد.':'تصفّح الأنميات، افتح الحلقات، واختَر رابط المشاهدة.';
    $('search').placeholder=e?'ابحث عن سيرفر أو جودة…':a?'ابحث عن حلقة…':'ابحث عن أنمي…';
    $('stats').replaceChildren();
    const shows = library.anime.length;
    const viewed = library.anime.filter(show => watched.has(showKey(show.title))).length;
    for(const [value,label] of [[shows,'أنمي'],[viewed,'تمت مشاهدته']]){
      const stat=document.createElement('div');stat.className='stat';
      const number=document.createElement('strong');number.textContent=value.toLocaleString('ar');
      const name=document.createElement('span');name.textContent=label;stat.append(number,name);$('stats').append(stat);
    }
    $('breadcrumbs').replaceChildren();crumb('المكتبة','#');
    if(a){crumb('／');crumb(a.title,`#anime/${ai}`);}if(e){crumb('／');crumb(e.title);}
    const query=$('search').value.trim().toLowerCase();
    const entries=e?e.links.map(l=>({title:l.label,meta:l.type==='host-link'?'صفحة استضافة · فتح المشاهدة':'رابط مشاهدة · فتح السيرفر',url:l.url,badge:l.quality,icon:'▷'})):a?a.episodes.map((ep,i)=>({title:ep.title,meta:'عرض السيرفرات',href:`#anime/${ai}/episode/${i}`,icon:String(ep.number).padStart(2,'0')})):library.anime.map((item,i)=>({title:item.title,image:item.image,showTitle:item.title,meta:'تصفّح الحلقات',href:`#anime/${i}`,icon:'▤'}));
    const filtered=entries.filter(x=>(x.title+' '+x.meta+' '+(x.badge||'')).toLowerCase().includes(query));
    if($('sort').value==='name')filtered.sort((x,y)=>x.title.localeCompare(y.title,'ar',{numeric:true}));
    $('count').textContent=ai===undefined?`${filtered.length} أنمي`:'';$('items').replaceChildren();
    $('items').className='grid'+(e?' links':a?' episodes':listView?' list':'');
    $('view').hidden=ai!==undefined;
    $('view').textContent=listView?'عرض بطاقات':'عرض قائمة';
    $('view').setAttribute('aria-pressed',String(listView));
    for(const item of filtered){
      const card=document.createElement('article');card.className='card';
      const link=document.createElement('a');link.className='card-link';link.href=item.url || item.href;card.append(link);
      const add=(tag,cls,text)=>{const el=document.createElement(tag);el.className=cls;el.textContent=text;link.append(el);};
      add('span','icon',item.icon);add('span','arrow','←');add('h2','',item.title);add('span','meta',item.meta);
      if(item.image){const img=document.createElement('img');img.className='cover';img.alt=item.title;img.loading='lazy';img.referrerPolicy='no-referrer';img.src=item.image;img.addEventListener('error',()=>{img.remove();card.classList.remove('has-cover');});link.prepend(img);card.classList.add('has-cover');}
      if(item.badge)add('span','badge',item.badge);if(item.url)add('span','url',new URL(item.url).hostname);
      if(item.showTitle){
        const viewed=watched.has(showKey(item.showTitle));
        const button=document.createElement('button');button.className='watched-toggle'+(viewed?' is-watched':'');
        button.type='button';button.textContent=viewed?'✓ تمت المشاهدة':'وضع علامة كمُشاهد';
        button.setAttribute('aria-pressed',String(viewed));
        button.setAttribute('aria-label',`${viewed?'إلغاء علامة المشاهدة عن':'وضع علامة كمُشاهد على'} ${item.showTitle}`);
        button.addEventListener('click',()=>{toggleWatched(item.showTitle);const replacement=[...document.querySelectorAll('.watched-toggle')].find(b=>b.getAttribute('aria-label').endsWith(' '+item.showTitle));replacement?.focus();});
        card.append(button);
      }
      $('items').append(card);
    }
    if(!filtered.length){const empty=document.createElement('div');empty.className='empty';empty.textContent=query?'لا توجد نتائج مطابقة.':'لا توجد عناصر في هذا المجلد حالياً.';$('items').append(empty);}
  }
  $('search').addEventListener('input',render);
  $('sort').addEventListener('change',render);
  $('view').addEventListener('click',()=>{listView=!listView;try{localStorage.setItem('anime-library-list-view',String(listView));}catch{}render();});
  window.addEventListener('hashchange',()=>{$('search').value='';render();});
  render();
  if(!saved && location.protocol!=='file:') fetch('library.json').then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{library=normalize(data);render();}).catch(()=>{});
})();

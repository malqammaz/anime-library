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
  try { const stored = localStorage.getItem(KEY); if (stored) {library=normalize(JSON.parse(stored));saved=true;} } catch {}
  const notify = text => { $('message').textContent=text; $('message').hidden=false; };
  function persist() { try {localStorage.setItem(KEY,JSON.stringify(library));return true;} catch {notify('تم فتح البيانات، لكن تعذر حفظها في المتصفح. صدّر JSON للاحتفاظ بها.');return false;} }
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
    $('breadcrumbs').replaceChildren();crumb('المكتبة','#');
    if(a){crumb('／');crumb(a.title,`#anime/${ai}`);}if(e){crumb('／');crumb(e.title);}
    const query=$('search').value.trim().toLowerCase();
    const entries=e?e.links.map(l=>({title:l.label,meta:l.type==='host-link'?'صفحة استضافة':'رابط مشاهدة',url:l.url,badge:l.quality,icon:'↗'})):a?a.episodes.map((ep,i)=>({title:ep.title,meta:`${ep.links.length} روابط`,href:`#anime/${ai}/episode/${i}`,icon:'▤'})):library.anime.map((item,i)=>({title:item.title,image:item.image,meta:`${item.episodes.length} حلقات`,href:`#anime/${i}`,icon:'▰'}));
    const filtered=entries.filter(x=>(x.title+' '+x.meta+' '+(x.badge||'')).toLowerCase().includes(query));
    $('count').textContent=`${filtered.length} عناصر`;$('items').replaceChildren();
    for(const item of filtered){
      const card=document.createElement('a');card.className='card';card.href=item.url || item.href;
      const add=(tag,cls,text)=>{const el=document.createElement(tag);el.className=cls;el.textContent=text;card.append(el);};
      add('span','icon',item.icon);add('span','arrow','↖');add('h2','',item.title);add('span','meta',item.meta);
      if(item.image){const img=document.createElement('img');img.className='cover';img.alt=item.title;img.loading='lazy';img.referrerPolicy='no-referrer';img.src=item.image;img.addEventListener('error',()=>{img.remove();card.classList.remove('has-cover');});card.prepend(img);card.classList.add('has-cover');}
      if(item.badge)add('span','badge',item.badge);if(item.url)add('span','url',new URL(item.url).hostname);
      $('items').append(card);
    }
    if(!filtered.length){const empty=document.createElement('div');empty.className='empty';empty.textContent=query?'لا توجد نتائج مطابقة.':'هذا المجلد فارغ. استورد ملف JSON لإضافة بياناتك.';$('items').append(empty);}
  }
  $('search').addEventListener('input',render);
  window.addEventListener('hashchange',()=>{$('search').value='';render();});
  $('import').addEventListener('change',async event=>{
    const file=event.target.files[0];if(!file)return;
    try{const imported=normalize(JSON.parse(await file.text()));
      // Merge by title so repeated scraper imports update rather than duplicate a show.
      for(const show of imported.anime){const index=library.anime.findIndex(a=>a.title===show.title);if(index<0)library.anime.push(show);else library.anime[index]=show;}
      const ok=persist();location.hash='';$('search').value='';render();if(ok)notify(`تم استيراد ${imported.anime.length} أنمي وحفظه في المتصفح.`);
    }catch(error){notify(`تعذر الاستيراد: ${error.message}`);}finally{event.target.value='';}
  });
  $('export').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(library,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='anime-library.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  render();
  if(!saved && location.protocol!=='file:') fetch('library.json').then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{library=normalize(data);render();}).catch(()=>{});
})();

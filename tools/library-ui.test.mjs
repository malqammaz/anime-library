import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const source=(await readFile(new URL('../app.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/,'');
const anime={title:'Test',animeUrl:'https://yalanime.com/anime/test/',episodes:[]};
const next={title:'Other',animeUrl:'https://yalanime.com/anime/other/',episodes:[]};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function setup({remove=async()=>({library:{anime:[next]}}),hash='#anime/0',fresh={anime:[anime,next]}}={}){
  const {document,window}=parseHTML(html);
  const storage=new Map([['anime-library-v1',JSON.stringify({anime:[anime,next]})],['anime-library-watched-episodes-v1','["keep"]']]);
  const dialog=document.getElementById('delete-dialog');
  dialog.showModal=()=>dialog.setAttribute('open','');
  dialog.close=()=>dialog.removeAttribute('open');
  window.HTMLElement.prototype.focus=function(){};
  const location={hash,protocol:'https:'};
  const calls=[];
  runInNewContext(source,{document,window,location,URL,console,
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
    fetch:async()=>({ok:true,json:async()=>fresh}),
    deleteAnimeFromRepository:async data=>{calls.push(data);return remove(data);},
  });
  await tick();
  return {document,window,storage,location,calls,dialog};
}
test('Delete confirmation removes anime, returns home and never stores token',async()=>{
  const ui=await setup();const $=id=>ui.document.getElementById(id);
  assert.equal($('anime-actions').hidden,false);
  $('delete-anime').click();
  assert.equal(ui.dialog.hasAttribute('open'),true);
  $('delete-token').value='TEST_TOKEN';
  $('delete-form').dispatchEvent(new ui.window.Event('submit',{cancelable:true}));
  await tick();
  assert.equal(ui.calls.length,1);
  assert.equal(ui.calls[0].anime.animeUrl,anime.animeUrl);
  assert.equal(ui.location.hash,'');
  assert.equal(ui.dialog.hasAttribute('open'),false);
  assert.equal($('delete-token').value,'');
  assert.ok(!JSON.stringify([...ui.storage]).includes('TEST_TOKEN'));
  assert.equal(ui.storage.get('anime-library-watched-episodes-v1'),'["keep"]');
  assert.ok($('items').textContent.includes('Other'));
  assert.ok(!$('items').textContent.includes('Test'));
});
test('Cancel never contacts GitHub; errors keep the anime and current page',async()=>{
  const ui=await setup({remove:async()=>{throw new Error('Permission denied');}});const $=id=>ui.document.getElementById(id);
  $('delete-anime').click();$('cancel-delete').click();
  assert.equal(ui.calls.length,0);
  $('delete-anime').click();$('delete-token').value='TEST_TOKEN';
  $('delete-form').dispatchEvent(new ui.window.Event('submit',{cancelable:true}));
  await tick();
  assert.equal(ui.location.hash,'#anime/0');
  assert.equal($('delete-error').textContent,'Permission denied');
  assert.equal(ui.dialog.hasAttribute('open'),true);
  assert.ok($('title').textContent.includes('Test'));
});
test('Fresh server data overrides an older cached library',async()=>{
  const ui=await setup({hash:'',fresh:{anime:[next]}});
  assert.ok(ui.document.getElementById('items').textContent.includes('Other'));
  assert.ok(!ui.document.getElementById('items').textContent.includes('Test'));
});

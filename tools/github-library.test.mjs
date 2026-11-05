import test from 'node:test';
import assert from 'node:assert/strict';
import {deleteAnimeFromRepository} from '../github-library.js';

const anime = {title:'أنمي تجريبي', animeUrl:'https://yalanime.com/anime/test/'};
const other = {title:'Other', animeUrl:'https://yalanime.com/anime/other/',episodes:[]};
const response = (library,sha='current') => ({ok:true,json:async()=>({sha,encoding:'base64',content:Buffer.from(JSON.stringify(library)).toString('base64')})});
test('Deletes exactly the selected URL, preserving Unicode and unrelated data',async()=>{
  const calls=[];
  const result=await deleteAnimeFromRepository({anime,token:'TEST_TOKEN',fetchImpl:async(url,options)=>{
    calls.push({url,options});
    assert.ok(url.startsWith('https://api.github.com/repos/malqammaz/anime-library/contents/library.json'));
    if(options.method==='GET')return response({custom:'احتفظ',anime:[other,{...anime,episodes:[]}]});
    const body=JSON.parse(options.body);
    assert.equal(body.sha,'current');
    const saved=JSON.parse(Buffer.from(body.content,'base64').toString('utf8'));
    assert.deepEqual(saved,{custom:'احتفظ',anime:[other]});
    return {ok:true,json:async()=>({})};
  }});
  assert.equal(result.library.anime.length,1);
  assert.equal(calls.length,2);
  assert.ok(!JSON.stringify(result).includes('TEST_TOKEN'));
});
test('Conflict retries preserve simultaneous additions rather than deleting by old position',async()=>{
  let reads=0,writes=0;
  const result=await deleteAnimeFromRepository({anime,token:'TEST_TOKEN',fetchImpl:async(_,options)=>{
    if(options.method==='GET'){reads++;return response({anime:reads===1?[anime]:[other,anime]},`sha-${reads}`);}
    writes++;
    assert.equal(JSON.parse(options.body).sha,`sha-${reads}`);
    return writes===1?{ok:false,status:409}:{ok:true,json:async()=>({})};
  }});
  assert.deepEqual(result.library.anime,[other]);
  assert.equal(writes,2);
});
test('An already deleted anime never causes another entry to be removed',async()=>{
  const result=await deleteAnimeFromRepository({anime,token:'TEST_TOKEN',fetchImpl:async(_,options)=>{
    assert.equal(options.method,'GET');return response({anime:[other]});
  }});
  assert.equal(result.alreadyDeleted,true);
  assert.deepEqual(result.library.anime,[other]);
});
test('Rejects ambiguous duplicates and bad credentials without a write',async()=>{
  await assert.rejects(deleteAnimeFromRepository({anime,token:'TEST_TOKEN',fetchImpl:async(_,options)=>{
    assert.equal(options.method,'GET');return response({anime:[anime,anime]});
  }}),/أكثر من سجل/);
  await assert.rejects(deleteAnimeFromRepository({anime,token:'TEST_TOKEN',fetchImpl:async()=>({ok:false,status:401})}),/التوكن/);
  await assert.rejects(deleteAnimeFromRepository({anime,token:'',fetchImpl:()=>assert.fail('Unexpected request')}),/token/);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('accessibility loads only packaged scripts for both installation layouts and excludes raw HTML',async()=>{
 for(const panel of ['panel.html','dist/panel.html']){
  let listener:Function=()=>{},file='';
  const result={violations:[],incomplete:[],passes:1};
  const chrome={runtime:{id:'test',getURL:(p:string)=>`chrome-extension://test/${p}`,onMessage:{addListener:(fn:Function)=>listener=fn}},tabs:{get:async()=>({url:'https://example.com/'})},scripting:{executeScript:async(options:{files?:string[]})=>{if(options.files)file=options.files[0];return [{result}];}}};
  vm.runInNewContext(readFileSync('background.js','utf8'),{chrome});
  const reply=await new Promise<any>(resolve=>listener({type:'accessibilityScan',tabId:12},{id:'test',url:chrome.runtime.getURL(panel)},resolve));
  assert.equal(file,panel==='panel.html'?'vendor/axe.min.js':'dist/vendor/axe.min.js');assert.equal(reply.data.passes,1);
 }
 const source=readFileSync('background.js','utf8');assert(source.includes('nodes:nodes.map(({target,failureSummary})'));assert(source.includes('url:location.origin'));
 assert(readFileSync('public/vendor/axe.min.js','utf8').includes('4.11.0'));
});

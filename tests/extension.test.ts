import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function worker(activeId=42, shifted=false) {
  let listener: Function;
  let inspections=0;
  let captures=0;
  const snapshot={url:'https://example.com/',width:1000,height:700,scrollX:0,scrollY:0};
  const chrome={
    runtime:{id:'test',getURL:(path:string)=>`chrome-extension://test/${path}`,onMessage:{addListener:(fn:Function)=>listener=fn}},
    tabs:{get:async()=>({active:true,url:snapshot.url,windowId:1}),captureVisibleTab:async()=>{captures++;return 'data:image/png;base64,TEST';},query:async()=>[{id:activeId}]},
    scripting:{executeScript:async()=>[{result:{...snapshot,scrollY:shifted&&inspections++>0?30:0}}]}
  };
  vm.runInNewContext(readFileSync('background.js','utf8'),{chrome});
  return { request:(sender={id:'test',url:'chrome-extension://test/panel.html'})=>new Promise<any>(resolve=>{
    const keepOpen=listener!({type:'capture',tabId:42},sender,resolve);
    if(!keepOpen) resolve(undefined);
  }),captures:()=>captures };
}
test('DevTools registers the requested panel',()=>{
  let args:unknown;
  vm.runInNewContext(readFileSync('devtools.js','utf8'),{chrome:{devtools:{panels:{create:(...value:unknown[])=>args=value}}}});
  assert.deepEqual(Array.from(args as unknown[]),['project-1','','dist/panel.html']);
});
test('packaged DevTools opens the compiled panel at its package root',()=>{
  let args:unknown;
  vm.runInNewContext(readFileSync('dist/devtools.js','utf8'),{chrome:{devtools:{panels:{create:(...value:unknown[])=>args=value}}}});
  assert.deepEqual(Array.from(args as unknown[]),['project-1','','panel.html']);
});
test('source-folder compiled panel can request capture',async()=>{
  assert.equal((await worker().request({id:'test',url:'chrome-extension://test/dist/panel.html'})).data.snapshot.width,1000);
});
test('capture returns evidence only for the inspected active tab',async()=>{
  const context=worker();const result=await context.request();
  assert.equal(result.data.snapshot.width,1000);assert.equal(context.captures(),1);
});
test('capture rejects a tab switch rather than returning the wrong website',async()=>{
  assert.match((await worker(99).request()).error,/changed during capture/);
});
test('capture rejects scrolling during screenshot acquisition',async()=>{
  assert.match((await worker(42,true).request()).error,/changed during capture/);
});
test('messages from untrusted pages cannot capture',async()=>{
  const context=worker();assert.equal(await context.request({id:'test',url:'https://example.com/'}),undefined);assert.equal(context.captures(),0);
});

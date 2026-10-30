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

function fullWorker(failOnTile=0,pageWidth=1000,pageHeight=1700) {
  let listener:Function;let position=0;let positionX=0;let captures=0;let restored=false;
  const draws:unknown[][]=[];
  const initial={url:'https://example.com/',width:pageWidth,height:pageHeight,viewportWidth:1000,viewportHeight:600,tileWidth:1000,tileHeight:600,x:0,y:0};
  const chrome={runtime:{id:'test',getURL:(path:string)=>`chrome-extension://test/${path}`,onMessage:{addListener:(fn:Function)=>listener=fn}},
    tabs:{get:async()=>({active:true,url:initial.url,windowId:1}),query:async()=>[{id:42}],captureVisibleTab:async()=>{captures++;if(captures===failOnTile)throw new Error('Capture failed');return 'data:image/png;base64,cG5n';}},
    scripting:{executeScript:async({func,args=[]}:any)=>{
      if(func.name==='positionFullPage') {
        if(args[0]==='restore'){restored=true;return [{result:undefined}];}
        position=Math.min(args[2]??0,pageHeight-600);positionX=Math.min(args[1]??0,pageWidth-1000);return [{result:{...initial,x:positionX,y:position}}];
      }
      if(func.name==='inspectViewport')return [{result:{...initial,fullPage:true,scrollX:0,scrollY:0,elements:[]}}];
      return [{result:{url:initial.url,x:positionX,y:position,width:1000,height:600}}];
    }}
  };
  class Canvas {
    constructor(public width:number,public height:number){}
    getContext(){return {fillRect(){},drawImage:(...args:unknown[])=>draws.push(args)};}
    async convertToBlob(){return new Blob(['png']);}
  }
  vm.runInNewContext(readFileSync('background.js','utf8'),{chrome,OffscreenCanvas:Canvas,Blob,Uint8Array,atob,btoa,
    createImageBitmap:async()=>({width:1000,height:600,close(){}}),setTimeout:(fn:Function)=>{fn();return 0;}});
  return {request:()=>new Promise<any>(resolve=>listener!({type:'captureFullPage',tabId:42},{id:'test',url:'chrome-extension://test/panel.html'},resolve)),
    draws,restored:()=>restored,captures:()=>captures};
}
test('full-page capture stitches clamped final tiles without duplicating overlap',async()=>{
  const context=fullWorker();const result=await context.request();
  assert.equal(result.data.snapshot.height,1700);assert.equal(result.data.snapshot.fullPage,true);
  assert.equal(context.captures(),3);assert.equal(context.draws[2][2],100);
  assert.equal(context.draws[2][6],1200);assert.equal(context.draws[2][8],500);
  assert.equal(context.restored(),true);
});
test('full-page capture restores page state even when a tile fails',async()=>{
  const context=fullWorker(2);assert.match((await context.request()).error,/Capture failed/);
  assert.equal(context.restored(),true);
});
test('full-page capture stitches horizontal overflow as well as vertical content',async()=>{
  const context=fullWorker(0,1600);const result=await context.request();
  assert.equal(result.data.snapshot.width,1600);assert.equal(context.captures(),6);
  assert.equal(context.draws[1][1],400);assert.equal(context.draws[1][5],1000);assert.equal(context.draws[1][7],600);
});
test('oversized full pages are rejected with state restored, never truncated',async()=>{
  const context=fullWorker(0,1000,13000);assert.match((await context.request()).error,/exceeds/);
  assert.equal(context.captures(),0);assert.equal(context.restored(),true);
});

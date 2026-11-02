import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const settings={presetId:'iphone-15',orientation:'portrait',width:393,height:852};
function fixture(){
 let permission=true,dimensions={width:393,height:852},detached:Function=()=>{},removed:Function=()=>{},stored:Record<string,unknown>={};
 const tabs=new Map<number,any>([[42,{id:42,windowId:1,url:'https://example.test/page',status:'complete'}]]);
 const calls:{method:string;tabId?:number;params?:any}[]=[];
 const api={storage:{session:{get:async()=>stored,set:async(value:any)=>{stored={...stored,...value};}}},permissions:{contains:async()=>permission},tabs:{get:async(id:number)=>{if(!tabs.has(id))throw Error('closed');return tabs.get(id);},update:async(id:number,value:any)=>{Object.assign(tabs.get(id),value);return tabs.get(id);},onRemoved:{addListener:(fn:Function)=>{removed=fn;}}},windows:{create:async()=>{tabs.set(99,{id:99,windowId:2,url:'about:blank',status:'complete'});return {id:2,tabs:[tabs.get(99)],left:0,top:0,width:1920,height:1080};},get:async()=>({left:0,top:0,width:1920,height:1080}),update:async(id:number,params:any)=>{calls.push({method:'window',tabId:id,params});},remove:async(id:number)=>{assert.equal(id,2);tabs.delete(99);}},debugger:{attach:async(target:any)=>{calls.push({method:'attach',tabId:target.tabId});},detach:async(target:any)=>{calls.push({method:'detach',tabId:target.tabId});},onDetach:{addListener:(fn:Function)=>{detached=fn;}},sendCommand:async(target:any,method:string,params:any)=>{calls.push({method,tabId:target.tabId,params});if(method==='Emulation.setDeviceMetricsOverride')dimensions={width:params.width,height:params.height};if(method==='Page.captureScreenshot'){const header=Buffer.alloc(33);header.writeUInt32BE(params.clip.width,16);header.writeUInt32BE(params.clip.height,20);return {data:header.toString('base64')};}return {};}}};
 const helpers={inspectViewport:function inspectViewport(){},pageQuality:function pageQuality(){},positionFullPage:function positionFullPage(){},showHighlight:function showHighlight(){}};
 api['scripting' as keyof typeof api]={executeScript:async({target,func,args}:any)=>{if(func.name==='previewDisplay'){assert.equal(target.tabId,42);return [{result:{width:1920,height:1080,left:0,top:0}}];}assert.equal(target.tabId,99);if(func===helpers.pageQuality)return [{result:{ready:true,warnings:[]}}];if(func===helpers.positionFullPage){calls.push({method:'prepare-'+args[0],tabId:99});return [{result:{}}];}if(func===helpers.inspectViewport)return [{result:{url:tabs.get(99).url,title:'Preview',width:dimensions.width,height:args?.[0]?dimensions.height*2:dimensions.height,viewportWidth:dimensions.width,viewportHeight:dimensions.height,scrollX:0,scrollY:0,fullPage:!!args?.[0],elements:[],dpr:1}}];return [{result:true}];}} as any;
 const sandbox:any={setTimeout,Uint8Array,DataView,atob,console,URL,crypto};vm.createContext(sandbox);vm.runInContext(readFileSync('device-preview.js','utf8'),sandbox);
 const manager=sandbox.createDevicePreviewManager(api,helpers);
 return {manager,calls,tabs,deny:()=>{permission=false;},detach:()=>detached({tabId:99},'canceled_by_user'),removed:()=>removed(99)};
}
test('preview requires permission and never attaches to or resizes the original tab',async()=>{
 const f=fixture();f.deny();await assert.rejects(f.manager.open(42,settings),/permission/);assert.equal(f.calls.length,0);
 const g=fixture();await g.manager.open(42,settings);assert(g.calls.filter(x=>x.method==='attach').every(x=>x.tabId===99));assert(g.calls.filter(x=>x.method==='window').every(x=>x.tabId===2));assert.equal(g.tabs.get(42).url,'https://example.test/page');
});
test('preview resize and capture are serialized and retain exact device provenance',async()=>{
 const f=fixture();await f.manager.open(42,settings);
 const landscape={...settings,orientation:'landscape',width:852,height:393};
 await Promise.all([f.manager.resize(42,{...settings,width:820,height:1180,presetId:'ipad-air'}),f.manager.resize(42,landscape)]);
 const capture=await f.manager.capture(42,landscape,'full-page');assert.equal(capture.snapshot.width,852);assert.equal(capture.snapshot.height,786);assert.equal(capture.preview.ownerTabId,42);assert.equal(capture.preview.tabId,99);assert.equal(capture.preview.orientation,'landscape');
 await assert.rejects(f.manager.highlight(42,99,'old-session',capture.snapshot,{},'1'),/older preview/);
 assert(f.calls.some(x=>x.method==='prepare-restore'));assert.equal(f.calls.filter(x=>x.method==='Page.captureScreenshot').length,1);
});
test('detach stops automatic use until explicitly reopened and close targets only the preview',async()=>{
 const f=fixture();await f.manager.open(42,settings);f.detach();const status=await f.manager.status(42);assert.equal(status.active,false);await assert.rejects(f.manager.capture(42,settings,'viewport'),/disconnected/);
 await f.manager.open(42,settings);assert.equal((await f.manager.status(42)).active,true);assert.equal(await f.manager.close(42),true);assert.equal((await f.manager.status(42)).active,false);assert(f.tabs.has(42));
});
test('invalid targets, dimensions and original navigation do not silently capture another website',async()=>{
 const f=fixture();await assert.rejects(f.manager.open(42,{...settings,width:0}),/Invalid/);f.tabs.get(42).url='chrome://extensions';await assert.rejects(f.manager.open(42,settings),/HTTP/);f.tabs.get(42).url='https://example.test/page';await f.manager.open(42,settings);f.tabs.get(42).url='https://different.test/';await assert.rejects(f.manager.capture(42,settings,'viewport'),/original tab navigated/);assert(!f.calls.some(x=>x.method==='Page.captureScreenshot'));
});

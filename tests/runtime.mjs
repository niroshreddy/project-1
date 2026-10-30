// Actual extension service-worker capture test in an isolated headless Edge profile.
// Permissions are pre-granted only in this isolated test copy.
import { chromium } from '@playwright/test';
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';

await mkdir('artifacts/runtime-extension',{recursive:true});
await cp('dist','artifacts/runtime-extension',{recursive:true});
const extensionPath=path.resolve('artifacts/runtime-extension');
const manifest=JSON.parse(await readFile(path.join(extensionPath,'manifest.json'),'utf8'));
manifest.host_permissions.push('<all_urls>');delete manifest.optional_host_permissions;
await writeFile(path.join(extensionPath,'manifest.json'),JSON.stringify(manifest));
const server=createServer((req,res)=>res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><html><head><title>Runtime fixture</title></head><body style="margin:0;background:#f7f8fc;font-family:Arial"><h1>Capture evidence</h1><button style="margin:20px;padding:12px">Visible button</button><input value="private-value"><div style="height:1800px">Scroll area</div></body></html>'));
await new Promise(resolve=>server.listen(4174,'127.0.0.1',resolve));
let context,backend;
try {
  context=await chromium.launchPersistentContext(path.resolve(`artifacts/runtime-profile-${Date.now()}`),{
    executablePath:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true,viewport:{width:1000,height:600},
    ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`]
  });
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker',{timeout:20000});
  const id=new URL(worker.url()).host;
  const page=await context.newPage();await page.goto('http://127.0.0.1:4174/');await page.bringToFront();
  const tabId=await worker.evaluate(async()=>{const tabs=await chrome.tabs.query({active:true,lastFocusedWindow:true});return tabs[0].id;});
  const captured=await worker.evaluate(id=>capture(id),tabId);
  assert.equal(captured.snapshot.width,1000);assert.equal(captured.snapshot.height,600);
  assert(captured.snapshot.elements.some(element=>element.text==='Visible button'));
  assert(!JSON.stringify(captured.snapshot.elements).includes('private-value'));
  assert(captured.image.startsWith('data:image/png;base64,'));
  await worker.evaluate(async({tabId,snapshot})=>{
    await chrome.scripting.executeScript({target:{tabId},func:showHighlight,args:[{x:.1,y:.1,width:.2,height:.1},snapshot,'1. Test highlight']});
  },{tabId,snapshot:captured.snapshot});
  assert.equal(await page.locator('#__project1_overlay').count(),1);
  await page.evaluate(()=>scrollTo(0,100));await page.waitForFunction(()=>!document.getElementById('__project1_overlay'));
  const other=await context.newPage();await other.goto('http://127.0.0.1:4174/other');
  const failure=await worker.evaluate(async id=>{try{await capture(id);return '';}catch(e){return e.message;}},tabId);
  assert.match(failure,/Select the inspected/);
  const env={...process.env,EXTENSION_ID:id};delete env.OPENAI_API_KEY;
  backend=spawn(path.resolve('.venv/Scripts/python.exe'),['-m','uvicorn','backend.app:app','--host','127.0.0.1','--port','8765'],{env,stdio:'pipe',windowsHide:true});
  let ready=false;
  for(let i=0;i<40;i++) {try {ready=(await fetch('http://127.0.0.1:8765/health')).ok;if(ready)break;}catch{}await new Promise(resolve=>setTimeout(resolve,250));}
  assert(ready,'Python service did not start');
  const result=await worker.evaluate(async()=>{
    const response=await fetch('http://127.0.0.1:8765/compare',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    return {status:response.status,body:await response.text()};
  });
  assert.equal(result.status,422,`Real extension request must pass the origin boundary: ${result.body}`);
  await page.bringToFront();
  await page.evaluate(()=>{scrollTo(0,0);document.querySelector('button').style.marginLeft='160px';});
  const changed=await worker.evaluate(id=>capture(id),tabId);
  const comparison=await worker.evaluate(async payload=>{
    const response=await fetch('http://127.0.0.1:8765/compare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    return {status:response.status,body:await response.json()};
  },{design:captured.image,actual:changed.image,snapshot:changed.snapshot});
  assert.equal(comparison.status,200,JSON.stringify(comparison.body));
  assert.equal(comparison.body.model,'local-rules-v3');
  assert(comparison.body.issues.length>0,'Real local comparison must detect changed button position');
  assert(comparison.body.issues.some(issue=>issue.basis==='measured'));
  await page.evaluate(()=>{
    const bottom=document.createElement('div');bottom.textContent='BOTTOM OF FULL PAGE';bottom.style.cssText='height:100px;background:rgb(12,120,45);color:white';document.body.append(bottom);
    const fixed=document.createElement('div');fixed.id='fixed-fixture';fixed.textContent='FIXED HEADER';fixed.style.cssText='position:fixed;top:0;left:0;background:red;color:white';document.body.append(fixed);scrollTo(0,350);
  });
  const originalScroll=await page.evaluate(()=>scrollY);
  const full=await worker.evaluate(id=>captureFullPage(id),tabId);
  assert.equal(full.snapshot.fullPage,true);assert(full.snapshot.height>1800);
  assert(full.snapshot.elements.some(element=>element.text==='BOTTOM OF FULL PAGE'));
  assert.equal(await page.evaluate(()=>scrollY),originalScroll);
  assert.equal(await page.locator('#fixed-fixture').evaluate(element=>element.style.visibility),'');
  const pixels=await page.evaluate(async data=>{
    const image=new Image();image.src=data;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
    const x=c.getContext('2d');x.drawImage(image,0,0);return {width:c.width,height:c.height,bottom:[...x.getImageData(500,c.height-30,1,1).data]};
  },full.image);
  assert.equal(pixels.height,full.snapshot.height);assert.deepEqual(pixels.bottom,[12,120,45,255]);
  await worker.evaluate(async({tabId,snapshot})=>{
    await chrome.scripting.executeScript({target:{tabId},func:showHighlight,args:[{x:.1,y:.9,width:.2,height:.04},snapshot,'Bottom issue']});
  },{tabId,snapshot:full.snapshot});
  assert(await page.evaluate(()=>scrollY)>1000);assert.equal(await page.locator('#__project1_overlay').count(),1);
  await page.evaluate(()=>document.getElementById('__project1_overlay')?.remove());
  const fullComparison=await worker.evaluate(async payload=>{
    const response=await fetch('http://127.0.0.1:8765/compare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    return {status:response.status,body:await response.json()};
  },{design:full.image,actual:full.image,snapshot:full.snapshot});
  assert.equal(fullComparison.status,200,JSON.stringify(fullComparison.body));assert.deepEqual(fullComparison.body.issues,[]);
  console.log('PASS: viewport and full-page capture, bottom pixels, below-fold DOM/highlights, fixed-element restoration, original scroll restoration, Python validation, and local comparison.');
} finally {
  backend?.kill();await context?.close();await new Promise(resolve=>server.close(resolve));
}

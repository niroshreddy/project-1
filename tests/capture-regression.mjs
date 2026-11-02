// Real-browser capture regressions. No backend or external website is used.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { cp,mkdir,readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const extensionPath=path.resolve('artifacts/capture-regression-extension');
await mkdir(extensionPath,{recursive:true});await cp('dist',extensionPath,{recursive:true});
const manifest=JSON.parse(await readFile(path.join(extensionPath,'manifest.json'),'utf8'));
manifest.host_permissions.push('<all_urls>');delete manifest.optional_host_permissions;
await writeFile(path.join(extensionPath,'manifest.json'),JSON.stringify(manifest));
const server=createServer((req,res)=>res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><html><head><title>Capture regressions</title></head><body></body></html>'));
await new Promise(resolve=>server.listen(4175,'127.0.0.1',resolve));
let context;
try {
  context=await chromium.launchPersistentContext(path.resolve(`artifacts/capture-regression-profile-${Date.now()}`),{
    executablePath:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true,viewport:{width:1000,height:600},
    ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`]
  });
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
  const page=await context.newPage();await page.goto('http://127.0.0.1:4175');await page.bringToFront();
  const tabId=await worker.evaluate(async()=>{const tabs=await chrome.tabs.query({active:true,lastFocusedWindow:true});return tabs[0].id;});
  await page.evaluate(()=>{
    document.documentElement.style.overflowX='hidden';document.body.style.cssText='margin:0;background:rgb(230,235,240);overflow-x:hidden';
    document.body.innerHTML='<div style="height:700px">Top section</div><div id="sticky" style="position:sticky;top:0;height:40px;background:rgb(20,160,220)">Sticky section</div><div style="height:1100px">Lower section</div><div style="position:absolute;top:300px;left:0;width:3000px;height:20px;visibility:hidden">Clipped carousel</div><div id="fixed" style="position:fixed;top:0;left:0;width:200px;height:40px;background:rgb(220,20,30)"><span style="visibility:visible">Fixed header</span></div>';
    const host=document.createElement('div');host.style.cssText='position:fixed;top:60px;left:0;width:150px;height:30px';document.body.append(host);
    host.attachShadow({mode:'open'}).innerHTML='<div style="height:30px;background:rgb(110,40,180);visibility:visible">Shadow float</div>';
    window.onscroll=()=>{
      document.getElementById('fixed').style.visibility='visible';document.getElementById('fixed').style.opacity='1';
      if(scrollY>300&&!document.getElementById('late-float')){
        const late=document.createElement('div');late.id='late-float';late.style.cssText='position:fixed;bottom:0;left:250px;width:100px;height:40px;background:rgb(210,30,210)';document.body.append(late);
      }
    };
  });
  const expectedWidth=await page.evaluate(()=>document.documentElement.clientWidth);
  const captured=await worker.evaluate(id=>captureFullPage(id),tabId);
  const inspectPixels=async image=>page.evaluate(async source=>{
    const img=new Image();img.src=source;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
    const pixels=ctx.getImageData(0,0,c.width,c.height).data;
    const colors=[[220,20,30],[20,160,220],[110,40,180],[210,30,210]];
    const rows=colors.map(color=>{let count=0;for(let y=0;y<c.height;y++){let matching=0;for(let x=0;x<c.width;x++){const p=(y*c.width+x)*4;if(color.every((value,i)=>pixels[p+i]===value))matching++;}if(matching>25)count++;}return count;});
    let whiteEdge=0;for(let y=0;y<c.height;y++){const p=(y*c.width+c.width-1)*4;if(pixels[p]===255&&pixels[p+1]===255&&pixels[p+2]===255)whiteEdge++;}
    return {width:c.width,height:c.height,rows,whiteEdge,right:[...ctx.getImageData(c.width-20,c.height-20,1,1).data]};
  },image);
  const pixels=await inspectPixels(captured.image);
  assert.equal(captured.snapshot.width,expectedWidth);assert.equal(pixels.width,expectedWidth);
  assert.equal(pixels.rows[0],40,'Fixed header must appear exactly once');
  assert.equal(pixels.rows[1],40,'Sticky section must stay at its natural location exactly once');
  assert.equal(pixels.rows[2],30,'Shadow-root float must appear exactly once');
  assert.equal(pixels.rows[3],0,'Scroll-created floating control must not repeat');
  assert.equal(pixels.whiteEdge,0,'Clipped offscreen content must not add blank columns');
  assert.equal(await page.locator('#sticky').evaluate(e=>e.style.position),'sticky');
  assert.equal(await page.locator('#fixed').evaluate(e=>getComputedStyle(e).visibility),'visible');
  assert.equal(await page.locator('#fixed').evaluate(e=>getComputedStyle(e).opacity),'1');
  assert.equal(await page.evaluate(()=>scrollY),0);
  await writeFile('artifacts/capture-regression.png',Buffer.from(captured.image.split(',')[1],'base64'));
  await page.evaluate(()=>{
    window.onscroll=null;document.documentElement.style.overflowX='auto';document.body.style.cssText='margin:0';
    document.body.innerHTML='<div style="width:1600px;height:1700px;background:linear-gradient(to right,rgb(10,80,120) 0 50%,rgb(30,150,60) 50% 100%)">Genuine horizontal overflow</div>';
  });
  const horizontal=await worker.evaluate(id=>captureFullPage(id),tabId);
  const horizontalPixels=await inspectPixels(horizontal.image);
  assert.equal(horizontalPixels.width,1600);assert.deepEqual(horizontalPixels.right,[30,150,60,255]);
  const quality=await worker.evaluate(async id=>{const [result]=await chrome.scripting.executeScript({target:{tabId:id},func:pageQuality});return result.result;},tabId);
  assert.equal(quality.ready,true);assert.equal(quality.fontsReady,true);
  await page.evaluate(()=>{const target=document.body.firstElementChild;window.qualityTimer=setInterval(()=>target.style.height=(parseInt(target.style.height)+10)+'px',40);});
  const unstable=await worker.evaluate(async id=>{const [result]=await chrome.scripting.executeScript({target:{tabId:id},func:pageQuality});return result.result;},tabId);
  await page.evaluate(()=>clearInterval(window.qualityTimer));
  assert.equal(unstable.layoutStable,false);assert.equal(unstable.ready,false);
  console.log('PASS: fixed, scroll-mutated, shadow-root and late-created floats do not repeat; sticky content preserved; hidden overflow has no white padding; real horizontal content captured; styles/scroll restored.');
} finally {await context?.close();await new Promise(resolve=>server.close(resolve));}

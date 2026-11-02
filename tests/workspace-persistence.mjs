// Real IndexedDB persistence across closing/relaunching an isolated Edge profile.
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {jsPDF} from 'jspdf';
const root=path.resolve('dist'),profile=path.resolve('artifacts/workspace-profile-'+Date.now());
await mkdir(profile,{recursive:true});
const server=createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep))throw Error();res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.mjs':'text/javascript'}[path.extname(file)]||'application/octet-stream'});res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(4186,'127.0.0.1',resolve));
let context;
async function open(){context=await chromium.launchPersistentContext(profile,{executablePath:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true,viewport:{width:1200,height:1000}});const page=context.pages()[0];await page.route('http://127.0.0.1:8765/health',route=>route.fulfill({json:{ok:true,configured:true,ocrReady:true,extensionConfigured:true}}));await page.goto('http://127.0.0.1:4186/panel.html');await page.getByRole('button',{name:'Desktop',exact:true}).waitFor();return page;}
async function saved(page){await page.getByText('Workspaces saved in this browser',{exact:true}).waitFor();}
try{
 let page=await open();
 const images=await page.evaluate(()=>Object.fromEntries(['legacy','desktop','iphonePortrait','iphoneLandscape','sameSizeIphone','ipadPortrait','ipadLandscape','android7','android8'].map((name,index)=>{const canvas=document.createElement('canvas');canvas.width=390;canvas.height=1200;const ctx=canvas.getContext('2d');ctx.fillStyle=`hsl(${index*35} 50% 75%)`;ctx.fillRect(0,0,390,1200);return [name,canvas.toDataURL('image/png')];})));
 const pdf=new jsPDF();pdf.text('Page one',20,20);pdf.addPage();pdf.text('Page two',20,20);const pdfBuffer=Buffer.from(pdf.output('arraybuffer'));
 await saved(page);
 // Seed the former two-slot schema and reload to exercise the actual browser migration.
 await page.evaluate(({image,pdf})=>new Promise((resolve,reject)=>{const request=indexedDB.open('project-1-workspaces',1);request.onsuccess=()=>{const db=request.result,tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put({version:1,mode:'mobile',values:{devicePreset:{mobile:'820x1180'},targetWidth:{mobile:1180},targetHeight:{mobile:820},design:{mobile:{image,name:'legacy.pdf · page 2',width:390,height:1200}},capture:{mobile:{image,capturedAt:new Date().toISOString(),device:{mode:'mobile',width:1180,height:820},snapshot:{url:'https://example.test',title:'Legacy capture',width:390,height:1200,dpr:1,scrollX:0,scrollY:0,elements:[]}}},options:{mobile:{tolerancePx:6,normalization:'fit'}},pdfFile:{mobile:new File([new Uint8Array(pdf)],'legacy.pdf',{type:'application/pdf'})},pdfPage:{mobile:2},pdfPages:{mobile:2}}},'current');tx.oncomplete=()=>{db.close();resolve(true);};tx.onerror=()=>reject(tx.error);};}),{image:images.legacy,pdf:[...pdfBuffer]});
 await page.reload();await page.getByText('legacy.pdf · page 2',{exact:true}).waitFor();assert.equal(await page.getByLabel('Viewport preset',{exact:true}).inputValue(),'820x1180');assert.equal(await page.getByRole('button',{name:'Landscape',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await page.getByLabel('Spacing tolerance').inputValue(),'6');await saved(page);
 async function choose(id,orientation='portrait'){
  await page.getByRole('button',{name:'Compare',exact:true}).click();await page.getByRole('button',{name:'Mobile',exact:true}).click();await page.getByLabel('Viewport preset',{exact:true}).selectOption(id);await page.getByRole('button',{name:orientation==='portrait'?'Portrait':'Landscape',exact:true}).click();
 }
 async function populate(name,tolerance,usePdf=false){
  const buffer=Buffer.from(images[name].split(',')[1],'base64');
  await page.getByLabel('Upload mockup').setInputFiles(usePdf?{name:name+'.pdf',mimeType:'application/pdf',buffer:pdfBuffer}:{name:name+'.png',mimeType:'image/png',buffer});
  await page.getByText(name+(usePdf?'.pdf · page 1':'.png'),{exact:true}).waitFor();
  if(usePdf){await page.locator('.pdf-picker input').fill('2');await page.getByRole('button',{name:'Load page',exact:true}).click();await page.getByText(name+'.pdf · page 2',{exact:true}).waitFor();}
  const details=page.locator('.capture-controls details');if(!await details.evaluate(el=>el.open))await details.locator('summary').click();
  await page.getByLabel('Upload actual screenshot').setInputFiles({name:name+'-capture.png',mimeType:'image/png',buffer});await page.getByRole('button',{name:'Remove live capture',exact:true}).waitFor();await page.getByLabel('Spacing tolerance').fill(String(tolerance));await saved(page);
 }
 async function check(name,tolerance,usePdf=false){
  await page.getByText(name+(usePdf?'.pdf · page 2':'.png'),{exact:true}).waitFor();assert.equal(await page.getByLabel('Spacing tolerance').inputValue(),String(tolerance));
  const screen=page.getByLabel('Mobile capture screen',{exact:true});assert.equal(await screen.locator('img').getAttribute('src'),images[name]);
 }
 await page.getByRole('button',{name:'Desktop',exact:true}).click();await populate('desktop',11,true);
 await choose('iphone-15');assert.equal(await page.getByRole('button',{name:'Remove reference design',exact:true}).count(),0);await populate('iphonePortrait',3);await page.getByLabel('Mobile preview zoom',{exact:true}).selectOption('150');await page.getByLabel('Sync device scrolling',{exact:true}).uncheck();
 await choose('iphone-15','landscape');assert.equal(await page.getByRole('button',{name:'Remove live capture',exact:true}).count(),0);await populate('iphoneLandscape',5);await page.getByLabel('Browser-only comparison',{exact:true}).check();await page.getByRole('button',{name:/Compare & analyze/}).click();await page.getByRole('heading',{name:'0 active findings',exact:true}).waitFor();
 await choose('iphone-14-pro');assert.equal(await page.getByRole('button',{name:'Remove reference design',exact:true}).count(),0,'Same CSS size must not reuse another named device');await populate('sameSizeIphone',7);
 await choose('ipad-mini');await populate('ipadPortrait',9,true);await choose('ipad-mini','landscape');await populate('ipadLandscape',10);
 await choose('pixel-7');await populate('android7',2);await choose('pixel-8');await populate('android8',4);await saved(page);
 await context.close();context=undefined;page=await open();assert.equal(await page.getByLabel('Viewport preset',{exact:true}).inputValue(),'pixel-8');await check('android8',4);
 await choose('pixel-7');await check('android7',2);await choose('pixel-7','landscape');assert.equal(await page.getByRole('button',{name:'Remove reference design',exact:true}).count(),0);
 await choose('iphone-15');await check('iphonePortrait',3);assert.equal(await page.getByLabel('Mobile preview zoom',{exact:true}).inputValue(),'150');assert.equal(await page.getByLabel('Sync device scrolling',{exact:true}).isChecked(),false);
 await choose('iphone-15','landscape');await check('iphoneLandscape',5);await page.getByRole('button',{name:/^Results/}).click();await page.getByRole('heading',{name:'0 active findings',exact:true}).waitFor();
 await choose('iphone-14-pro');await check('sameSizeIphone',7);await choose('ipad-mini');await check('ipadPortrait',9,true);await page.locator('.pdf-picker input').fill('1');await page.getByRole('button',{name:'Load page',exact:true}).click();await page.getByText('ipadPortrait.pdf · page 1',{exact:true}).waitFor();
 await choose('ipad-mini','landscape');await check('ipadLandscape',10);await choose('820x1180','landscape');await page.getByText('legacy.pdf · page 2',{exact:true}).waitFor();assert.equal(await page.getByLabel('Mobile capture screen',{exact:true}).locator('img').getAttribute('src'),images.legacy);
 await page.locator('.pdf-picker input').fill('1');await page.getByRole('button',{name:'Load page',exact:true}).click();await page.getByText('legacy.pdf · page 1',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Desktop',exact:true}).click();await page.getByText('desktop.pdf · page 2',{exact:true}).waitFor();assert.equal(await page.getByLabel('Spacing tolerance').inputValue(),'11');assert.equal(await page.locator('.capture-preview img').getAttribute('src'),images.desktop);
 await choose('iphone-15');await page.getByRole('button',{name:'Remove reference design',exact:true}).click();await saved(page);await page.reload();await page.getByRole('button',{name:'Mobile',exact:true}).waitFor();assert.equal(await page.getByRole('img',{name:'Uploaded reference design',exact:true}).count(),0);assert.equal(await page.getByLabel('Mobile capture screen',{exact:true}).locator('img').getAttribute('src'),images.iphonePortrait);
 await choose('iphone-15','landscape');await check('iphoneLandscape',5);
 // Opening history should select its original device and orientation, not overwrite the active slot.
 await choose('pixel-8');await page.getByRole('button',{name:'History',exact:true}).click();await page.getByRole('button',{name:'Open',exact:true}).click();await page.getByRole('heading',{name:'0 active findings',exact:true}).waitFor();await page.getByRole('button',{name:'Compare',exact:true}).click();assert.equal(await page.getByLabel('Viewport preset',{exact:true}).inputValue(),'iphone-15');assert.equal(await page.getByRole('button',{name:'Landscape',exact:true}).getAttribute('aria-pressed'),'true');await check('iphoneLandscape',5);
 await choose('pixel-8');await check('android8',4);await saved(page);
 await page.evaluate(()=>{globalThis.failWorkspaceWrites=true;const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='drafts'&&globalThis.failWorkspaceWrites)throw new DOMException('Simulated quota','QuotaExceededError');return original.apply(this,args);};});
 await page.getByLabel('Spacing tolerance').fill('8');await page.getByRole('button',{name:'Retry workspace save',exact:true}).waitFor();await page.evaluate(()=>{globalThis.failWorkspaceWrites=false;});await page.getByRole('button',{name:'Retry workspace save',exact:true}).click();await saved(page);await page.reload();await page.getByRole('button',{name:'Mobile',exact:true}).waitFor();await check('android8',8);
 console.log('PASS: legacy migration, per-model/orientation images/PDF/settings/results across browser restart, identical-size devices isolated, history routing, independent removal and quota recovery.');
}finally{await context?.close();await new Promise(resolve=>server.close(resolve));}

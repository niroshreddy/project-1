// Production-bundle workflow test; browser capture and comparison responses are mocked.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';

const root=path.resolve('dist');
const prefix=process.argv.includes('--source-install')?'/dist':'';
const server=createServer(async(req,res)=>{
  try {
    let pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(prefix && !pathname.startsWith(prefix+'/')) {res.writeHead(404).end();return;}
    pathname=pathname.slice(prefix.length);
    const file=path.resolve(root,'.'+pathname);
    if(!file.startsWith(root+path.sep)) {res.writeHead(403).end();return;}
    const body=await readFile(file);
    const type={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm'}[path.extname(file)]||'application/octet-stream';
    res.writeHead(200,{'Content-Type':type});res.end(body);
  } catch {res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(4173,'127.0.0.1',resolve));
let browser;
try {
  browser=await chromium.launch({executablePath:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1100,height:950}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:4173${prefix}/panel.html`);
  const design=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=1000;c.height=600;const x=c.getContext('2d');
    x.fillStyle='#f5f7fb';x.fillRect(0,0,1000,600);x.fillStyle='#fff';x.fillRect(0,0,1000,75);
    x.fillStyle='#172743';x.font='bold 24px sans-serif';x.fillText('Infinite / Companies',40,48);
    x.font='bold 48px sans-serif';x.fillText('Our companies',55,190);x.font='20px sans-serif';x.fillText('Leading brands. Global reach.',55,230);
    for(let i=0;i<3;i++){x.fillStyle='#fff';x.fillRect(55+i*300,290,270,230);x.fillStyle='#4858ed';x.font='bold 24px sans-serif';x.fillText(['Amphenol','TE Connectivity','Molex'][i],75+i*300,340);x.fillRect(75+i*300,440,130,42);x.fillStyle='white';x.font='16px sans-serif';x.fillText('View details',95+i*300,467);}
    return c.toDataURL('image/png');
  });
  const snapshot={url:'https://example.com/companies',title:'Companies',width:1000,height:600,dpr:1,scrollX:0,scrollY:0,elements:[]};
  await page.addInitScript(({design,snapshot})=>{
    const api={devtools:{inspectedWindow:{tabId:42}},permissions:{request:async()=>true},runtime:{id:'test-extension',sendMessage:async message=>({data:message.type==='capture'?{image:design,snapshot,capturedAt:new Date().toISOString()}:true})}};
    Object.defineProperty(globalThis,'chrome',{value:api,configurable:true});
  },{design,snapshot});
  await page.route('http://127.0.0.1:8765/**',async route=>{
    if(route.request().url().endsWith('/health')) return route.fulfill({json:{ok:true,configured:true,ocrReady:true,externalServices:false,engine:'local-rules-v3',extensionConfigured:true}});
    const body=route.request().postDataJSON();assert(body.design.startsWith('data:image/png;'));assert.equal(body.snapshot.width,1000);
    await route.fulfill({json:{summary:'One potential layout difference requires review.',model:'local-rules-v3',diff:{changedPercent:3.2,regions:[]},issues:[{title:'First card button may be misplaced',category:'layout',severity:'medium',confidence:.72,basis:'possible',expected:'Button aligned with other cards.',actual:'Button is lower in this region.',explanation:'Review the button baseline relative to adjacent cards.',recommendation:'Check card padding and align the button baseline.',annotation:'arrow',box:{x:.07,y:.7,width:.17,height:.12}}]}});
  });
  await page.reload();
  await page.getByLabel('Upload mockup').setInputFiles({name:'design.png',mimeType:'image/png',buffer:Buffer.from(design.split(',')[1],'base64')});
  await page.getByRole('button',{name:'Capture viewport',exact:true}).click();
  const rawDownloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download raw capture',exact:true}).click();
  const raw=await rawDownloadPromise;
  await mkdir('artifacts',{recursive:true});
  await raw.saveAs('artifacts/raw-viewport.png');
  assert.deepEqual(await readFile('artifacts/raw-viewport.png'),Buffer.from(design.split(',')[1],'base64'));
  await page.getByRole('button',{name:/Compare & analyze/}).click();
  await page.getByRole('heading',{name:'1 active finding',exact:true}).waitFor();
  await page.locator('.issue-tags').filter({hasText:'Possible issue'}).waitFor();
  await page.getByText('Needs verification',{exact:false}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.canvas-host canvas')?.width===1000);
  await mkdir('artifacts',{recursive:true});
  await page.screenshot({path:'artifacts/results-desktop.png',fullPage:true});
  let pending=page.waitForEvent('download');await page.getByRole('button',{name:'↓ PNG',exact:true}).click();
  const png=await pending;await png.saveAs('artifacts/annotated.png');assert.equal((await readFile('artifacts/annotated.png')).subarray(1,4).toString(),'PNG');
  pending=page.waitForEvent('download');await page.getByRole('button',{name:'↓ PDF report',exact:true}).click();
  const report=await pending;await report.saveAs('artifacts/report.pdf');assert.equal((await readFile('artifacts/report.pdf')).subarray(0,4).toString(),'%PDF');
  await page.getByRole('button',{name:'Dismiss finding',exact:true}).click();
  await page.getByRole('heading',{name:'0 active findings',exact:true}).waitFor();
  await page.getByLabel('Show dismissed').check();await page.getByRole('button',{name:'Restore finding',exact:true}).click();
  await page.getByRole('heading',{name:'1 active finding',exact:true}).waitFor();
  await page.getByRole('button',{name:'Locate on live page',exact:true}).click();
  await page.getByRole('button',{name:'History',exact:true}).click();await page.reload();
  await page.getByRole('button',{name:'History',exact:true}).click();await page.getByRole('button',{name:'Open',exact:true}).click();
  await page.getByRole('heading',{name:'1 active finding',exact:true}).waitFor();
  await page.setViewportSize({width:420,height:900});await page.screenshot({path:'artifacts/results-narrow.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.setViewportSize({width:1100,height:950});await page.getByRole('button',{name:'Compare',exact:true}).click();
  const pdf=new jsPDF({unit:'px',format:[1000,600],orientation:'landscape'});pdf.text('Reference page one',30,40);pdf.addPage();pdf.text('Reference page two',30,40);
  await page.getByLabel('Upload mockup').setInputFiles({name:'two-pages.pdf',mimeType:'application/pdf',buffer:Buffer.from(pdf.output('arraybuffer'))});
  await page.getByText('two-pages.pdf · page 1',{exact:false}).waitFor();
  await page.getByRole('spinbutton').fill('2');await page.getByRole('button',{name:'Load page',exact:true}).click();
  await page.getByText('two-pages.pdf · page 2',{exact:false}).waitFor();
  await page.screenshot({path:'artifacts/compare-desktop.png',fullPage:true});
  // A record written by the previous version remains readable without migration.
  await page.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('project-1',1);
    request.onsuccess=()=>{const db=request.result;const tx=db.transaction('comparisons','readwrite');const store=tx.objectStore('comparisons');const all=store.getAll();
      all.onsuccess=()=>{const legacy=all.result[0];legacy.id='legacy-fixture';legacy.capture.snapshot.title='Legacy comparison';legacy.model='previous-engine';legacy.issues.forEach(issue=>delete issue.basis);store.put(legacy);};
      tx.oncomplete=()=>{db.close();resolve(true);};tx.onerror=()=>reject(tx.error);
    };
  }));
  await page.reload();await page.getByRole('button',{name:'History',exact:true}).click();
  await page.locator('.history-card').filter({has:page.getByRole('heading',{name:'Legacy comparison',exact:true})}).getByRole('button',{name:'Open',exact:true}).click();
  await page.getByText('Legacy finding',{exact:false}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: production UI upload, PDF page selection, capture, local comparison contract, annotations, dismiss/restore, persistence, PNG/PDF downloads, narrow layout. Capture and comparison response mocked.');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}

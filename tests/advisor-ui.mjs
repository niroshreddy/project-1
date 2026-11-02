// UI integration uses a real local backend and DOM collector; model inference is mocked separately in Python.
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve('dist');
const server=createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep))throw Error();const data=await readFile(file);res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(4182,'127.0.0.1',resolve));
const backend=spawn('.venv/Scripts/python.exe',['-m','uvicorn','backend.app:app','--host','127.0.0.1','--port','8782'],{env:{...process.env,EXTENSION_ID:'advisor-test',LOCAL_SERVICE_PORT:'8782'},stdio:'ignore'});
let browser;
try{
 for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:8782/health')).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,250));}
 browser=await chromium.launch({executablePath:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
 // Exercise actual collector against a DOM fixture, including field-value exclusion and heuristic labels.
 const fixture=await browser.newPage({viewport:{width:390,height:844}});
 await fixture.setContent('<label>Postal code<input value="SECRET-ADDRESS" aria-invalid="true" style="width:12px;height:12px;padding:0;border:0"></label><button aria-label="Continue">Continue</button><input aria-label="Password" type="password" value="SECRET-PASSWORD"><input style="display:none" value="HIDDEN-SECRET">');
 await fixture.addScriptTag({content:'globalThis.chrome={runtime:{onMessage:{addListener(){}}}};'+await readFile('background.js','utf8')});
 const evidence=await fixture.evaluate(()=>collectAdvisorEvidence());evidence.page='https://synthetic.example';
 assert.equal(evidence.width,390);assert.equal(evidence.controls.length,3);
 assert.equal(evidence.controls[0].name,'Postal code');
 assert(!JSON.stringify(evidence).includes('SECRET'));
 const page=await browser.newPage({viewport:{width:1200,height:950}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(evidence=>{globalThis.chrome={permissions:{request:async()=>true},devtools:{inspectedWindow:{tabId:42}},runtime:{sendMessage:async payload=>payload.type==='advisorEvidence'?{data:evidence}:{error:'Unexpected action'}}};},evidence);
 await page.route('http://127.0.0.1:8765/**',async route=>{const url=new URL(route.request().url());
  if(url.pathname==='/advisor/status'){await route.fulfill({json:{ready:false,models:[],detail:'Local AI not installed'},headers:{'access-control-allow-origin':'http://127.0.0.1:4182'}});return;}
  const response=await route.fetch({url:'http://127.0.0.1:8782'+url.pathname,headers:{...route.request().headers(),origin:'chrome-extension://advisor-test',host:'127.0.0.1:8782'}});
  await route.fulfill({response,headers:{...response.headers(),'access-control-allow-origin':'http://127.0.0.1:4182'}});
 });
 await page.goto('http://127.0.0.1:4182/panel.html');
 await page.getByRole('button',{name:'Ask this page',exact:true}).click();
 await page.getByText('Built-in checks available · Local AI unavailable',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Collect page evidence',exact:true}).click();
 const run=page.getByRole('button',{name:'Run built-in UX checks',exact:true});assert.equal(await run.isDisabled(),true);
 await page.getByLabel('I reviewed the evidence and question for sensitive information.',{exact:true}).check();
 await run.click();await page.getByRole('heading',{name:'Built-in checks · No AI answer',exact:true}).waitFor();
 await page.getByRole('heading',{name:'Invalid controls without a detected error association',exact:true}).waitFor();
 assert(await page.getByText('QA checks · Not yet run',{exact:true}).count()>0);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download advice and QA checks',exact:true}).click();await mkdir('artifacts',{recursive:true});await (await download).saveAs('artifacts/advisor-report.json');
 const report=JSON.parse(await readFile('artifacts/advisor-report.json','utf8'));assert.equal(report.mode,'built-in');assert(!JSON.stringify(report).includes('SECRET'));
 await page.setViewportSize({width:420,height:850});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'artifacts/advisor-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Clear report',exact:true}).click();
 assert.equal(await page.getByRole('heading',{name:'Built-in checks · No AI answer',exact:true}).count(),0);
 await page.getByRole('button',{name:'Clear evidence and report',exact:true}).click();
 await page.getByRole('button',{name:'Collect page evidence',exact:true}).waitFor();
 await page.getByRole('button',{name:'Compare',exact:true}).click();await page.getByRole('heading',{name:'Reference design',exact:true}).waitFor();
 assert.deepEqual(errors,[]);await page.unrouteAll({behavior:'ignoreErrors'});
 console.log('PASS: DOM evidence privacy, real Python checks, consent, QA/export, narrow layout and Compare preserved. Real local model inference deferred.');
}finally{await browser?.close();backend.kill();await new Promise(resolve=>server.close(resolve));}

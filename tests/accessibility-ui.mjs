// Real bundled axe engine against a synthetic page; production UI with Python offline.
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve('dist');
const server=createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(4196,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({executablePath:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
 const fixture=await browser.newPage();await fixture.setContent('<html lang="en"><title>Fixture</title><main><h1>Checkout</h1><input id="postal" value="PRIVATE-VALUE"><img src="data:," alt=""><button></button></main></html>');
 await fixture.addScriptTag({path:'public/vendor/axe.min.js'});
 const result=await fixture.evaluate(async()=>{const r=await axe.run(document,{iframes:false,resultTypes:['violations','incomplete','passes']});return {version:r.testEngine.version,url:'https://fixture.example',at:new Date().toISOString(),passes:r.passes.length,violations:r.violations.map(({id,impact,help,description,helpUrl,nodes})=>({id,impact,help,description,helpUrl,nodes:nodes.map(({target,failureSummary})=>({target,failureSummary}))})),incomplete:[]};});
 assert(result.violations.some(f=>f.id==='label'));assert(result.violations.some(f=>f.id==='button-name'));assert(!JSON.stringify(result).includes('PRIVATE-VALUE'));assert.equal(result.version,'4.11.0');
 const page=await browser.newPage({viewport:{width:1200,height:950}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://127.0.0.1:8765/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"detail":"offline"}'}));
 await page.addInitScript(result=>{globalThis.chrome={devtools:{inspectedWindow:{tabId:1}},permissions:{request:async()=>true},runtime:{sendMessage:async message=>message.type==='accessibilityScan'?{data:result}:{error:'Unsupported test message'}}};},result);
 await page.goto('http://127.0.0.1:4196/panel.html');await page.getByRole('button',{name:'Accessibility',exact:true}).click();await page.getByRole('button',{name:'Run accessibility checks',exact:true}).click();
 await page.getByRole('heading',{name:/Controls must have an accessible name/}).waitFor().catch(async()=>{await page.getByRole('heading',{name:/Form elements must have labels/}).waitFor();});
 const article=page.locator('article').filter({has:page.getByRole('heading',{name:/Form elements must have labels/})});
 await article.getByRole('button',{name:'Accept deviation',exact:true}).click();assert.equal(await article.count(),0);
 await page.getByLabel('Show reviewed findings').check();assert.equal(await article.count(),1);await article.getByRole('button',{name:'Reopen',exact:true}).click();
 await page.getByRole('button',{name:'Compare',exact:true}).click();await page.getByRole('button',{name:'Accessibility',exact:true}).click();assert.equal(await article.count(),1);
 await page.screenshot({path:'artifacts/accessibility-offline.png',fullPage:true});await page.getByLabel('Local processing and connection').click();await page.getByRole('heading',{name:'Service status',exact:true}).waitFor();assert(await page.getByLabel('Service status',{exact:true}).innerText().then(s=>s.includes('Offline accessibility')));
 assert.equal(await page.locator('.advisor-workspace .module-services,.journey-workspace .module-services').count(),0);assert.deepEqual(errors,[]);await page.screenshot({path:'artifacts/unified-services.png'});
 console.log('PASS: real axe label/button findings, private value exclusion, offline UI, triage/reopen, tab retention, unified status.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}

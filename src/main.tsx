import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Capture, Comparison, Design, Issue } from './types';
import { API, capturePage, compare, message } from './api';
import { annotated, exportCapture, exportPdf, exportPng, rasterize, visibleIssues } from './images';
import * as store from './storage';
import './style.css';
import './workspace.css';

function App() {
  const [tab,setTab] = useState('Compare');
  const [design,setDesign] = useState<Design>();
  const [capture,setCapture] = useState<Capture>();
  const [record,setRecord] = useState<Comparison>();
  const [records,setRecords] = useState<Comparison[]>([]);
  const [selected,setSelected] = useState<string>();
  const [status,setStatus] = useState(''); const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [connection,setConnection] = useState<'checking' | 'ready' | 'offline' | 'setup'>('checking');
  const [checking,setChecking] = useState(false);
  const [showSetup,setShowSetup] = useState(false);
  const [recentOpen,setRecentOpen] = useState(true);
  const [deleted,setDeleted] = useState<Comparison[]>([]);
  const [undoHovered,setUndoHovered] = useState(false);
  const [undoFocused,setUndoFocused] = useState(false);
  const healthController = useRef<AbortController | null>(null);
  const backend = { checking:'Checking service…', ready:'Local engine ready', offline:'Local service offline', setup:'Service needs setup' }[connection];
  const [pdfFile,setPdfFile] = useState<File>(); const [pdfPage,setPdfPage] = useState(1); const [pdfPages,setPdfPages] = useState(0);
  const [category,setCategory] = useState('all'); const [showDismissed,setShowDismissed] = useState(false);
  const canvasHost = useRef<HTMLDivElement>(null); const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    refresh(); checkBackend();
    const interval=setInterval(checkBackend,30000);
    return () => { clearInterval(interval); controller.current?.abort(); healthController.current?.abort(); };
  },[]);
  useEffect(() => {
    if (!status || busy) return;
    const timeout=setTimeout(()=>setStatus(''),6000);
    return ()=>clearTimeout(timeout);
  },[status,busy]);
  useEffect(() => {
    if (!deleted.length) { setUndoHovered(false);setUndoFocused(false);return; }
    if (busy || undoHovered || undoFocused) return;
    const timeout=setTimeout(()=>setDeleted([]),12000);
    return ()=>clearTimeout(timeout);
  },[deleted,busy,undoHovered,undoFocused]);
  useEffect(() => {
    let cancelled = false;
    if (record) annotated(record,selected).then(canvas => { if (!cancelled && canvasHost.current) canvasHost.current.replaceChildren(canvas); }).catch(e => setError(e.message));
    return () => { cancelled=true; };
  },[record,selected,tab]);
  async function refresh() { try { setRecords(await store.history()); } catch { setError('Local history is unavailable. Check browser storage settings.'); } }
  async function checkBackend() {
    healthController.current?.abort();
    const request=new AbortController();healthController.current=request;setChecking(true);
    const timeout=setTimeout(()=>request.abort(),15000);
    try {
      const response=await fetch(`${API}/health`,{signal:request.signal});
      if (!response.ok) throw new Error('Health check failed');
      const health=await response.json();
      if (healthController.current===request) setConnection(health.configured && health.extensionConfigured ? 'ready' : 'setup');
    } catch {
      if (healthController.current===request) setConnection('offline');
    } finally {
      clearTimeout(timeout);
      if (healthController.current===request) setChecking(false);
    }
  }
  async function run(task: () => Promise<void>) {
    setBusy(true); setError(''); setStatus('');
    try { await task(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function pdfDesign(file: File, pageNumber: number) {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs',location.href).href;
    const task=pdfjs.getDocument({ data:await file.arrayBuffer(), cMapUrl:new URL('./vendor/cmaps/',location.href).href, cMapPacked:true,
      standardFontDataUrl:new URL('./vendor/standard_fonts/',location.href).href, wasmUrl:new URL('./vendor/wasm/',location.href).href, useWasm:false });
    const pdf=await task.promise;
    try {
      setPdfPages(pdf.numPages);
      if (pageNumber<1 || pageNumber>pdf.numPages) throw new Error('Choose an existing PDF page.');
      const page=await pdf.getPage(pageNumber); const original=page.getViewport({scale:1});
      const viewport=page.getViewport({scale:Math.min(2,2400/Math.max(original.width,original.height))});
      const canvas=document.createElement('canvas'); canvas.width=Math.ceil(viewport.width); canvas.height=Math.ceil(viewport.height);
      await page.render({canvas,canvasContext:canvas.getContext('2d')!,viewport}).promise;
      setDesign(await rasterize(canvas.toDataURL('image/png'),`${file.name} · page ${pageNumber}`)); setRecord(undefined);
    } finally { await pdf.destroy(); }
  }
  async function upload(file?: File) {
    if (!file) return;
    await run(async () => {
      if (file.size>10_000_000) throw new Error('Choose a file under 10 MB.');
      if (!/\.(png|jpe?g|pdf)$/i.test(file.name)) throw new Error('Choose a PNG, JPG, or PDF file.');
      setPdfFile(undefined); setPdfPages(0); setPdfPage(1);
      if (/\.pdf$/i.test(file.name)) { await pdfDesign(file,1); setPdfFile(file); }
      else { const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('File could not be read.'));reader.readAsDataURL(file);}); setDesign(await rasterize(data,file.name)); setRecord(undefined); }
      setStatus('Design ready. Capture the matching full website page.');
    });
  }
  async function analyze() {
    if (!design || !capture || connection!=='ready') return;
    await run(async () => {
      setStatus('Comparing locally with OCR, pixels, and DOM evidence…');
      controller.current=new AbortController(); const timeout=setTimeout(()=>controller.current?.abort(),180000);
      let result: Comparison;
      try { result=await compare(design,capture,controller.current.signal); }
      catch(e) { if (controller.current.signal.aborted) throw new Error('Comparison cancelled or timed out. You can try again.'); await checkBackend(); throw e; }
      finally { clearTimeout(timeout); controller.current=null; }
      setRecord(result); setTab('Issues'); setSelected(result.issues[0]?.id); setCategory('all'); setShowDismissed(false);
      try { await store.save(result); await refresh(); setStatus('Comparison saved locally. Review findings before sharing.'); }
      catch { setError('Comparison finished, but history could not be saved. Export the result before closing this panel.'); }
    });
  }
  async function dismiss(issue: Issue) {
    if (!record) return;
    const updated={...record,issues:record.issues.map(i=>i.id===issue.id?{...i,dismissed:!i.dismissed}:i)};
    setRecord(updated);
    await run(async()=>{await store.save(updated);await refresh();});
  }
  async function deleteComparison(item: Comparison) {
    await run(async () => {
      await store.remove(item.id);
      if (record?.id === item.id) { setRecord(undefined); setSelected(undefined); }
      await refresh();
      setDeleted(current=>[...current.filter(record=>record.id!==item.id),item]);
    });
  }
  async function undoDelete() {
    const pending=[...deleted];
    await run(async()=>{
      await store.restore(pending);
      setDeleted(current=>current.filter(item=>!pending.some(restored=>restored.id===item.id)));
      await refresh();setStatus(`${pending.length===1?'Comparison':`${pending.length} comparisons`} restored.`);
    });
  }
  function openHistory(item: Comparison) { setRecord(item);setDesign(item.design);setCapture(item.capture);setPdfFile(undefined);setSelected(item.issues.find(i=>!i.dismissed)?.id);setTab('Issues');setCategory('all');setShowDismissed(false);setStatus('Viewing saved capture. Recapture and compare after changing the page.'); }
  const issues=record?.issues.filter(i=>(category==='all'||i.category===category)&&(showDismissed||!i.dismissed)) ?? [];
  const count=record?visibleIssues(record).length:0;
  const missing = [!design && 'Upload a reference', !capture && 'Capture the page', connection==='checking' && 'Checking local service', connection==='offline' && 'Start the local service', connection==='setup' && 'Complete service setup'].filter(Boolean);
  const readiness = busy ? (status || 'Working…') : missing.length ? missing.join(' · ') : 'Reference and capture ready. Compare when you’re ready.';
  return <div className={`app ${tab==='Compare'?'compare-workspace':''}`}>
    <div className="workspace-header"><header><div className="brand"><span className="logo">p1</span><div><h1>project-1</h1><p>Live UI validation</p></div><span className="beta">MVP</span></div><button className={`service ${connection}`} disabled={checking} onClick={checkBackend} title="Check local service connection">● {checking?'Checking service…':backend}</button></header>
    <nav aria-label="Workspace">{['Compare','Issues','Report','History','Settings'].map(item=><button key={item} className={tab===item?'active':''} onClick={()=>setTab(item)}>{item}{item==='Issues'&&record?<span className="count">{count}</span>:null}</button>)}</nav></div>
    {error&&<div role="alert" className="notice error">{error}<button aria-label="Dismiss error" onClick={()=>setError('')}>×</button></div>}
    {(connection==='offline'||connection==='setup')&&<section className="connection-banner" aria-label="Connection guidance">
      <div className="connection-copy"><strong>{connection==='offline'?'Local comparison service is offline':'Local service needs setup'}</strong><p>{connection==='offline'?'Start the Python service to compare. You can still upload, capture, and browse history.':'Check the OCR installation and extension ID, then reconnect.'}</p></div>
      <div className="connection-actions"><button disabled={checking} onClick={checkBackend}>{checking?'Checking…':'Check connection'}</button><button aria-expanded={showSetup} aria-controls="setup-guide" onClick={()=>setShowSetup(!showSetup)}>Setup instructions</button></div>
      {showSetup&&<div className="setup-guide" id="setup-guide"><strong>Start the local service</strong><ol><li>Open PowerShell in your project-1 folder.</li><li>Run <code>.\start-backend.ps1</code> and keep that terminal open.</li><li>Set your extension ID in <code>backend/.env</code> if setup is incomplete, then select <strong>Check connection</strong>.</li></ol><p>No API key is required. See README.md for first-time installation.</p></div>}
    </section>}
    {tab==='Compare'&&<main><div className="intro workspace-intro"><div><h2>Compare design to page</h2><p>Upload a reference, capture the matching page, and review the differences.</p></div><span className="local-label">On-device processing</span></div>
      <div className="inputs"><section className="card"><div className="section-title"><span className="step">1</span><h3>Reference design</h3></div>
        <label className={`dropzone ${busy?'disabled':''}`} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy)upload(e.dataTransfer.files[0]);}}>
          {design?<img src={design.image} alt="Uploaded reference design"/>:<><span className="upload-symbol">↑</span><strong>Drop your design here</strong><span>PNG, JPG or PDF · up to 10 MB</span></>}
          <input aria-label="Upload mockup" type="file" accept=".png,.jpg,.jpeg,.pdf" disabled={busy} onChange={e=>{upload(e.target.files?.[0]);e.target.value='';}}/><span className="file-button">{design?'Replace design':'Choose file'}</span>
        </label>
        {design&&<p className="metadata">{design.name}<br/>{design.width} × {design.height} px</p>}
        {pdfFile&&<label className="pdf-picker">PDF page <input type="number" min={1} max={pdfPages} value={pdfPage} disabled={busy} onChange={e=>setPdfPage(Number(e.target.value))}/> of {pdfPages}<button disabled={busy} onClick={()=>run(()=>pdfDesign(pdfFile,pdfPage))}>Load page</button></label>}
      </section><section className="card"><div className="section-title"><span className="step">2</span><h3>Live website</h3></div>
        <div className={`capture-preview ${capture?.snapshot.fullPage ? "full-page" : ""}`}>{capture?<img src={capture.image} alt="Captured full page"/>:<><span className="upload-symbol">▣</span><strong>Capture the entire page</strong><span>Open the matching page in this browser tab.</span></>}</div>
        <button className="secondary wide" disabled={busy} onClick={()=>run(async()=>{setStatus('Capturing the full page. Keep this tab selected and do not scroll…');setCapture(await capturePage());setRecord(undefined);setStatus('Full page captured. Original scroll position restored.');})}>{capture?'Recapture full page':'Capture full page'}</button>
        {capture&&<p className="metadata">{capture.snapshot.url}<br/>{capture.snapshot.fullPage ? "Full page: " : "Viewport: "}{capture.snapshot.width} × {capture.snapshot.height} CSS px · {new Date(capture.capturedAt).toLocaleTimeString()}</p>}
        {capture&&<button className="secondary wide" disabled={busy} onClick={()=>exportCapture(capture)}>Download raw capture</button>}
      </section></div>
      <details className="capture-help"><summary>Capture tips & privacy</summary><p>Full-page capture scrolls the website automatically. Keep the website tab selected and do not scroll during capture. Use a reference at the same browser width; docked DevTools can change the layout.</p><p>For a self-check, download the raw capture and upload it as the reference without recapturing. Images and text are processed locally; no API key or external AI service is used.</p></details>
      <section className="recent"><div className="section-title"><h3><button className="recent-toggle" aria-expanded={recentOpen} onClick={()=>setRecentOpen(!recentOpen)}>Recent comparisons <span aria-hidden="true">{recentOpen?'⌄':'›'}</span></button></h3><button onClick={()=>setTab('History')}>View history →</button></div>{recentOpen&&(records.length?records.slice(0,3).map(item=><div className="recent-row" key={item.id}><button disabled={busy} className="history-row" onClick={()=>openHistory(item)}><span>▧</span><div><strong>{item.capture.snapshot.title||'Untitled page'}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></div><span>{visibleIssues(item).length} findings →</span></button><button className="delete-recent" disabled={busy} aria-label={`Delete comparison ${item.capture.snapshot.title||'Untitled page'}`} title="Delete comparison" onClick={()=>deleteComparison(item)}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg></button></div>):<p className="empty-inline">No comparisons yet. Your recent work will appear here.</p>)}</section>
    </main>}
    {(tab==='Issues'||tab==='Report')&&(!record?<main className="empty"><span className="upload-symbol">◎</span><h2>No comparison yet</h2><p>Upload a design and capture your website to get started.</p><button className="primary" onClick={()=>setTab('Compare')}>Start a comparison</button></main>:<main className="results"><div className="results-heading"><div><span className="eyebrow">{tab==='Report'?'READY TO REVIEW & EXPORT':'VALIDATION RESULTS'}</span><h2>{count} active {count===1?'finding':'findings'}</h2><p>{record.summary}</p></div><div className="exports"><button disabled={busy} onClick={()=>run(()=>exportPng(record))}>↓ PNG</button><button className="primary" disabled={busy} onClick={()=>run(()=>exportPdf(record))}>↓ PDF report</button></div></div>
      <div className="result-meta">{record.capture.snapshot.width} × {record.capture.snapshot.height} CSS px <span>·</span> {record.diff.changedPercent}% pixels changed <span>·</span> {record.model}</div>
      <p className="hint">Pixel change is a visual signal, not an accuracy score. Measured findings describe visible differences; possible issues need verification. Rule confidence is a heuristic, not an accuracy probability.</p>
      <div className="comparison-images"><section className="card"><h3>Expected design</h3><img src={record.design.image} alt="Expected design"/></section><section className="card"><h3>Actual page · annotated</h3><div className="canvas-host" ref={canvasHost} role="img" aria-label="Actual page with numbered red issue annotations"/></section></div>
      <div className="filter-row"><label>Category <select value={category} onChange={e=>setCategory(e.target.value)}><option value="all">All findings</option>{['missing','text','layout','spacing','style'].map(c=><option key={c}>{c}</option>)}</select></label><label><input type="checkbox" checked={showDismissed} onChange={e=>setShowDismissed(e.target.checked)}/> Show dismissed</label></div>
      {!issues.length&&<div className="card empty-inline">No findings in this view. A clean result does not guarantee pixel-perfect compliance.</div>}
      <div className="issue-list">{issues.map(issue=><article key={issue.id} className={`issue ${selected===issue.id?'selected':''} ${issue.dismissed?'dismissed':''}`}><button className="issue-heading" onClick={()=>setSelected(issue.id)}><span className="issue-number">{record.issues.indexOf(issue)+1}</span><strong>{issue.title}</strong><span className={`severity ${issue.severity}`}>{issue.severity}</span></button><div className="issue-content"><div className="issue-tags">{issue.category} · {issue.basis === 'measured' ? 'Measured difference' : issue.basis === 'possible' ? 'Possible issue' : 'Legacy finding'} · {Math.round(issue.confidence*100)}% {issue.basis ? 'rule confidence' : 'reported confidence'} {issue.confidence<.75?'· Needs verification':''}</div><dl><dt>Expected</dt><dd>{issue.expected}</dd><dt>Actual</dt><dd>{issue.actual}</dd></dl><p>{issue.explanation}</p><p className="recommendation"><strong>Suggested correction</strong><br/>{issue.recommendation}</p><div className="issue-actions"><button disabled={busy||issue.dismissed} onClick={()=>run(async()=>{setSelected(issue.id);await message({type:'highlight',box:issue.box,snapshot:record.capture.snapshot,label:`${record.issues.indexOf(issue)+1}. ${issue.title}`});setStatus('Highlighted on the live page for 8 seconds.');})}>Locate on live page</button><button disabled={busy} onClick={()=>dismiss(issue)}>{issue.dismissed?'Restore finding':'Dismiss finding'}</button></div></div></article>)}</div>
    </main>)}
    {tab==='History'&&<main><div className="intro"><span className="eyebrow">SAVED IN THIS BROWSER</span><h2>Comparison history</h2><p>The latest 15 comparisons are kept locally, including images and reviewed findings.</p></div>{records.length?records.map(item=><div className="history-card card" key={item.id}><img src={item.capture.image} alt="Saved viewport thumbnail"/><div><h3>{item.capture.snapshot.title||'Untitled page'}</h3><p className="metadata">{item.capture.snapshot.url}</p><small>{new Date(item.createdAt).toLocaleString()} · {visibleIssues(item).length} findings</small></div><button disabled={busy} onClick={()=>openHistory(item)}>Open</button><button disabled={busy} aria-label={`Delete comparison ${item.capture.snapshot.title}`} onClick={()=>deleteComparison(item)}>Delete</button></div>):<p className="empty-inline">No saved comparisons yet.</p>}</main>}
    {tab==='Settings'&&<main><div className="intro"><span className="eyebrow">LOCAL PYTHON SERVICE</span><h2>Connection & privacy</h2></div><section className="card settings"><h3>Backend connection</h3><code>{API}</code><p>{backend}</p><button onClick={checkBackend}>Check connection</button><h3>Setup</h3><p>Run the FastAPI service using the instructions in README.md. Configure only EXTENSION_ID in backend/.env. OCR models are installed with the Python dependencies; no API key or external AI service is used.</p><p>Extension ID for backend/.env:</p><code>{globalThis.chrome?.runtime?.id??'Available after installing this extension'}</code><h3>Local processing</h3><p>The selected design, captured viewport, page URL/title, and up to 350 visible DOM elements with text, bounds, and computed styles are processed by the Python service on 127.0.0.1. Nothing is sent to an external analysis service. Input values are excluded, though screenshots can still contain private information.</p><h3>Local storage</h3><p>History is stored in this browser through IndexedDB. The backend does not save comparisons. Delete individual records in History to remove saved images and findings.</p><h3>Supported scope</h3><p>Chrome and Edge, HTTP/HTTPS pages, full document capture up to 24 megapixels and 12,000 pixels per side. Fixed/sticky elements are included once; independently scrolling inner panels and infinite-scroll pages may require manual preparation. Local OCR and comparison rules can misread text or confuse dynamic content with a design defect. Missing elements are suggestions, not proven absences. Exact design fonts and CSS spacing cannot be recovered from a raster mockup. Closed shadow roots, cross-origin iframe interiors, canvas content, and animation limit evidence. PDF reports use a Latin font; unsupported characters are shown as question marks.</p></section></main>}
    {tab==='Compare'&&<section className="compare-action" aria-label="Comparison actions"><div className="action-inner"><div className="action-readiness"><strong>{busy?'Working':missing.length?'Ready when you are':'Ready to compare'}</strong><p id="compare-readiness" role={busy?'status':undefined}>{readiness}</p></div><div className="action-buttons">{!busy&&(connection==='offline'||connection==='setup')&&<button onClick={()=>{setShowSetup(true);window.scrollTo(0,0);}}>Setup</button>}{busy&&controller.current&&<button onClick={()=>controller.current?.abort()}>Cancel</button>}<button className="primary" aria-describedby="compare-readiness" disabled={busy||!!missing.length} onClick={analyze}>{busy?'Working…':'Compare & analyze'} <span aria-hidden="true">→</span></button></div></div></section>}
    {deleted.length>0&&<div className="toast undo-toast" role="status" onMouseEnter={()=>setUndoHovered(true)} onMouseLeave={()=>setUndoHovered(false)} onFocusCapture={()=>setUndoFocused(true)} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setUndoFocused(false);}}><span>{deleted.length===1?'Comparison deleted':`${deleted.length} comparisons deleted`}</span><button disabled={busy} onClick={undoDelete}>Undo</button><button className="toast-dismiss" aria-label="Dismiss undo notification" onClick={()=>setDeleted([])}>×</button></div>}
    {!deleted.length&&status&&!busy&&<div className="toast" role="status"><span>{status}</span><button className="toast-dismiss" aria-label="Dismiss notification" onClick={()=>setStatus('')}>×</button></div>}
    <footer><span>project-1</span><span>Design evidence. Clearer feedback.</span></footer>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);

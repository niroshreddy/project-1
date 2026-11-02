import {MOBILE_PRESETS,mobilePreset,mobileScope,mobileDimensions,type MobileSelection} from './device-presets';
import {PhonePreview,usePhoneScrollSync} from './mobile-preview';
import {useDeviceState,useDeviceMode,useMobileWorkspace,WorkspaceProvider,WorkspaceSaveStatus} from './device-state';
import {AdvisorWorkspace} from './advisor-workspace';
import {JourneyWorkspace} from './journey-workspace';
import {teamToken} from './team-api';
import {IssueReview,ReviewSummary} from './review-ui';
import {TeamWorkspace} from './team-workspace';
import {carryReview} from './review';
import {basicCompare} from './browser-compare';
import { TrashIcon } from './trash-icon';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { initializeTheme } from './theme';
initializeTheme();



import type { Capture, Comparison, Design, Issue, ComparisonOptions } from './types';

import { API, analysisUrl, capturePage, captureResponsive, compare, message } from './api';

import { annotated, exportCapture, exportPdf, exportPng, rasterize, visibleIssues } from './images';

import * as store from './storage';

import './style.css';

import './workspace.css';
import './palette.css';

import { VisualModes } from './comparison-views';





function Icon({name}:{name:'arrow'|'chevron'|'image'|'download'}) {
  return <svg className="ui-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{name==='arrow'?<path d="M4 12h16m-6-6 6 6-6 6"/>:name==='chevron'?<path d="m9 5 7 7-7 7"/>:name==='download'?<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>:<><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1"/><path d="m3 17 5-5 4 4 4-6 5 7"/></>}</svg>;
}

function OrientationToggle({landscape,busy,onChange}:{landscape:boolean;busy:boolean;onChange:(value:'portrait'|'landscape')=>void}) {
 return <div className="orientation-toggle" role="group" aria-label="Device orientation">{(['portrait','landscape'] as const).map(value=><button key={value} disabled={busy} aria-pressed={landscape===(value==='landscape')} onClick={()=>onChange(value)}>{value==='portrait'?'Portrait':'Landscape'}</button>)}</div>;
}

function App() {

  const [deviceMode,setDeviceMode] = useDeviceMode();
  const mobileWorkspace=useMobileWorkspace();
  const [desktopPreset,setDesktopPreset] = useDeviceState('desktop','devicePreset','current');
  const devicePreset=deviceMode==='mobile'?mobileWorkspace.selection.presetId:desktopPreset;
  const [targetWidth,setTargetWidth] = useDeviceState(deviceMode,'targetWidth',1280,390);
  const [targetHeight,setTargetHeight] = useDeviceState(deviceMode,'targetHeight',800,844);
  const [captureMode,setCaptureMode] = useDeviceState<'full-page'|'viewport'>(deviceMode,'captureMode','full-page');
  const [browserOnly,setBrowserOnly] = useDeviceState(deviceMode,'browserOnly',false);
  const [phoneZoom,setPhoneZoom] = useDeviceState(deviceMode,'phoneZoom','fit');
  const [phoneSync,setPhoneSync] = useDeviceState(deviceMode,'phoneSync',true);
  const phones=usePhoneScrollSync(deviceMode==='mobile'&&phoneSync,phoneZoom,targetWidth,targetHeight);
  const [baselineId,setBaselineId] = useDeviceState(deviceMode,'baselineId','');
  const [suiteReferences,setSuiteReferences] = useState<Record<number,Design>>({});
  const [suiteRecords,setSuiteRecords] = useState<Comparison[]>([]);
  const [responsiveCaptures,setResponsiveCaptures] = useState<Capture[]>([]);
  const [responsiveWidths,setResponsiveWidths] = useState('768,1024,1440');
  const [uploadedUrl,setUploadedUrl] = useDeviceState(deviceMode,'uploadedUrl','https://example.com/');
  const actualInput=useRef<HTMLInputElement>(null);
  const [tab,setTab] = useState('Compare');
  const [journeyVisited,setJourneyVisited] = useState(false);
  const [advisorVisited,setAdvisorVisited] = useState(false);

  const [design,setDesign] = useDeviceState<Design|undefined>(deviceMode,'design',undefined);

  const [capture,setCapture] = useDeviceState<Capture|undefined>(deviceMode,'capture',undefined);

  const [record,setRecord] = useDeviceState<Comparison|undefined>(deviceMode,'record',undefined);

  const [records,setRecords] = useState<Comparison[]>([]);

  const [selected,setSelected] = useDeviceState<string|undefined>(deviceMode,'selected',undefined);
  const [visualMode,setVisualMode] = useDeviceState(deviceMode,'visualMode','side-by-side');
  const [previewScale,setPreviewScale] = useDeviceState(deviceMode,'previewScale','fit');
  const resultPhones=usePhoneScrollSync(deviceMode==='mobile'&&tab==='Results'&&phoneSync,phoneZoom,targetWidth,targetHeight,tab+visualMode);

  const [status,setStatus] = useState(''); const [error,setError] = useState('');

  const [busy,setBusy] = useState(false);

  const [connection,setConnection] = useState<'checking' | 'ready' | 'offline' | 'setup'>('checking');

  const [checking,setChecking] = useState(false);

  const [showSetup,setShowSetup] = useState(false);

  const [recentOpen,setRecentOpen] = useState(true);

  const [trustOpen,setTrustOpen] = useState(false);

  const [options,setOptions] = useDeviceState<ComparisonOptions>(deviceMode,'options',{tolerancePx:8,normalization:'fit'});

  const [liveViewport,setLiveViewport] = useState<{width:number;height:number}>();

  const fileInput=useRef<HTMLInputElement>(null);

  const [deleted,setDeleted] = useState<Comparison[]>([]);

  const [undoHovered,setUndoHovered] = useState(false);

  const [undoFocused,setUndoFocused] = useState(false);

  const healthController = useRef<AbortController | null>(null);

  const backend = { checking:'Checking service…', ready:'Local engine ready', offline:'Local service offline', setup:'Service needs setup' }[connection];

  const [pdfFile,setPdfFile] = useDeviceState<File|undefined>(deviceMode,'pdfFile',undefined); const [pdfPage,setPdfPage] = useDeviceState(deviceMode,'pdfPage',1); const [pdfPages,setPdfPages] = useDeviceState(deviceMode,'pdfPages',0);

  const [category,setCategory] = useDeviceState(deviceMode,'category','all'); const [showDismissed,setShowDismissed] = useDeviceState(deviceMode,'showDismissed',false);

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

  useEffect(()=>{

    if(tab!=='Compare'||busy||!globalThis.chrome?.devtools?.inspectedWindow?.eval)return;

    let active=true;

    const measure=()=>chrome.devtools.inspectedWindow.eval('({width:innerWidth,height:innerHeight})',(result,exception)=>{

      if(!active||exception?.isException)return;

      const size=result as {width?:number;height?:number};

      if(typeof size?.width==='number'&&typeof size?.height==='number')setLiveViewport({width:size.width,height:size.height});

    });

    measure();const interval=setInterval(measure,3000);return()=>{active=false;clearInterval(interval);};

  },[tab,busy]);

  useEffect(() => {

    let cancelled = false;

    if (record) annotated(record,selected).then(canvas => { if (!cancelled && canvasHost.current) {canvasHost.current.replaceChildren(canvas);resultPhones.align();} }).catch(e => setError(e.message));

    return () => { cancelled=true; };

  },[record,selected,tab,visualMode]);

  async function refresh() { try { setRecords(await store.history()); } catch { setError('Local history is unavailable. Check browser storage settings.'); } }

  async function checkBackend() {

    healthController.current?.abort();

    const request=new AbortController();healthController.current=request;setChecking(true);

    const timeout=setTimeout(()=>request.abort(),15000);

    try {

      const response=await fetch(`${analysisUrl()}/health`,{signal:request.signal});

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

    if (!design || !capture || (!browserOnly&&connection!=='ready')) return;

    await run(async () => {

      setStatus('Comparing locally with OCR, pixels, and DOM evidence…');

      controller.current=new AbortController(); const timeout=setTimeout(()=>controller.current?.abort(),180000);

      let result: Comparison;

      try { result=await (browserOnly?basicCompare(design,capture,options,controller.current.signal):compare(design,capture,controller.current.signal,options));const baseline=records.find(item=>item.id===baselineId);if(baseline)result=carryReview(result,baseline); }

      catch(e) { if (controller.current.signal.aborted) throw new Error('Comparison cancelled or timed out. You can try again.'); await checkBackend(); throw e; }

      finally { clearTimeout(timeout); controller.current=null; }

      setRecord(result); setTab('Results'); setSelected(result.issues[0]?.id); setCategory('all'); setShowDismissed(false);

      try { await store.save(result); await refresh(); setStatus('Comparison saved locally. Review findings before sharing.'); }

      catch { setError('Comparison finished, but history could not be saved. Export the result before closing this panel.'); }

    });

  }

  async function saveReview(updated:Comparison){setRecord(updated);await run(async()=>{await store.save(updated);await refresh();});}
  async function updateIssue(issue:Issue){if(!record)return;await saveReview({...record,approval:record.approval?{...record.approval,status:'draft'}:undefined,issues:record.issues.map(item=>item.id===issue.id?issue:item)});}
  async function dismiss(issue: Issue) {

    if (!record) return;

    const updated={...record,approval:record.approval?{...record.approval,status:'draft' as const}:undefined,issues:record.issues.map(i=>i.id===issue.id?{...i,dismissed:!i.dismissed,review:{status:i.dismissed?'open':'accepted',owner:i.review?.owner??'',impact:i.review?.impact??'',comment:i.review?.comment??'',updatedAt:new Date().toISOString()} as Issue['review']}:i)};

    setRecord(updated);

    await run(async()=>{await store.save(updated);await refresh();});

  }

  async function deleteComparison(item: Comparison) {

    await run(async () => {

      await store.remove(item.id);

      mobileWorkspace.clearComparison(item.id);

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

  function restoreComparison(item:Comparison,verify=false) {
    const mode=item.capture.device?.mode??deviceMode,device=item.capture.device;
    const selection:MobileSelection={presetId:device?.presetId&&mobilePreset(device.presetId)?device.presetId:'custom',orientation:device?.orientation??((device?.width??390)>(device?.height??844)?'landscape':'portrait')};
    const scope=mode==='mobile'?mobileScope(selection):'desktop';
    setDeviceMode(mode);if(mode==='mobile')mobileWorkspace.select(selection.presetId,selection.orientation);
    setRecord(verify?undefined:item,scope);setDesign(item.sourceDesign??item.design,scope);setCapture(verify?undefined:item.capture,scope);setPdfFile(undefined,scope);setPdfPages(0,scope);setPdfPage(1,scope);
    setOptions(item.options??{tolerancePx:8,normalization:'fit'},scope);setBaselineId(verify?item.id:'',scope);setSelected(item.issues.find(i=>!i.dismissed)?.id,scope);setCategory('all',scope);setShowDismissed(false,scope);
    if(device){const size=mode==='mobile'&&selection.presetId!=='custom'?mobileDimensions(selection):device;if(mode==='desktop')setDesktopPreset('custom');setTargetWidth(size.width,scope);setTargetHeight(size.height,scope);}
    setTab(verify?'Compare':'Results');setStatus(verify?'Baseline selected. Capture the updated page at the same dimensions.':'Viewing saved capture. Recapture and compare after changing the page.');
  }
  function openHistory(item:Comparison){restoreComparison(item);}


  const issues=record?.issues.filter(i=>(category==='all'||i.category===category)&&(showDismissed||!i.dismissed)) ?? [];

  const count=record?visibleIssues(record).length:0;
  function navigateFinding(direction:number) {
    const current=issues.findIndex(issue=>issue.id===selected);
    const next=issues[(current+direction+issues.length)%issues.length];
    if(next) { setSelected(next.id); document.getElementById(`finding-${next.id}`)?.scrollIntoView({block:'nearest',behavior:'smooth'}); }
  }

  const landscape=deviceMode==='mobile'?mobileWorkspace.selection.orientation==='landscape':targetWidth>targetHeight;
  function orientDevice(value:'portrait'|'landscape') {
    if(busy)return;mobileWorkspace.select(devicePreset,value);
    setStatus('Device/orientation workspace restored. Match Device Toolbar before recapturing. Each preset keeps separate saved images and settings.');
  }
  const staleWidth=!!(capture?.snapshot.viewportWidth&&liveViewport&&capture.snapshot.viewportWidth!==liveViewport.width);

  const missing = [!design && 'Upload a reference', !capture && 'Capture the page', !browserOnly&&connection==='checking' && 'Checking service', !browserOnly&&connection==='offline' && 'Start the local service or choose browser-only comparison', !browserOnly&&connection==='setup' && 'Complete service setup'].filter(Boolean);

  const readiness = busy ? (status || 'Working…') : missing.length ? missing.join(' · ') : 'Reference and capture ready. Compare when you’re ready.';

  return <div className={`app ${tab==='Compare'?'compare-workspace':''}`} onKeyDown={event=>{if(tab==='Compare'&&(event.ctrlKey||event.metaKey)&&event.key==='Enter'&&!busy&&!missing.length){event.preventDefault();analyze();}}}>

    <div className="workspace-header"><header>

      <h1 className="tool-name"><Icon name="image"/> UI Compare</h1>

      <nav aria-label="Workspace">{['Compare',...(record?['Results']:[]),'History','Ask this page','Journey Agent','Team'].map(item=><button key={item} className={tab===item?'active':''} onClick={()=>{if(item==='Journey Agent')setJourneyVisited(true);if(item==='Ask this page')setAdvisorVisited(true);setTab(item);}}>{item}{item==='Results'?<span className="count">{count}</span>:null}</button>)}</nav>

      <div className="toolbar-utilities"><details className="trust-menu" open={trustOpen} onToggle={event=>setTrustOpen(event.currentTarget.open)}><summary className={`service ${connection}`} aria-label="Local processing and connection"><span className="service-dot"/> {teamToken()?'Team service':'Local service'} <b>{checking?'Checking…':connection==='ready'?'Running':connection==='offline'?'Offline':'Setup needed'}</b></summary>

        <section className="connection-banner" aria-label="Connection guidance"><div className="connection-copy"><strong>{connection==='offline'?'Local comparison service is offline':connection==='setup'?'Local service needs setup':teamToken()?'Hosted team analysis and sharing':'Processing stays on this computer'}</strong><p>{teamToken()?'Images and page text are processed on your configured team server. Saving to Team shares screenshots and review data with workspace members.':'Images and page text go only to your local Python service. No external AI service or API key is used.'}</p></div>

        <div className="connection-actions"><button disabled={checking} onClick={checkBackend}>{checking?'Checking…':'Check connection'}</button><button aria-expanded={showSetup} aria-controls="setup-guide" onClick={()=>setShowSetup(!showSetup)}>Setup instructions</button></div>

      {showSetup&&<div className="setup-guide" id="setup-guide"><strong>Start the local service</strong><ol><li>Open PowerShell in your project-1 folder.</li><li>Run <code>.\start-backend.ps1</code> and keep that terminal open.</li><li>Set your extension ID in <code>backend/.env</code> if setup is incomplete, then select <strong>Check connection</strong>.</li></ol><p>No API key is required. You can also select browser-only comparison to skip Python, or sign in to Team for hosted analysis. See README.md for installation.</p></div>}

        <details className="capture-help"><summary>Capture guidance</summary><p>Use the same page width for your reference and capture. Keep the website selected while full-page capture scrolls. Download the raw capture for an identical-image self-check.</p></details></section></details>

        <button className={`settings-button ${tab==='Settings'?'active':''}`} aria-label="Settings" title="Settings" onClick={()=>setTab('Settings')}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z"/><circle cx="12" cy="12" r="3"/></svg></button></div>

    </header></div>

    {error&&<div role="alert" className="notice error">{error}<button aria-label="Dismiss error" onClick={()=>setError('')}>×</button></div>}


    {tab==='Compare'&&<main>


      <section className="device-controls card" aria-label="Desktop and mobile comparison">
        <div className="device-mode" role="group" aria-label="Website layout">{(['desktop','mobile'] as const).map(mode=><button key={mode} disabled={busy} aria-pressed={deviceMode===mode} onClick={()=>{setDeviceMode(mode);setError('');setStatus(`${mode==='mobile'?'Mobile':'Desktop'} workspace restored. References, captures and settings are saved separately in this browser.`);}}>{mode==='desktop'?'Desktop':'Mobile'}</button>)}</div>
        <label>Viewport preset<select aria-label="Viewport preset" disabled={busy} value={devicePreset} onChange={e=>{const value=e.target.value;if(deviceMode==='mobile'){mobileWorkspace.select(value);setError('');}else{setDesktopPreset(value);if(value!=='current'&&value!=='custom'){const [width,height]=value.split('x').map(Number);setTargetWidth(width);setTargetHeight(height);}}}}>
          {deviceMode==='desktop'?<><option value="current">Current browser viewport</option><option value="1280x800">Laptop · 1280 × 800</option><option value="1440x900">Desktop · 1440 × 900</option><option value="1920x1080">Desktop · 1920 × 1080</option></>:<>{['iPhone','iPad','Android','Generic / existing'].map(group=><optgroup key={group} label={group}>{MOBILE_PRESETS.filter(p=>p.group===group).map(p=><option key={p.id} value={p.id}>{p.name} · {landscape?p.height:p.width} × {landscape?p.width:p.height}</option>)}</optgroup>)}</>}<option value="custom">Custom dimensions</option></select></label>
        {deviceMode==='mobile'&&<OrientationToggle landscape={landscape} busy={busy} onChange={orientDevice}/>}
        {devicePreset!=='current'&&<><label>Width (CSS px)<input aria-label="Target viewport width" type="number" min="320" max="2560" disabled={busy} value={targetWidth} onChange={e=>{if(deviceMode==='mobile')mobileWorkspace.custom(Number(e.target.value),targetHeight);else{setTargetWidth(Number(e.target.value));setDesktopPreset('custom');}}}/></label><label>Height (CSS px)<input aria-label="Target viewport height" type="number" min="320" max="2560" disabled={busy} value={targetHeight} onChange={e=>{if(deviceMode==='mobile')mobileWorkspace.custom(targetWidth,Number(e.target.value));else{setTargetHeight(Number(e.target.value));setDesktopPreset('custom');}}}/></label></>}
        <details className="device-guidance"><summary>Viewport setup guidance</summary><p>{devicePreset==='current'?'Upload a desktop mockup and capture the matching live page.':`In DevTools, toggle the Device Toolbar (Ctrl+Shift+M), select Responsive, and set ${targetWidth} × ${targetHeight} CSS px. ${deviceMode==='mobile'?'Select Mobile in the device type menu; reload if the page needs it. ':''}This selector sets the capture target; it does not resize the website automatically. Capture checks these dimensions.`} {deviceMode==='mobile'?'Use a matching mobile mockup. Full-page capture keeps this width and includes the entire page.':''}</p></details>
        {capture&&<small>Saved capture: {capture.device?.mode??'Unspecified layout'} · {capture.snapshot.viewportWidth??capture.snapshot.width} × {capture.snapshot.viewportHeight??capture.snapshot.height} CSS px{capture.snapshot.fullPage?' · Full page':''}</small>}
        {deviceMode==='mobile'&&<small>Saved workspace: {mobilePreset(devicePreset)?.name} · {landscape?'Landscape':'Portrait'}</small>}<WorkspaceSaveStatus/>
      </section>
      <ol className="workflow-steps" aria-label="Comparison workflow">{[['Upload reference design','Choose your expected design',!!design],['Capture live website','Capture the matching page in this browser',!!capture],['Compare & analyze','Find visual differences',!!record]].map(([title,description,done],index)=><li key={String(title)} className={`${done?'complete':''} ${index===(!design?0:!capture?1:2)?'current':''}`}><span className="workflow-number">{done?'✓':index+1}</span><div><strong>{title}</strong><small>{description}</small></div></li>)}</ol>

      {deviceMode==='mobile'&&<div className="phone-preview-toolbar card" aria-label="Mobile preview controls"><label>Preview zoom<select aria-label="Mobile preview zoom" value={phoneZoom} onChange={e=>setPhoneZoom(e.target.value)}><option value="fit">Fit screen width</option><option value="100">100%</option><option value="150">150%</option><option value="200">200%</option></select></label><label><input type="checkbox" checked={phoneSync} onChange={e=>setPhoneSync(e.target.checked)}/>Sync device scrolling</label><p>Device frames are previews only. Zoom and scrolling do not change comparison images or exports. Synced scrolling follows relative progress when page lengths differ.</p></div>}
      <div className="inputs"><section className="card"><div className="section-title"><span className="step">1</span><h3>Reference design</h3>{design&&<span className="source-status">✓ File uploaded</span>}</div>

        {deviceMode==='mobile'?<div onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy)upload(e.dataTransfer.files[0]);}}><PhonePreview side={0} source={design?.image} empty="Upload your mobile reference" width={targetWidth} height={targetHeight} zoom={phoneZoom} controller={phones}/><input id="reference-upload" ref={fileInput} hidden aria-label="Upload mockup" type="file" accept=".png,.jpg,.jpeg,.pdf" disabled={busy} onChange={e=>{upload(e.target.files?.[0]);e.target.value='';}}/></div>:(
        <label htmlFor="reference-upload" className={`dropzone ${!design?'empty-preview':''} ${busy?'disabled':''}`} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy)upload(e.dataTransfer.files[0]);}}>

          {design?<img src={design.image} alt="Uploaded reference design"/>:<><svg className="preview-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/></svg><strong>Drop your design here</strong></>}

          <input id="reference-upload" ref={fileInput} hidden aria-label="Upload mockup" type="file" accept=".png,.jpg,.jpeg,.pdf" disabled={busy} onChange={e=>{upload(e.target.files?.[0]);e.target.value='';}}/>

        </label>
        )}

        {design&&<div className="source-details"><img src={design.image} alt=""/><div><strong>{design.name}</strong><small>{design.width} × {design.height} px</small></div><button className="remove-source" aria-label="Remove reference design" title="Remove reference design" disabled={busy} onClick={()=>{setDesign(undefined);setPdfFile(undefined);setRecord(undefined);}}><TrashIcon/> Remove</button></div>}<div className="upload-action"><span>Drop a file here or</span><button className="secondary source-action" disabled={busy} onClick={()=>fileInput.current?.click()}>{design?'Replace reference':'Choose file'}</button><small>PNG, JPG or PDF • up to 10 MB</small></div>


        {pdfFile&&<label className="pdf-picker">PDF page <input type="number" min={1} max={pdfPages} value={pdfPage} disabled={busy} onChange={e=>setPdfPage(Number(e.target.value))}/> of {pdfPages}<button disabled={busy} onClick={()=>run(()=>pdfDesign(pdfFile,pdfPage))}>Load page</button></label>}

      </section><section className="card"><div className="section-title"><span className="step">2</span><h3>Live website</h3>{capture&&<span className="source-status">✓ Page captured</span>}</div>

        {deviceMode==='mobile'?<PhonePreview side={1} source={capture?.image} empty="Capture the mobile website" width={targetWidth} height={targetHeight} zoom={phoneZoom} controller={phones}/>:(        <div className={`capture-preview ${!capture?'empty-preview':''} ${capture?.snapshot.fullPage ? "full-page" : ""}`}>{capture?<img src={capture.image} alt="Captured full page"/>:<><svg className="preview-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 8h18M7 5h1m2 0h1M8 12h8m-8 4h8"/></svg><strong>Capture the entire page</strong></>}</div>)}

        {capture&&<div className="source-details"><img src={capture.image} alt=""/><div><strong>captured-page.png</strong><small>{capture.snapshot.width} × {capture.snapshot.height} px · {new Date(capture.capturedAt).toLocaleString()}</small></div><button className="remove-source" aria-label="Remove live capture" title="Remove live capture" disabled={busy} onClick={()=>{setCapture(undefined);setRecord(undefined);}}><TrashIcon/> Remove</button></div>}
        <button className="secondary source-action capture-action" disabled={busy} onClick={()=>run(async()=>{setStatus(captureMode==='viewport'?'Capturing the visible viewport…':'Capturing the full page. Keep this tab selected and do not scroll…');const captured=await capturePage(captureMode,devicePreset==='current'?undefined:{width:targetWidth,height:targetHeight});setCapture({...captured,device:{mode:deviceMode,...(deviceMode==='mobile'?mobileWorkspace.selection:{}),width:captured.snapshot.viewportWidth??captured.snapshot.width,height:captured.snapshot.viewportHeight??captured.snapshot.height}});setRecord(undefined);setStatus(captureMode==='viewport'?'Visible viewport captured.':'Full page captured. Original scroll position restored.');})}>{capture?(captureMode==='viewport'?'Recapture viewport':'Recapture full page'):(captureMode==='viewport'?'Capture viewport':'Capture full page')}</button>

        <p className="capture-caption">Open the matching page in this browser tab.</p><div className="capture-controls"><label>Capture mode<select aria-label="Capture mode" value={captureMode} disabled={busy} onChange={e=>setCaptureMode(e.target.value as typeof captureMode)}><option value="full-page">Full page</option><option value="viewport">Visible viewport</option></select></label><details><summary>Upload a capture instead</summary><label>Page URL<input type="url" value={uploadedUrl} onChange={e=>setUploadedUrl(e.target.value)}/></label><input ref={actualInput} aria-label="Upload actual screenshot" type="file" accept=".png,.jpg,.jpeg" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(!file)return;run(async()=>{if(file.size>10*1024*1024)throw new Error('Choose a capture under 10 MB.');const url=new URL(uploadedUrl);if(!/^https?:$/.test(url.protocol))throw new Error('Enter an HTTP/HTTPS page URL.');const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Could not read capture.'));reader.readAsDataURL(file);});const image=await rasterize(data,file.name);setCapture({device:{mode:deviceMode,...(deviceMode==='mobile'?{...mobileWorkspace.selection,width:targetWidth,height:targetHeight}:{width:image.width,height:image.height})},image:image.image,capturedAt:new Date().toISOString(),snapshot:{url:url.href,title:file.name,width:image.width,height:image.height,viewportWidth:image.width,viewportHeight:image.height,fullPage:false,dpr:1,scrollX:0,scrollY:0,elements:[]}});setRecord(undefined);setStatus('Capture uploaded. No live DOM evidence is available for this image.');});e.target.value='';}}/></details></div>

        {capture&&<button className="raw-download" aria-label="Download raw capture" title="Download full-page PNG" disabled={busy} onClick={()=>exportCapture(capture)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg></button>}

      </section></div>

      {capture?.snapshot.quality?.warnings.length? <div className="card capture-warnings" role="status"><strong>Capture checks</strong><ul>{capture.snapshot.quality.warnings.map(warning=><li key={warning}>{warning}</li>)}</ul></div>:null}

      {staleWidth&&<p className="capture-warnings">The live viewport changed since capture. The saved image remains comparable; live highlighting may require a recapture.</p>}
      {design&&capture&&<div className="capture-match card"><strong>Reference {design.width} × {design.height} · Capture {capture.snapshot.width} × {capture.snapshot.height}</strong><p>{Math.abs((design.width/design.height)/(capture.snapshot.width/capture.snapshot.height)-1)>.1?'These proportions differ substantially. Choose viewport/full-page capture to match the reference before comparing.':'Compare images from the same viewport width. Small rendering differences are tolerated.'}</p></div>}
      <section className="comparison-parameters" aria-label="Comparison parameters"><div className="parameters-heading"><strong>⚙ Comparison settings</strong><span>Adjust comparison options for better results</span></div>

        <span className="viewport-reading" title="Resize the inspected page or use Chrome’s device toolbar to change width; recapture after resizing.">Viewport <strong>{liveViewport?`${liveViewport.width} × ${liveViewport.height}`:capture?`${capture.snapshot.viewportWidth??capture.snapshot.width} × ${capture.snapshot.viewportHeight??capture.snapshot.height}`:'Capture to measure'}</strong></span>

        <label>Scale <select aria-label="Scale normalization" disabled={busy} value={options.normalization} onChange={event=>setOptions({...options,normalization:event.target.value as 'fit'|'strict'})}><option value="fit">Fit reference</option><option value="strict">Exact pixels</option></select></label>

        <label title="Larger values ignore small spacing and rendering changes, but can hide small defects.">Tolerance <input aria-label="Spacing tolerance" type="number" min="0" max="16" step="1" disabled={busy} value={options.tolerancePx} onChange={event=>setOptions({...options,tolerancePx:Math.round(Math.max(0,Math.min(16,Number(event.target.value)||0)))})}/> px <span className="tolerance-slider"><input aria-label="Tolerance slider" type="range" min="0" max="16" disabled={busy} value={options.tolerancePx} onChange={event=>setOptions({...options,tolerancePx:Number(event.target.value)})}/><span>More strict <span>More tolerant</span></span></span></label>

        <label><input type="checkbox" aria-label="Browser-only comparison" checked={browserOnly} onChange={e=>setBrowserOnly(e.target.checked)}/> Browser-only comparison (no Python; raster only)</label>
        <details className="alignment-controls"><summary>Reference alignment</summary><p>Offsets use capture CSS pixels. White fills exposed edges. These settings apply to analysis and exports.</p>{(['x','y','scale'] as const).map(key=><label key={key}>{key==='scale'?'Scale factor':`${key.toUpperCase()} offset`}<input aria-label={`Alignment ${key}`} type="number" min={key==='scale'?.5:-2000} max={key==='scale'?2:2000} step={key==='scale'?.01:1} value={options.alignment?.[key]??(key==='scale'?1:0)} onChange={e=>setOptions({...options,alignment:{x:options.alignment?.x??0,y:options.alignment?.y??0,scale:options.alignment?.scale??1,[key]:Math.min(key==='scale'?2:2000,Math.max(key==='scale'?.5:-2000,Number(e.target.value)||(key==='scale'?1:0)))}})}/></label>)}<button onClick={()=>setOptions({...options,alignment:undefined})}>Reset alignment</button>{design&&capture&&<VisualModes record={{id:'preview',createdAt:'',design,capture,options,issues:[],summary:'',model:'preview',diff:{changedPercent:0,regions:[]}}} mode="overlay" align/>}</details>
        <label>Verify against baseline<select aria-label="Verification baseline" value={baselineId} onChange={e=>setBaselineId(e.target.value)}><option value="">New comparison</option>{records.map(item=><option key={item.id} value={item.id}>{item.capture.snapshot.title} · {new Date(item.createdAt).toLocaleString()}</option>)}</select></label>
      </section>
      <details className="responsive-panel card"><summary>Responsive capture suite</summary><p>Chrome will resize the inspected browser window, capture each visible viewport, then restore the window and scroll position. Use the matching reference for each width. Very narrow widths may require Chrome device emulation.</p><label>Widths in CSS pixels<input aria-label="Responsive widths" value={responsiveWidths} onChange={e=>setResponsiveWidths(e.target.value)}/></label><button disabled={busy} onClick={()=>run(async()=>{setResponsiveCaptures(await captureResponsive(responsiveWidths.split(',').map(value=>Number(value.trim()))));setStatus('Responsive captures ready. Select a capture and upload its matching reference.');})}>Capture responsive widths</button><div className="responsive-list">{responsiveCaptures.map((item,index)=><div className="card" key={index}><button onClick={()=>{setCapture(item);setRecord(undefined);setBaselineId('');}}>{item.snapshot.width} × {item.snapshot.height}</button><label>Reference for {item.snapshot.width}px<input type="file" accept=".png,.jpg,.jpeg" aria-label={`Reference ${item.snapshot.width}px`} onChange={e=>{const file=e.target.files?.[0];if(!file)return;run(async()=>{if(file.size>10*1024*1024)throw new Error('Choose a reference under 10 MB.');const reader=new FileReader();const data=await new Promise<string>((resolve,reject)=>{reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Could not read reference.'));reader.readAsDataURL(file);});const reference=await rasterize(data,file.name);setSuiteReferences(current=>({...current,[item.snapshot.width]:reference}));});e.target.value='';}}/></label><small>{suiteReferences[item.snapshot.width]?.name??'Upload matching-width reference'}</small></div>)}</div><button className="primary" disabled={busy||!responsiveCaptures.length||responsiveCaptures.some(item=>!suiteReferences[item.snapshot.width])||(!browserOnly&&connection!=='ready')} onClick={()=>run(async()=>{const completed:Comparison[]=[];setSuiteRecords([]);controller.current=new AbortController();try{for(const item of responsiveCaptures){setStatus(`Comparing ${item.snapshot.width}px…`);const reference=suiteReferences[item.snapshot.width];const result=await (browserOnly?basicCompare(reference,item,{...options,alignment:undefined},controller.current.signal):compare(reference,item,controller.current.signal,{...options,alignment:undefined}));await store.save({...result,pinned:true});completed.push(result);setSuiteRecords([...completed]);}await refresh();setStatus('Responsive comparisons completed and saved as pinned baselines. Review each width before approving.');}finally{controller.current=null;await refresh();}})}>Compare all responsive widths</button>{suiteRecords.length>0&&<ul>{suiteRecords.map(item=><li key={item.id}>{item.capture.snapshot.width}px: {visibleIssues(item).length} findings <button onClick={()=>openHistory(item)}>Review results</button></li>)}</ul>}</details>



      {records.length>0&&<section className="recent"><div className="section-title"><h3><button className="recent-toggle" aria-expanded={recentOpen} onClick={()=>setRecentOpen(!recentOpen)}>Recent comparisons <span className={recentOpen?'expanded-chevron':''}><Icon name="chevron"/></span></button></h3></div>{recentOpen&&(records.length?records.slice(0,3).map(item=><div className="recent-row" key={item.id}><button disabled={busy} className="history-row" onClick={()=>openHistory(item)}><Icon name="image"/><div><strong>{item.capture.snapshot.title||'Untitled page'}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></div><span>{visibleIssues(item).length} findings <Icon name="arrow"/></span></button><button className="delete-recent" disabled={busy} aria-label={`Delete comparison ${item.capture.snapshot.title||'Untitled page'}`} title="Delete comparison" onClick={()=>deleteComparison(item)}><TrashIcon/> Delete</button></div>):<p className="empty-inline">No comparisons yet.</p>)}</section>}

    </main>}

    {tab==='Results'&&(!record?<main className="empty"><Icon name="image"/><h2>No comparison yet</h2><p>Upload a design and capture your website to get started.</p><button className="primary" onClick={()=>setTab('Compare')}>Start a comparison</button></main>:<main className="results"><div className="results-heading"><div><span className="eyebrow">RESULTS</span><h2>{count} active {count===1?'finding':'findings'}</h2><p>{record.summary}</p></div><div className="exports"><button disabled={busy} onClick={()=>run(()=>exportPng(record))}><Icon name="download"/> PNG</button><button className="primary" disabled={busy} onClick={()=>run(()=>exportPdf(record))}><Icon name="download"/> PDF report</button></div></div>

      <ReviewSummary key={record.id} record={record} onChange={saveReview}/>
      <div className="result-meta">{record.capture.snapshot.width} × {record.capture.snapshot.height} CSS px <span>·</span> {record.diff.changedPercent}% pixels changed <span>·</span> {record.model}{record.options&&<span className="saved-options">Tolerance {record.options.tolerancePx}px · {record.options.normalization==='fit'?'Fit reference':'Exact pixels'}</span>}</div>

      <p className="hint">Pixel change is a visual signal, not an accuracy score. Measured findings describe visible differences; possible issues need verification. Rule confidence is a heuristic, not an accuracy probability.</p>

      <div className="preview-toolbar"><strong>Visual comparison</strong><label>View <select aria-label="Comparison view" value={visualMode} onChange={event=>setVisualMode(event.target.value)}><option value="side-by-side">Side-by-side</option><option value="overlay">Overlay</option><option value="difference">Difference</option></select></label>{deviceMode==='mobile'?<><OrientationToggle landscape={landscape} busy={busy} onChange={orientDevice}/><label>Preview zoom<select aria-label="Mobile preview zoom" value={phoneZoom} onChange={e=>setPhoneZoom(e.target.value)}><option value="fit">Fit screen width</option><option value="100">100%</option><option value="150">150%</option><option value="200">200%</option></select></label>{visualMode==='side-by-side'&&<label><input type="checkbox" checked={phoneSync} onChange={e=>setPhoneSync(e.target.checked)}/>Sync device scrolling</label>}<span>Device frames are previews only; exports contain the original screenshots and annotations. Match Device Toolbar and source images to the selected orientation.</span></>:<><label>Preview size <select aria-label="Preview size" value={previewScale} onChange={event=>setPreviewScale(event.target.value)}><option value="fit">Fit width</option><option value="100">100% · actual pixels</option></select></label><span>Scroll each image to inspect the full page.</span></>}</div>
      {deviceMode==='mobile'?(visualMode==='side-by-side'&&<div className="mobile-result-phones"><section className="card"><h3>Expected design</h3><PhonePreview side={0} source={record.design.image} empty="Reference design" label="Mobile Results reference screen" width={targetWidth} height={targetHeight} zoom={phoneZoom} controller={resultPhones}/></section><section className="card"><h3>Actual page · annotated</h3><PhonePreview side={1} empty="Annotated capture" label="Mobile Results annotated screen" width={targetWidth} height={targetHeight} zoom={phoneZoom} controller={resultPhones}><div className="canvas-host" ref={canvasHost} role="img" aria-label="Actual page with numbered red issue annotations"/></PhonePreview></section></div>):(<div hidden={visualMode!=='side-by-side'} className={`comparison-images ${previewScale==='100'?'actual-size':''}`}><section className="card"><h3>Expected design</h3><div className="result-image-scroll" tabIndex={0} aria-label="Reference preview"><img style={previewScale==='100'?{width:record.design.width}:undefined} src={record.design.image} alt="Expected design"/></div></section><section className="card"><h3>Actual page · annotated</h3><div className="result-image-scroll" tabIndex={0} aria-label="Annotated capture preview"><div className="canvas-host" style={previewScale==='100'?{width:record.capture.snapshot.width}:undefined} ref={canvasHost} role="img" aria-label="Actual page with numbered red issue annotations"/></div></section></div>)}
      {(visualMode==='overlay'||visualMode==='difference')&&<VisualModes record={record} mode={visualMode} phone={deviceMode==='mobile'?{width:targetWidth,height:targetHeight,zoom:phoneZoom,controller:resultPhones}:undefined}/>}
      <div className="filter-row"><label>Category <select value={category} onChange={e=>setCategory(e.target.value)}><option value="all">All findings</option>{['missing','text','layout','spacing','style'].map(c=><option key={c}>{c}</option>)}</select></label><label><input type="checkbox" checked={showDismissed} onChange={e=>setShowDismissed(e.target.checked)}/> Show dismissed</label></div>

      {issues.length>0&&<div className="finding-navigation" aria-label="Finding navigation"><span>{issues.findIndex(issue=>issue.id===selected)>=0?`Finding ${issues.findIndex(issue=>issue.id===selected)+1} of ${issues.length}`:`${issues.length} findings`}</span><button onClick={()=>navigateFinding(-1)} disabled={issues.length<2}>Previous finding</button><button onClick={()=>navigateFinding(1)} disabled={issues.length<2}>Next finding <Icon name="arrow"/></button></div>}
      {!issues.length&&<div className="card empty-inline">No findings in this view. A clean result does not guarantee pixel-perfect compliance.</div>}

      <div className="issue-list">{issues.map(issue=><article id={`finding-${issue.id}`} key={issue.id} className={`issue ${selected===issue.id?'selected':''} ${issue.dismissed?'dismissed':''}`}><button className="issue-heading" onClick={()=>setSelected(issue.id)}><span className="issue-number">{record.issues.indexOf(issue)+1}</span><strong>{issue.title}</strong><span className={`severity ${issue.severity}`}>{issue.severity}</span></button><div className="issue-content"><div className="issue-tags">{issue.category} · {issue.basis === 'measured' ? 'Measured difference' : issue.basis === 'possible' ? 'Possible issue' : 'Legacy finding'} · {Math.round(issue.confidence*100)}% {issue.basis ? 'rule confidence' : 'reported confidence'} {issue.confidence<.75?'· Needs verification':''}</div><dl><dt>Expected</dt><dd>{issue.expected}</dd><dt>Actual</dt><dd>{issue.actual}</dd></dl><p>{issue.explanation}</p><p className="recommendation"><strong>Suggested correction</strong><br/>{issue.recommendation}</p><IssueReview key={`${record.id}:${issue.id}`} record={record} issue={issue} onChange={updateIssue} onError={setError}/><div className="issue-actions"><button disabled={busy||issue.dismissed} onClick={()=>run(async()=>{setSelected(issue.id);await message({type:'highlight',box:issue.box,snapshot:record.capture.snapshot,label:`${record.issues.indexOf(issue)+1}. ${issue.title}`});setStatus('Highlighted on the live page for 8 seconds.');})}>Locate on live page</button><button disabled={busy} onClick={()=>dismiss(issue)}>{issue.dismissed?'Restore finding':'Dismiss finding'}</button></div></div></article>)}</div>

    </main>)}

    <div hidden={tab!=='Ask this page'}>{advisorVisited&&<AdvisorWorkspace/>}</div>
    <div hidden={tab!=='Journey Agent'}>{journeyVisited&&<JourneyWorkspace/>}</div>
    <div hidden={tab!=='Team'}><TeamWorkspace record={record} onOpen={openHistory} onConnection={checkBackend}/></div>
    {tab==='History'&&<main><div className="intro"><span className="eyebrow">SAVED IN THIS BROWSER</span><h2>Comparison history</h2><p>The latest 15 unpinned comparisons and all pinned baselines are kept locally, including images and review decisions.</p></div>{records.length?records.map(item=><div className="history-card card" key={item.id}><img src={item.capture.image} alt="Saved viewport thumbnail"/><div><h3>{item.capture.snapshot.title||'Untitled page'}</h3><p className="metadata">{item.capture.snapshot.url}</p><small>{new Date(item.createdAt).toLocaleString()} · {visibleIssues(item).length} findings</small></div><button disabled={busy} onClick={()=>openHistory(item)}>Open</button><button disabled={busy} onClick={()=>run(async()=>{await store.save({...item,pinned:!item.pinned});await refresh();})}>{item.pinned?'Unpin baseline':'Pin baseline'}</button><button disabled={busy} onClick={()=>restoreComparison(item,true)}>Verify fixes</button><button className="remove-source" disabled={busy} aria-label={`Delete comparison ${item.capture.snapshot.title}`} onClick={()=>deleteComparison(item)}><TrashIcon/> Delete</button></div>):<p className="empty-inline">No saved comparisons yet.</p>}</main>}

    {tab==='Settings'&&<main><div className="intro"><span className="eyebrow">LOCAL PYTHON SERVICE</span><h2>Connection & privacy</h2></div><section className="card settings"><h3>Backend connection</h3><code>{API}</code><p>{backend}</p><button onClick={checkBackend}>Check connection</button><h3>Setup</h3><p>Run the FastAPI service using the instructions in README.md. Configure only EXTENSION_ID in backend/.env. OCR models are installed with the Python dependencies; no API key or external AI service is used.</p><p>Extension ID for backend/.env:</p><code>{globalThis.chrome?.runtime?.id??'Available after installing this extension'}</code><h3>Local processing</h3><p>By default, the selected design, captured page, URL/title and available DOM evidence are processed by Python on 127.0.0.1. Browser-only mode keeps raster comparison in this panel. Signing in to Team uses your configured hosted Python server instead. No external AI service is used. Input values are excluded, though screenshots can still contain private information.</p><h3>Local storage</h3><p>Desktop/Mobile references, captures, PDF files, settings and results are autosaved in this browser through IndexedDB. Wait for the workspace saved status before closing DevTools. Remove reference/capture drafts in their workspace; deleting a History record does not remove its separately retained draft. Local history is also stored in IndexedDB. The local analysis service does not save comparisons; explicit Team saves persist screenshots and reviews on your configured hosted server. Delete individual records in History to remove saved images and findings.</p><h3>Supported scope</h3><p>Chrome and Edge, HTTP/HTTPS pages, full document capture up to 24 megapixels and 12,000 pixels per side. Fixed/sticky elements are included once; independently scrolling inner panels and infinite-scroll pages may require manual preparation. Local OCR and comparison rules can misread text or confuse dynamic content with a design defect. Missing elements are suggestions, not proven absences. Exact design fonts and CSS spacing cannot be recovered from a raster mockup. Closed shadow roots, cross-origin iframe interiors, canvas content, and animation limit evidence. PDF reports use a Latin font; unsupported characters are shown as question marks.</p></section></main>}

    {tab==='Compare'&&<section className="compare-action" aria-label="Comparison actions"><div className="action-inner"><div className="action-readiness"><span className={`readiness-icon ${missing.length?'pending':''}`} aria-hidden="true">{missing.length?'→':'✓'}</span><strong>{busy?'Working':missing.length?'Compare unavailable':'Ready to compare'}</strong><p id="compare-readiness" role={busy?'status':undefined}>{readiness}</p></div><div className="action-buttons">{!busy&&(connection==='offline'||connection==='setup')&&<button onClick={()=>{setShowSetup(true);setTrustOpen(true);window.scrollTo(0,0);}}>Setup</button>}{busy&&controller.current&&<button onClick={()=>controller.current?.abort()}>Cancel</button>}<button className="primary" aria-describedby="compare-readiness" title={busy?readiness:missing.length?`Compare unavailable: ${readiness}`:'Compare (Ctrl+Enter)'} disabled={busy||!!missing.length} onClick={analyze}>{busy?'Working…':'Compare & analyze'} <Icon name="arrow"/></button></div></div></section>}

    {deleted.length>0&&<div className="toast undo-toast" role="status" onMouseEnter={()=>setUndoHovered(true)} onMouseLeave={()=>setUndoHovered(false)} onFocusCapture={()=>setUndoFocused(true)} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setUndoFocused(false);}}><span>{deleted.length===1?'Comparison deleted':`${deleted.length} comparisons deleted`}</span><button disabled={busy} onClick={undoDelete}>Undo</button><button className="toast-dismiss" aria-label="Dismiss undo notification" onClick={()=>setDeleted([])}>×</button></div>}

    {!deleted.length&&status&&!busy&&<div className="toast" role="status"><span>{status}</span><button className="toast-dismiss" aria-label="Dismiss notification" onClick={()=>setStatus('')}>×</button></div>}


  </div>;

}


createRoot(document.getElementById('root')!).render(<WorkspaceProvider><App/></WorkspaceProvider>);

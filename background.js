if(typeof importScripts==='function')importScripts('device-preview.js');
// Read-only advisor evidence: no field values, screenshots, cookies or full page text.
function collectAdvisorEvidence() {
  const clean=value=>String(value||'').replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[email]').replace(/\d{6,}/g,'[number]').replace(/\s+/g,' ').trim().slice(0,160);
  const labelText=label=>{const clone=label.cloneNode(true);clone.querySelectorAll('input,select,textarea').forEach(node=>node.remove());return clone.textContent;};
  const nodes=[...document.querySelectorAll('button,a[href],input,select,textarea,[role="button"],[role="link"]')];
  const visible=nodes.filter(node=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node);return r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth&&s.visibility==='visible'&&s.display!=='none'&&s.opacity!=='0'&&node.type!=='hidden';});
  const controls=visible.slice(0,160).map((node,index)=>{
    const rect=node.getBoundingClientRect();
    const references=attribute=>(node.getAttribute(attribute)||'').split(/\s+/).map(id=>document.getElementById(id)).filter(Boolean);
    const labelled=references('aria-labelledby').map(el=>el.textContent).join(' ');
    const labels=node.labels?[...node.labels].map(labelText).join(' '):'';
    const content=['BUTTON','A'].includes(node.tagName)||node.getAttribute('role')==='button'?node.textContent:'';
    const name=clean(labelled||node.getAttribute('aria-label')||labels||content||node.getAttribute('title')||node.getAttribute('alt'));
    return {id:'e'+(index+1),tag:node.tagName.toLowerCase(),name,width:Math.round(rect.width*100)/100,height:Math.round(rect.height*100)/100,interactive:!node.disabled,needsLabel:true,invalid:node.getAttribute('aria-invalid')==='true',errorAssociated:[...references('aria-describedby'),...references('aria-errormessage')].some(el=>el.textContent?.trim())};
  });
  return {page:location.origin,capturedAt:new Date().toISOString(),width:innerWidth,height:innerHeight,overflow:Math.max(0,document.documentElement.scrollWidth-document.documentElement.clientWidth),total:visible.length,controls};
}

// Capture runs in the service worker so it always targets the inspected tab.
function inspectViewport(fullPage = false) {
  document.getElementById('__project1_overlay')?.remove();
  const root = document.documentElement;
  const horizontalAllowed = ![root, document.body].some(element => ['hidden', 'clip'].includes(getComputedStyle(element).overflowX));
  const width = fullPage ? (globalThis.__project1_capture_state?.width ?? (horizontalAllowed ? root.scrollWidth : root.clientWidth)) : innerWidth;
  const height = fullPage ? Math.max(root.scrollHeight, root.clientHeight) : innerHeight;
  const elements = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let node;
  let visited = 0;
  while ((node = walker.nextNode()) && visited++ < 15000 && elements.length < 350) {
    const rect = node.getBoundingClientRect();
    const x = rect.x + (fullPage ? scrollX : 0), y = rect.y + (fullPage ? scrollY : 0);
    if (rect.width < 2 || rect.height < 2 || y + rect.height <= 0 || x + rect.width <= 0 || y >= height || x >= width) continue;
    const style = getComputedStyle(node);
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
    if (['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(node.tagName)) continue;
    const text = [...node.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join(' ').trim().slice(0, 140);
    if (!text && !['IMG', 'BUTTON', 'A', 'SVG', 'VIDEO'].includes(node.tagName)) continue;
    elements.push({ tag: node.tagName.toLowerCase(), text,
      box: { x: Math.max(0, x) / width, y: Math.max(0, y) / height,
        width: (Math.min(width, x + rect.width) - Math.max(0, x)) / width,
        height: (Math.min(height, y + rect.height) - Math.max(0, y)) / height },
      fontSize: style.fontSize, fontFamily: style.fontFamily, color: style.color,
      background: style.backgroundColor, display: style.display, gap: style.gap, padding: style.padding });
  }
  return { url: location.href, title: document.title.slice(0, 1000), width, height,
    viewportWidth: innerWidth, viewportHeight: innerHeight, fullPage,
    dpr: devicePixelRatio, scrollX, scrollY, elements };
}

async function positionFullPage(action, x = 0, y = 0) {
  const root = document.documentElement;
  const key = '__project1_capture_state';
  if (action === 'restore') {
    const state = globalThis[key];
    if (state) {
      state.observer.disconnect();
      for (const [element, properties] of state.changed) {
        for (const [property, value, priority] of properties) {
          if (value) element.style.setProperty(property, value, priority);
          else element.style.removeProperty(property);
        }
      }
      scrollTo({ left: state.x, top: state.y, behavior: 'instant' });
      state.style.remove(); delete globalThis[key];
    }
    return;
  }
  if (action === 'begin') {
    if (globalThis[key]) throw new Error('A capture is already running on this page.');
    const style = document.createElement('style');
    style.textContent = '*{scroll-behavior:auto!important;animation-play-state:paused!important;transition:none!important}';
    const state = { x: scrollX, y: scrollY, style, changed: new Map(), hidden: new Set(), suppressFixed: false, width: root.clientWidth };
    state.set = (element, property, value) => {
      if (!state.changed.has(element)) state.changed.set(element, []);
      const properties = state.changed.get(element);
      if (!properties.some(item => item[0] === property)) properties.push([property, element.style.getPropertyValue(property), element.style.getPropertyPriority(property)]);
      if (element.style.getPropertyValue(property) !== value || element.style.getPropertyPriority(property) !== 'important') element.style.setProperty(property, value, 'important');
    };
    state.stabilize = () => {
      const roots = [document];
      for (const tree of roots) {
        for (const element of tree.querySelectorAll('*')) {
          if (element.shadowRoot) roots.push(element.shadowRoot);
          if (!(element instanceof HTMLElement || element instanceof SVGElement)) continue;
          const css = getComputedStyle(element);
          // Sticky elements stay in their natural document location instead of
          // appearing once per viewport or disappearing before they are reached.
          if (css.position === 'sticky') {
            state.set(element, 'position', 'relative');
            for (const property of ['top', 'right', 'bottom', 'left']) state.set(element, property, 'auto');
          }
          if (css.backgroundAttachment.split(',').some(value => value.trim() === 'fixed')) state.set(element, 'background-attachment', 'scroll');
          if (state.suppressFixed && css.position === 'fixed') state.hidden.add(element);
          if (state.hidden.has(element) || state.suppressFixed && element.parentElement && state.hidden.has(element.parentElement) || state.suppressFixed && tree.host && state.hidden.has(tree.host)) {
            state.hidden.add(element); state.set(element, 'visibility', 'hidden'); state.set(element, 'opacity', '0');
          }
        }
        state.observer.observe(tree, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'] });
      }
    };
    state.observer = new MutationObserver(() => state.stabilize());
    globalThis[key] = state; document.documentElement.append(style);
    state.stabilize();
    // Measure the reachable horizontal range, not body overflow from clipped
    // carousels, transformed decorations, or off-screen menus.
    state.horizontalAllowed = ![root, document.body].some(element => ['hidden', 'clip'].includes(getComputedStyle(element).overflowX));
    if (state.horizontalAllowed) scrollTo({ left: 10000000, top: 0, behavior: 'instant' });
    state.width = root.clientWidth + (state.horizontalAllowed ? Math.round(Math.max(0, scrollX)) : 0);
    state.rawWidth = root.scrollWidth;
  }
  if (action === 'next') {
    const state = globalThis[key];
    if (!state) throw new Error('Capture state was lost. Try again.');
    state.suppressFixed = true;
  }
  scrollTo({ left: x, top: y, behavior: 'instant' });
  await new Promise(resolve => setTimeout(resolve, 150));
  // Give lazy images a bounded opportunity to render without waiting indefinitely.
  await Promise.race([Promise.all([...document.images].filter(image => {
    const rect = image.getBoundingClientRect(); return rect.bottom > 0 && rect.top < innerHeight;
  }).map(image => image.decode().catch(() => {}))), new Promise(resolve => setTimeout(resolve, 1000))]);
  const state = globalThis[key];
  state.stabilize();
  return { url: location.href, x: scrollX, y: scrollY, width: state.horizontalAllowed ? state.width + root.scrollWidth - state.rawWidth : root.clientWidth,
    height: Math.max(root.scrollHeight, root.clientHeight),
    tileWidth: root.clientWidth, tileHeight: root.clientHeight, viewportWidth: innerWidth, viewportHeight: innerHeight };
}

let fullPageBusy = false;
async function captureFullPage(tabId) {
  if (fullPageBusy) throw new Error('A full-page capture is already running.');
  fullPageBusy = true;
  const target = { tabId };
  let began = false;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active || !/^https?:/.test(tab.url || '')) throw new Error('Select the inspected HTTP/HTTPS website tab before capturing.');
    began = true;
    const [{ result: initial }] = await chrome.scripting.executeScript({ target, func: positionFullPage, args: ['begin'] });
    if (!initial || initial.width > 12000 || initial.height > 12000 || initial.width * initial.height > 24000000)
      throw new Error('Full page exceeds the 12,000-pixel side or 24-megapixel limit. Use a smaller page or browser zoom.');
    const [{ result: snapshot }] = await chrome.scripting.executeScript({ target, func: inspectViewport, args: [true] });
    const canvas = new OffscreenCanvas(initial.width, initial.height);
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    let lastCapture = Date.now(), count = 0;
    for (let y = 0; y < initial.height; y += initial.tileHeight) {
      for (let x = 0; x < initial.width; x += initial.tileWidth) {
        if (++count > 80) throw new Error('Page requires too many capture tiles. Reduce the page size or browser zoom.');
        // Throttle before preparing the page, so fixed elements are suppressed
        // after scroll handlers have run and immediately before the screenshot.
        await new Promise(resolve => setTimeout(resolve, Math.max(0, 550 - (Date.now() - lastCapture))));
        const [{ result: tile }] = await chrome.scripting.executeScript({ target, func: positionFullPage, args: [count === 1 ? 'position' : 'next', x, y] });
        if (!tile || ['url','width','height','viewportWidth','viewportHeight'].some(key => initial[key] !== tile[key]))
          throw new Error('The page size changed during full-page capture. Load lazy content first, then try again.');
        const active = await chrome.tabs.query({ windowId: tab.windowId, active: true });
        if (active[0]?.id !== tabId) throw new Error('Keep the inspected website tab selected during full-page capture.');
        // Chrome permits at most two visible-tab captures per second.
        const data = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }); lastCapture = Date.now();
        const [{ result: after }] = await chrome.scripting.executeScript({ target, func: () => ({ x: scrollX, y: scrollY, url: location.href, width: innerWidth, height: innerHeight }) });
        const selected = await chrome.tabs.query({ windowId: tab.windowId, active: true });
        if (selected[0]?.id !== tabId || after.url !== initial.url || after.x !== tile.x || after.y !== tile.y || after.width !== initial.viewportWidth || after.height !== initial.viewportHeight)
          throw new Error('The page moved during capture. Keep the tab selected and do not scroll while capturing.');
        const bytes = Uint8Array.from(atob(data.split(',')[1]), character => character.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const scaleX = bitmap.width / initial.viewportWidth, scaleY = bitmap.height / initial.viewportHeight;
        // The last scroll is clamped. Copy only the uncovered part to avoid seams
        // and overwriting earlier pixels where fixed/sticky elements were visible.
        const width = Math.min(initial.tileWidth, initial.width - x), height = Math.min(initial.tileHeight, initial.height - y);
        if (x < tile.x || y < tile.y || x-tile.x+width > tile.tileWidth || y-tile.y+height > tile.tileHeight) {
          bitmap.close(); throw new Error('The page could not scroll to the requested capture area. Capture stopped to avoid blank padding.');
        }
        context.drawImage(bitmap, (x-tile.x)*scaleX, (y-tile.y)*scaleY, width*scaleX, height*scaleY, x, y, width, height);
        bitmap.close();
      }
    }
    const [{ result: final }] = await chrome.scripting.executeScript({ target, func: positionFullPage, args: ['position', 0, 0] });
    if (final.width !== initial.width || final.height !== initial.height || final.url !== initial.url) throw new Error('Page changed during capture. Try again after loading finishes.');
    const png = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
    if (png.length > 8500000) throw new Error('Full-page PNG exceeds the comparison size limit. Reduce browser zoom and retry.');
    let binary = '';
    for (let offset = 0; offset < png.length; offset += 32768) binary += String.fromCharCode(...png.subarray(offset, offset+32768));
    return { image: 'data:image/png;base64,' + btoa(binary), snapshot: { ...snapshot, scrollX: 0, scrollY: 0 }, capturedAt: new Date().toISOString() };
  } finally {
    if (began) await chrome.scripting.executeScript({ target, func: positionFullPage, args: ['restore'] }).catch(() => {});
    fullPageBusy = false;
  }
}

async function capture(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.active || !tab.url || !/^https?:/.test(tab.url)) throw new Error('Select the inspected HTTP/HTTPS website tab before capturing.');
  const [before] = await chrome.scripting.executeScript({ target: { tabId }, func: inspectViewport });
  const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const [after] = await chrome.scripting.executeScript({ target: { tabId }, func: () => ({ url: location.href, width: innerWidth, height: innerHeight, scrollX, scrollY }) });
  const active = await chrome.tabs.query({ windowId: tab.windowId, active: true });
  if (active[0]?.id !== tabId || ['url', 'width', 'height', 'scrollX', 'scrollY'].some(k => before.result[k] !== after.result[k]))
    throw new Error('The page changed during capture. Keep the inspected tab selected and try again.');
  return { image, snapshot: before.result, capturedAt: new Date().toISOString() };
}

async function showHighlight(box, snapshot, label) {
  document.getElementById('__project1_overlay')?.remove();
  if (!box) return;
  const fullPage = snapshot.fullPage;
  const root = document.documentElement;
  const horizontalAllowed = ![root, document.body].some(element => ['hidden', 'clip'].includes(getComputedStyle(element).overflowX));
  if (location.href !== snapshot.url || innerWidth !== (snapshot.viewportWidth ?? snapshot.width) || innerHeight !== (snapshot.viewportHeight ?? snapshot.height) ||
      (!fullPage && (scrollX !== snapshot.scrollX || scrollY !== snapshot.scrollY)) ||
      (fullPage && ((horizontalAllowed ? root.scrollWidth : root.clientWidth) !== snapshot.width || Math.max(root.scrollHeight, root.clientHeight) !== snapshot.height)))
    throw new Error('Page position or viewport changed. Capture and compare again to highlight this issue.');
  if (fullPage) {
    scrollTo({ left: Math.max(0,box.x*snapshot.width-innerWidth/3), top: Math.max(0,box.y*snapshot.height-innerHeight/3), behavior: 'instant' });
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  const host = document.createElement('div'); host.id = '__project1_overlay';
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  const shadow = host.attachShadow({ mode: 'closed' });
  const marker = document.createElement('div');
  marker.style.cssText = `position:absolute;box-sizing:border-box;border:2px solid #ef3340;background:#ef334014;left:${box.x*snapshot.width-(fullPage?scrollX:0)}px;top:${box.y*snapshot.height-(fullPage?scrollY:0)}px;width:${box.width*snapshot.width}px;height:${box.height*snapshot.height}px;`;
  const text = document.createElement('span'); text.textContent = label;
  text.style.cssText = 'position:absolute;top:0;left:0;background:#c51d30;color:white;font:12px system-ui;padding:3px 7px;max-width:300px';
  marker.append(text); shadow.append(marker); document.documentElement.append(host);
  const clear = () => host.remove();
  addEventListener('scroll', clear, { once: true, capture: true });
  addEventListener('resize', clear, { once: true });
  setTimeout(clear, 8000);
}

async function pageQuality() {
  await Promise.race([document.fonts.ready,new Promise(resolve=>setTimeout(resolve,2500))]);
  await Promise.race([Promise.all([...document.images].filter(image=>{const rect=image.getBoundingClientRect();return rect.bottom>0&&rect.top<innerHeight;}).map(image=>image.decode().catch(()=>{}))),new Promise(resolve=>setTimeout(resolve,2500))]);
  const before=[document.documentElement.scrollWidth,document.documentElement.scrollHeight,innerWidth,innerHeight];
  await new Promise(resolve=>setTimeout(resolve,300));
  const after=[document.documentElement.scrollWidth,document.documentElement.scrollHeight,innerWidth,innerHeight];
  const pendingImages=[...document.images].filter(image=>!image.complete&&image.getBoundingClientRect().bottom>0&&image.getBoundingClientRect().top<innerHeight).length;
  const brokenImages=[...document.images].filter(image=>image.complete&&image.currentSrc&&image.naturalWidth===0).length;
  const fontsReady=document.fonts.status==='loaded',layoutStable=before.every((value,index)=>value===after[index]);
  const warnings=[];
  if(!fontsReady)warnings.push('Web fonts are still loading.');
  if(pendingImages)warnings.push(`${pendingImages} visible images are still loading.`);
  if(brokenImages)warnings.push(`${brokenImages} images failed to load.`);
  if(!layoutStable)warnings.push('Document dimensions changed while checking stability.');
  if(document.querySelector('video,canvas'))warnings.push('Video or canvas content can change between captures.');
  return {ready:fontsReady&&!pendingImages&&layoutStable,pendingImages,brokenImages,fontsReady,layoutStable,warnings};
}
let responsiveBusy=false;
async function captureResponsive(tabId,widths) {
 if(responsiveBusy||fullPageBusy)throw new Error('A capture is already running.');
 if(!Array.isArray(widths)||widths.length<1||widths.length>5||widths.some(width=>!Number.isInteger(width)||width<320||width>2560))throw new Error('Choose 1–5 widths between 320 and 2560 CSS px.');
 const tab=await chrome.tabs.get(tabId),original=await chrome.windows.get(tab.windowId);
 if(!tab.active||!/^https?:/.test(tab.url||''))throw new Error('Select the inspected HTTP/HTTPS website before responsive capture.');
 const [position]=await chrome.scripting.executeScript({target:{tabId},func:()=>({x:scrollX,y:scrollY})});
 if(responsiveBusy||fullPageBusy)throw new Error('A capture is already running.');
 responsiveBusy=true;
 try {
   const captures=[];
   for(const width of widths){
     for(let attempt=0;attempt<3;attempt++){
       const [size]=await chrome.scripting.executeScript({target:{tabId},func:()=>({width:innerWidth})});
       if(size.result.width===width)break;
       const current=await chrome.windows.get(tab.windowId);
       await chrome.windows.update(tab.windowId,{state:'normal',width:Math.max(320,current.width+width-size.result.width)});
       await new Promise(resolve=>setTimeout(resolve,450));
     }
     const [size]=await chrome.scripting.executeScript({target:{tabId},func:()=>innerWidth});
     if(size.result!==width)throw new Error(`Chrome could not reach ${width}px (actual ${size.result}px). Use device emulation and a single capture for narrower mobile widths.`);
     const [quality]=await chrome.scripting.executeScript({target:{tabId},func:pageQuality});
     if(!quality.result.ready)throw new Error(`Page is not ready at ${width}px. Wait for images/fonts/layout to settle.`);
     await chrome.scripting.executeScript({target:{tabId},func:()=>scrollTo(0,0)});
     const result=await capture(tabId);if(result.snapshot.url!==tab.url)throw new Error('The inspected page navigated during responsive capture. Run the suite again.');result.snapshot.quality=quality.result;captures.push(result);
     await new Promise(resolve=>setTimeout(resolve,650));
   }
   return captures;
 } finally {
   await chrome.windows.update(tab.windowId,{state:'normal',width:original.width,height:original.height,left:original.left,top:original.top}).catch(()=>{});
   if(original.state!=='normal')await chrome.windows.update(tab.windowId,{state:original.state}).catch(()=>{});
   await chrome.scripting.executeScript({target:{tabId},func:(x,y)=>scrollTo(x,y),args:[position.result.x,position.result.y]}).catch(()=>{});
   responsiveBusy=false;
 }
}

const devicePreview=globalThis.createDevicePreviewManager?.(chrome,{inspectViewport,pageQuality,positionFullPage,showHighlight});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !['panel.html', 'dist/panel.html'].some(path => sender.url === chrome.runtime.getURL(path))) return;
  const run = async () => {
    if(typeof message.type==='string'&&message.type.startsWith('preview')){
      if(!devicePreview)throw new Error('Reload the extension to enable device preview.');
      if(message.type==='previewOpen')return devicePreview.open(message.tabId,message.settings);
      if(message.type==='previewResize')return devicePreview.resize(message.tabId,message.settings);
      if(message.type==='previewStatus')return devicePreview.status(message.tabId);
      if(message.type==='previewCapture')return devicePreview.capture(message.tabId,message.settings,message.mode);
      if(message.type==='previewFocus')return devicePreview.focus(message.tabId);
      if(message.type==='previewClose')return devicePreview.close(message.tabId);
      if(message.type==='previewHighlight')return devicePreview.highlight(message.tabId,message.previewTabId,message.previewSessionId,message.snapshot,message.box,message.label);
    }
    if (message.type === 'advisorEvidence') {
      const tab=await chrome.tabs.get(message.tabId);
      if(!tab.active||!/^https?:/.test(tab.url||''))throw new Error('Select the inspected HTTP/HTTPS website to collect evidence.');
      const [result]=await chrome.scripting.executeScript({target:{tabId:message.tabId},func:collectAdvisorEvidence});
      return result.result;
    }
    if (message.type === 'captureResponsive') return captureResponsive(message.tabId,message.widths);
    if (responsiveBusy) throw new Error('Responsive capture is in progress.');
    if (message.type === 'validateViewport') {
      if(!Number.isInteger(message.width)||!Number.isInteger(message.height)||message.width<320||message.width>2560||message.height<320||message.height>2560)throw new Error('Invalid viewport dimensions.');
      const [size]=await chrome.scripting.executeScript({target:{tabId:message.tabId},func:()=>({width:innerWidth,height:innerHeight})});
      if(size.result.width!==message.width||size.result.height!==message.height)throw new Error(`Live viewport is ${size.result.width} × ${size.result.height}. Set Device Toolbar to ${message.width} × ${message.height} CSS px, then capture again.`);
      return true;
    }
    if (message.type === 'captureQuality') { const [quality]=await chrome.scripting.executeScript({target:{tabId:message.tabId},func:pageQuality}); return quality.result; }
    if (message.type === 'capture') return capture(message.tabId);
    if (message.type === 'captureFullPage') return captureFullPage(message.tabId);
    if (message.type === 'highlight') {
      await chrome.scripting.executeScript({ target: { tabId: message.tabId }, func: showHighlight, args: [message.box, message.snapshot, message.label] });
      return true;
    }
    throw new Error('Unsupported action.');
  };
  run().then(data => sendResponse({ data })).catch(error => sendResponse({ error: error.message }));
  return true;
});

/* Local extension-owned preview window. Never attaches to the inspected tab. */
function createDevicePreviewManager(api,helpers){
 const records=new Map();let queue=Promise.resolve();
 const ready=api.storage.session.get('project1DevicePreviews').then(data=>{for(const [key,value] of Object.entries(data.project1DevicePreviews||{}))records.set(Number(key),value);});
 const save=()=>api.storage.session.set({project1DevicePreviews:Object.fromEntries(records)});
 const serial=operation=>{const result=queue.catch(()=>{}).then(()=>ready).then(operation);queue=result.catch(()=>{});return result;};
 function spec(value){
  if(!value||!Number.isInteger(value.width)||!Number.isInteger(value.height)||value.width<320||value.width>4096||value.height<320||value.height>4096||typeof value.presetId!=='string'||!/^[a-z0-9-]{1,80}$|^[0-9]{3,4}x[0-9]{3,4}$/.test(value.presetId)||!['portrait','landscape'].includes(value.orientation))throw Error('Invalid device preview settings.');
  return {width:value.width,height:value.height,presetId:value.presetId,orientation:value.orientation};
 }
 const web=url=>{const parsed=new URL(url);if(!/^https?:$/.test(parsed.protocol)||parsed.username||parsed.password)throw Error('Device preview requires an HTTP/HTTPS website without URL credentials.');return parsed.href;};
 async function target(original){const state=records.get(original);if(!state||!state.attached)throw Error(state?.error||'Open the device preview first.');const tab=await api.tabs.get(state.tabId);if(tab.windowId!==state.windowId)throw Error('Preview window changed. Close and reopen it.');web(tab.pendingUrl||tab.url||'');return state;}
 const command=(state,method,params={})=>api.debugger.sendCommand({tabId:state.tabId},method,params);
 async function bounds(state,config){
  const current=await api.windows.get(state.windowId);
  if(!state.workArea||current.width>state.workArea.width||current.height>state.workArea.height)state.workArea={left:current.left,top:current.top,width:current.width,height:current.height};
  const display=state.workArea;
  // Never grow beyond a rectangle Chrome has already placed on-screen. Device
  // viewport dimensions are independent of these physical browser-window bounds.
  return {left:display.left||0,top:display.top||0,width:Math.max(320,Math.min(config.width+40,display.width||500)),height:Math.max(240,Math.min(config.height+110,display.height||500))};
 }
 async function apply(original,value,checkSource=true){
  const config=spec(value),state=await target(original);
  if(checkSource&&web((await api.tabs.get(original)).url||'')!==state.sourceUrl)throw Error('The original tab navigated. Click Open device preview again to load its current URL.');
  const rectangle=await bounds(state,config);await api.windows.update(state.windowId,rectangle);
  await command(state,'Emulation.setDeviceMetricsOverride',{width:config.width,height:config.height,deviceScaleFactor:1,mobile:!String(config.presetId).includes("tv"),screenWidth:config.width,screenHeight:config.height,scale:Math.max(.1,Math.min(1,(rectangle.width-40)/config.width,(rectangle.height-110)/config.height)),screenOrientation:{type:config.orientation==='landscape'?'landscapePrimary':'portraitPrimary',angle:config.orientation==='landscape'?90:0}});
  await command(state,'Emulation.setTouchEmulationEnabled',{enabled:!String(value.presetId).includes("tv"),maxTouchPoints:5});state.settings=config;await save();return state;
 }
 async function info(original){
  const state=records.get(original);if(!state)return {active:false};
  try{const tab=await api.tabs.get(state.tabId);if(tab.windowId!==state.windowId)throw Error();if(state.attached){try{await command(state,'Page.getLayoutMetrics');}catch{state.attached=false;state.error='Device preview disconnected. Reopen it to explicitly reconnect.';await save();}}return {active:state.attached,tabId:state.tabId,windowId:state.windowId,url:tab.url,settings:state.settings,error:state.error};}
  catch{records.delete(original);await save();return {active:false};}
 }
 async function open(original,value){
  spec(value);if(!await api.permissions.contains({permissions:['debugger']}))throw Error('Device preview needs the debugger permission. Reload and re-enable the updated extension in Chrome.');
  const source=await api.tabs.get(original),url=web(source.url||'');let state=records.get(original),created=false;
  if(state){try{await api.tabs.get(state.tabId);}catch{records.delete(original);state=undefined;}}
  if(!state){const window=await api.windows.create({url:'about:blank',type:'popup',width:500,height:500,focused:true});const tab=window.tabs?.[0];if(!Number.isInteger(tab?.id))throw Error('Chrome did not create a preview tab.');state={tabId:tab.id,windowId:window.id,sourceUrl:url,attached:false,sessionId:crypto.randomUUID(),workArea:{left:window.left,top:window.top,width:window.width,height:window.height}};records.set(original,state);created=true;}
  try{
   if(!state.sessionId)state.sessionId=crypto.randomUUID();listen();if(!state.attached){await api.debugger.attach({tabId:state.tabId},'1.3');state.attached=true;state.error=undefined;}
   const previousUrl=state.sourceUrl;state.sourceUrl=url;
   // Apply metrics before navigating a newly created window; about:blank is owned by this manager.
   if(created){await command(state,'Emulation.setDeviceMetricsOverride',{width:value.width,height:value.height,deviceScaleFactor:1,mobile:!String(value.presetId).includes("tv"),screenWidth:value.width,screenHeight:value.height,screenOrientation:{type:value.orientation==='landscape'?'landscapePrimary':'portraitPrimary',angle:value.orientation==='landscape'?90:0}});await command(state,'Emulation.setTouchEmulationEnabled',{enabled:!String(value.presetId).includes("tv"),maxTouchPoints:5});}
   const current=await api.tabs.get(state.tabId);
   if(created||previousUrl!==url||!/^https?:/.test(current.url||''))await api.tabs.update(state.tabId,{url});
   state.settings=spec(value);await save();await apply(original,value,false);return {active:true,tabId:state.tabId,windowId:state.windowId,url,settings:state.settings};
  }catch(error){state.attached=false;state.error='Unable to attach the device preview. Close DevTools for the preview tab, then reopen preview.';await api.debugger.detach({tabId:state.tabId}).catch(()=>{});await save();throw error;}
 }
 async function capture(original,value,mode){
  if(!['viewport','full-page'].includes(mode))throw Error('Invalid preview capture mode.');
  const state=await apply(original,value);const targetId={tabId:state.tabId};
  // Bounded load wait; do not capture a half-navigated document.
  for(let count=0;count<40;count++){const tab=await api.tabs.get(state.tabId);if(tab.status==='complete')break;if(count===39)throw Error('Preview is still loading. Wait and capture again.');await new Promise(resolve=>setTimeout(resolve,250));}
  const [{result:quality}]=await api.scripting.executeScript({target:targetId,func:helpers.pageQuality});
  if(!quality?.ready)throw Error('Preview fonts/images/layout are still changing. Wait and capture again.');
  let prepared=false;
  try{
   if(mode==='full-page'){prepared=true;await api.scripting.executeScript({target:targetId,func:helpers.positionFullPage,args:['begin']});}
   const [{result:before}]=await api.scripting.executeScript({target:targetId,func:helpers.inspectViewport,args:[mode==='full-page']});
   web(before.url);if(before.viewportWidth!==value.width||before.viewportHeight!==value.height)throw Error(`Preview layout is ${before.viewportWidth} × ${before.viewportHeight}, expected ${value.width} × ${value.height}. Check the website's viewport meta tag and finish loading.`);
   if(before.width>12000||before.height>12000||before.width*before.height>24000000)throw Error('Preview capture exceeds the 12,000-pixel side or 24-megapixel limit.');
   const image=await command(state,'Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:true,clip:{x:mode==='full-page'?0:before.scrollX,y:mode==='full-page'?0:before.scrollY,width:before.width,height:before.height,scale:1}});
   if(typeof image?.data!=='string'||image.data.length>11_333_336)throw Error('Preview PNG exceeds the 8.5 MB limit. Use viewport capture or a smaller page.');
   const header=Uint8Array.from(atob(image.data.slice(0,44)),character=>character.charCodeAt(0));const dimensions=new DataView(header.buffer);
   if(dimensions.getUint32(16)!==before.width||dimensions.getUint32(20)!==before.height)throw Error('Preview screenshot dimensions do not match the selected viewport. Reopen preview and try again.');
   const [{result:after}]=await api.scripting.executeScript({target:targetId,func:helpers.inspectViewport,args:[mode==='full-page']});
   if(['url','width','height','viewportWidth','viewportHeight','scrollX','scrollY'].some(key=>before[key]!==after[key]))throw Error('Preview moved or changed during capture. Try again.');
   return {image:'data:image/png;base64,'+image.data,snapshot:{...before,quality,...(mode==='full-page'?{scrollX:0,scrollY:0}: {})},capturedAt:new Date().toISOString(),preview:{ownerTabId:original,tabId:state.tabId,sessionId:state.sessionId,...state.settings}};
  }finally{if(prepared)await api.scripting.executeScript({target:targetId,func:helpers.positionFullPage,args:['restore']}).catch(()=>{});}
 }
 async function close(original){const state=records.get(original);if(!state)return true;records.delete(original);await save();await api.debugger.detach({tabId:state.tabId}).catch(()=>{});await api.windows.remove(state.windowId);return true;}
 let listening=false;function listen(){if(listening||!api.debugger?.onDetach)return;listening=true;
  api.debugger.onDetach.addListener((source,reason)=>{void serial(async()=>{for(const state of records.values())if(state.tabId===source.tabId){state.attached=false;state.error='Device preview disconnected ('+reason+'). Reopen it to continue; do not open DevTools on the preview tab.';}await save();});});
 }listen();
 api.tabs.onRemoved.addListener(tabId=>{void serial(async()=>{for(const [original,state] of records){if(state.tabId===tabId)records.delete(original);else if(original===tabId){records.delete(original);await api.debugger.detach({tabId:state.tabId}).catch(()=>{});}}await save();});});
 return {focus:original=>serial(async()=>{const state=await target(original);await api.windows.update(state.windowId,{focused:true});return info(original);}),open:(original,value)=>serial(()=>open(original,value)),resize:(original,value)=>serial(async()=>{await apply(original,value);return info(original);}),status:original=>serial(()=>info(original)),capture:(original,value,mode)=>serial(()=>capture(original,value,mode)),close:original=>serial(()=>close(original)),highlight:(original,tabId,sessionId,snapshot,box,label)=>serial(async()=>{const state=await target(original);if(state.tabId!==tabId||state.sessionId!==sessionId)throw Error('This capture belongs to an older preview. Recapture to highlight live.');await api.scripting.executeScript({target:{tabId},func:helpers.showHighlight,args:[box,snapshot,label]});return true;})};
}
globalThis.createDevicePreviewManager=createDevicePreviewManager;

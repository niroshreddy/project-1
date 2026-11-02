import { alignedReference } from './browser-compare';
import {teamUrl,teamToken} from './team-api';
import type { Capture, Comparison, Design, ComparisonOptions } from './types';
export const API = 'http://127.0.0.1:8765';
export const analysisUrl=()=>teamToken()?teamUrl():API;
export async function message<T>(payload: object): Promise<T> {
  if (!globalThis.chrome?.devtools) throw new Error('Open this panel from the installed extension in Developer Tools.');
  const response = await chrome.runtime.sendMessage({ ...payload, tabId: chrome.devtools.inspectedWindow.tabId });
  if (response?.error) throw new Error(response.error);
  if (!response || !('data' in response)) throw new Error('No response from the extension. Reload the extension and reopen Developer Tools.');
  return response.data;
}
export async function capturePage(mode:'full-page'|'viewport'='full-page', target?:{width:number;height:number}): Promise<Capture> {
  if (!globalThis.chrome?.permissions) throw new Error('Install the extension and open its project-1 DevTools tab to capture a page.');
  // captureVisibleTab requires activeTab or <all_urls>. A DevTools click does not grant activeTab.
  const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
  if (!granted) throw new Error('Website access is needed for viewport capture. Click Capture again to grant access.');
  if(target){
    if(!Number.isInteger(target.width)||!Number.isInteger(target.height)||target.width<320||target.width>2560||target.height<320||target.height>2560)throw new Error('Choose viewport dimensions between 320 and 2560 CSS px.');
    await message({type:'validateViewport',...target});
  }
  const quality=await message<Capture['snapshot']['quality']>({type:'captureQuality'});
  if(quality&&quality.ready===false)throw new Error('Page is still loading or changing. Wait for fonts/images to settle, then capture again.');
  const captured=await message<Capture>({ type: mode==='full-page'?'captureFullPage':'capture' });
  if(target&&((captured.snapshot.viewportWidth??captured.snapshot.width)!==target.width||(captured.snapshot.viewportHeight??captured.snapshot.height)!==target.height))throw new Error('The viewport changed during capture. Set the target dimensions in Device Toolbar and capture again.');
  if(quality&&typeof quality.ready==='boolean')captured.snapshot.quality=quality;
  return captured;
}
export async function compare(design: Design, capture: Capture, signal: AbortSignal, options: ComparisonOptions): Promise<Comparison> {
  const prepared=await alignedReference(design,capture,options);
  const response = await fetch(`${analysisUrl()}/compare`, { method:'POST', headers:{'Content-Type':'application/json',...(teamToken()?{Authorization:`Bearer ${teamToken()}`}:{})},
    body: JSON.stringify({ design:prepared, actual:capture.image, snapshot:capture.snapshot, options:{tolerancePx:options.tolerancePx,normalization:options.normalization} }), signal });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'The comparison service rejected the request. Check image dimensions and restart the backend.');
  return { id:crypto.randomUUID(), createdAt:new Date().toISOString(), design:prepared===design.image?design:{...design,image:prepared,width:capture.snapshot.width,height:capture.snapshot.height}, sourceDesign:prepared===design.image?undefined:design, capture, ...data, options,
    issues:data.issues.map((issue: object, index: number) => ({ ...issue, id:`issue-${index+1}` })) };
}

export async function captureResponsive(widths:number[]):Promise<Capture[]> {
 const granted=await chrome.permissions.request({origins:['<all_urls>']});
 if(!granted)throw new Error('Website access is required for responsive captures.');
 return message<Capture[]>({type:'captureResponsive',widths});
}

export type PreviewSettings={width:number;height:number;presetId:string;orientation:'portrait'|'landscape'};
export type PreviewInfo={active:boolean;tabId?:number;windowId?:number;url?:string;settings?:PreviewSettings;error?:string};
export async function openDevicePreview(settings:PreviewSettings):Promise<PreviewInfo>{
 if(!globalThis.chrome?.permissions)throw Error('Open project-1 in the installed DevTools extension.');
 const granted=await chrome.permissions.request({origins:['<all_urls>']});
 if(!granted)throw Error('Automatic device preview was not enabled. Website access must be granted by you.');
 if(!await chrome.permissions.contains({permissions:['debugger']}))throw Error('Reload and re-enable the extension in chrome://extensions, approving its debugger permission.');
 return message<PreviewInfo>({type:'previewOpen',settings});
}
export const resizeDevicePreview=(settings:PreviewSettings)=>message<PreviewInfo>({type:'previewResize',settings});
export const captureDevicePreview=(settings:PreviewSettings,mode:'full-page'|'viewport')=>message<Capture>({type:'previewCapture',settings,mode});

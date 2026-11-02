import {mobileScope,mobileDimensions,mobilePreset,isIpadPreset,type MobileSelection,type Orientation} from './device-presets';
import React,{createContext,useContext,useEffect,useRef,useState} from 'react';
import {loadWorkspace,saveWorkspace,type WorkspaceSnapshot} from './workspace-storage';
export type DeviceMode='desktop'|'mobile';
type DraftContext={snapshot:WorkspaceSnapshot;update:React.Dispatch<React.SetStateAction<WorkspaceSnapshot>>;saving:boolean;error:string;retry:()=>void};
const Context=createContext<DraftContext|null>(null);
function useDraft(){const value=useContext(Context);if(!value)throw Error('Workspace provider is missing.');return value;}
export function WorkspaceProvider({children}:{children:React.ReactNode}){
 const [snapshot,update]=useState<WorkspaceSnapshot>(),[loadingError,setLoadingError]=useState(''),[saveError,setSaveError]=useState(''),[saving,setSaving]=useState(false),[retry,setRetry]=useState(0);
 const queue=useRef(Promise.resolve()),sequence=useRef(0);
 async function load(){try{setLoadingError('');update(await loadWorkspace());}catch{setLoadingError('Saved Desktop/Mobile workspaces could not be opened. Retry before editing so existing data is not overwritten.');}}
 useEffect(()=>{void load();},[]);
 useEffect(()=>{if(!snapshot)return;const revision=++sequence.current;let active=true;setSaving(true);queue.current=queue.current.catch(()=>{}).then(()=>saveWorkspace(snapshot)).then(()=>{if(active&&revision===sequence.current){setSaving(false);setSaveError('');}},()=>{if(active&&revision===sequence.current){setSaving(false);setSaveError('Workspace autosave failed. Keep this panel open and retry; new changes are not yet saved. Browser storage may be full.');}});return()=>{active=false;};},[snapshot,retry]);
 if(!snapshot)return <section className="card" style={{padding:20,margin:20}}><p role={loadingError?'alert':'status'}>{loadingError||'Restoring Desktop and Mobile workspaces…'}</p>{loadingError&&<button onClick={load}>Retry workspace restore</button>}</section>;
 return <Context.Provider value={{snapshot,update:next=>update(previous=>previous?(typeof next==='function'?next(previous):next):previous),saving,error:saveError,retry:()=>setRetry(value=>value+1)}}>{saveError&&<div role="alert" className="notice error">{saveError}<button onClick={()=>setRetry(value=>value+1)}>Retry workspace save</button></div>}{children}</Context.Provider>;
}
export function WorkspaceSaveStatus(){const {saving,error}=useDraft();return <small className="workspace-save-status" role="status">{error?'Workspace not saved':saving?'Saving workspaces locally…':'Workspaces saved in this browser'}</small>;}
export function useDeviceMode():[DeviceMode,(mode:DeviceMode)=>void]{const {snapshot,update}=useDraft();return [snapshot.mode,mode=>update(previous=>({...previous,mode}))];}
export function useMobileWorkspace(){
 const {snapshot,update}=useDraft();
 const select=(presetId:string,orientation:Orientation=snapshot.mobile.orientation)=>update(previous=>{
  if(!mobilePreset(presetId))return previous;
  const selection={presetId,orientation},scope=mobileScope(selection);let values=previous.values;
  if(presetId.startsWith('custom')&&previous.mobile.presetId===presetId&&!Object.hasOwn(values.targetWidth??{},scope)){
   const old=mobileScope(previous.mobile),fallback=mobileDimensions(previous.mobile),width=Number(values.targetWidth?.[old]??fallback.width),height=Number(values.targetHeight?.[old]??fallback.height);
   values={...values,targetWidth:{...values.targetWidth,[scope]:orientation==='landscape'?Math.max(width,height):Math.min(width,height)},targetHeight:{...values.targetHeight,[scope]:orientation==='landscape'?Math.min(width,height):Math.max(width,height)}};
  }
  return {...previous,mobile:selection,values,[isIpadPreset(presetId)?'lastIpad':'lastPhone']:selection};
 });
 const custom=(width:number,height:number)=>update(previous=>{
  const orientation=width>=320&&height>=320?(width>height?'landscape':'portrait'):previous.mobile.orientation;
  const selection:MobileSelection={presetId:isIpadPreset(previous.mobile.presetId)?'custom-ipad':'custom',orientation},scope=mobileScope(selection);
  return {...previous,mobile:selection,[isIpadPreset(selection.presetId)?'lastIpad':'lastPhone']:selection,values:{...previous.values,targetWidth:{...previous.values.targetWidth,[scope]:width},targetHeight:{...previous.values.targetHeight,[scope]:height}}};
 });
 const clearComparison=(id:string)=>update(previous=>{
  const values={...previous.values,record:{...previous.values.record},selected:{...previous.values.selected},baselineId:{...previous.values.baselineId}};
  for(const [scope,record] of Object.entries(values.record)){if((record as {id?:string}|undefined)?.id===id){values.record[scope]=undefined;values.selected[scope]=undefined;}}
  for(const [scope,baseline] of Object.entries(values.baselineId))if(baseline===id)values.baselineId[scope]='';
  return {...previous,values};
 });
 const chooseCategory=(category:'phone'|'ipad')=>update(previous=>{
  const key=category==='ipad'?'lastIpad':'lastPhone';
  const currentMatches=isIpadPreset(previous.mobile.presetId)===(category==='ipad');
  const remembered=currentMatches?previous.mobile:previous[key];
  const selection=remembered&&mobilePreset(remembered.presetId)&&isIpadPreset(remembered.presetId)===(category==='ipad')?remembered:{presetId:category==='ipad'?'ipad-mini':'390x844',orientation:'portrait' as const};
  return {...previous,mode:'mobile',mobile:selection,[key]:selection};
 });
 return {selection:snapshot.mobile,select,custom,clearComparison,chooseCategory};
}
// Async operations retain the exact device/orientation scope that initiated them.
export function useDeviceState<T>(mode:DeviceMode,key:string,desktop:T,mobile:T=desktop):[T,(value:T|((previous:T)=>T),target?:string)=>void]{
 const {snapshot,update}=useDraft();const scope=mode==='mobile'?mobileScope(snapshot.mobile):'desktop';
 const fallback=(target:string)=>{
  if(target==='desktop')return desktop;
  const parts=target.split(':');const dimensions=mobileDimensions({presetId:parts[1],orientation:parts[2] as Orientation});
  if(key==='targetWidth')return dimensions.width as T;if(key==='targetHeight')return dimensions.height as T;
  return mobile;
 };
 const value=Object.hasOwn(snapshot.values[key]??{},scope)?snapshot.values[key][scope] as T:fallback(scope);
 const set=(next:T|((previous:T)=>T),target:string=scope)=>update(previous=>{
  const resolved=target==='mobile'?mobileScope(snapshot.mobile):target,pair=previous.values[key]??{};
  const old=Object.hasOwn(pair,resolved)?pair[resolved] as T:fallback(resolved);
  return {...previous,values:{...previous.values,[key]:{...pair,[resolved]:typeof next==='function'?(next as (value:T)=>T)(old):next}}};
 });
 return [value,set];
}

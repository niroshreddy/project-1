import {mobileScope,mobilePreset,type MobileSelection} from './device-presets';
export type WorkspaceSnapshot={version:2;mode:'desktop'|'mobile';mobile:MobileSelection;values:Record<string,Record<string,unknown>>};
export const initialWorkspace=():WorkspaceSnapshot=>({version:2,mode:'desktop',mobile:{presetId:'390x844',orientation:'portrait'},values:{}});
export function migrateWorkspace(data:unknown):WorkspaceSnapshot{
 if(data===undefined)return initialWorkspace();
 const old=data as {version?:number;mode?:string;mobile?:MobileSelection;values?:Record<string,Record<string,unknown>>};
 if(!['desktop','mobile'].includes(old?.mode??'')||!old.values||typeof old.values!=='object'||Array.isArray(old.values))throw Error('Invalid saved workspace.');
 if(old.version===2){if(!old.mobile||!mobilePreset(old.mobile.presetId)||!['portrait','landscape'].includes(old.mobile.orientation))throw Error('Unknown mobile workspace.');return old as WorkspaceSnapshot;}
 if(old.version!==1)throw Error('Unsupported workspace version.');
 const preset=String(old.values.devicePreset?.mobile??'390x844');
 const mobile:MobileSelection={presetId:mobilePreset(preset)?preset:'custom',orientation:Number(old.values.targetWidth?.mobile??390)>Number(old.values.targetHeight?.mobile??844)?'landscape':'portrait'};
 const scope=mobileScope(mobile),values:WorkspaceSnapshot['values']={};
 for(const [key,pair] of Object.entries(old.values)){values[key]={};if(Object.hasOwn(pair,'desktop'))values[key].desktop=pair.desktop;if(Object.hasOwn(pair,'mobile'))values[key][scope]=pair.mobile;}
 return {version:2,mode:old.mode as WorkspaceSnapshot['mode'],mobile,values};
}
async function database():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open('project-1-workspaces',1);request.onupgradeneeded=()=>request.result.createObjectStore('drafts');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Workspace storage is blocked by another panel.'));});}
async function transaction<T>(mode:IDBTransactionMode,operation:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('drafts',mode);let request:IDBRequest<T>;try{request=operation(tx.objectStore('drafts'));}catch(error){db.close();reject(error);return;}tx.oncomplete=()=>{db.close();resolve(request.result);};tx.onerror=tx.onabort=()=>{db.close();reject(tx.error??new Error('Workspace storage failed.'));};});}
export async function loadWorkspace():Promise<WorkspaceSnapshot>{return migrateWorkspace(await transaction('readonly',store=>store.get('current')));}
export async function saveWorkspace(snapshot:WorkspaceSnapshot){await transaction('readwrite',store=>store.put(snapshot,'current'));}

import type { Comparison } from './types';
export function teamUrl(){return sessionStorage.getItem('team-url')??'';}
export function teamToken(){return sessionStorage.getItem('team-token')??'';}
export async function configureTeam(url:string){
 const parsed=new URL(url);
 if(parsed.protocol!=='https:'&&!(['localhost','127.0.0.1'].includes(parsed.hostname)&&parsed.protocol==='http:'))throw new Error('Hosted workspaces require HTTPS. HTTP is allowed only on localhost.');
 if(parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/')throw new Error('Use the workspace origin only, e.g. https://reviews.example.com.');
 if(globalThis.chrome?.permissions){const granted=await chrome.permissions.request({origins:[parsed.origin+'/*']});if(!granted)throw new Error('Workspace access was not granted.');}
 sessionStorage.setItem('team-url',parsed.origin);sessionStorage.removeItem('team-token');
}
export async function teamRequest(path:string,body?:unknown,method?:string) {
 const response=await fetch(teamUrl()+path,{method:method??(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(teamToken()?{Authorization:`Bearer ${teamToken()}`}:{})},body:body?JSON.stringify(body):undefined});
 let data;try{data=await response.json();}catch{throw new Error(response.status===413?'Issue evidence exceeds the server size limit. Use smaller screenshots.':`Workspace returned an unreadable response (${response.status}).`);}
 if(response.status===401)sessionStorage.removeItem('team-token');
 if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:`Workspace request failed (${response.status}).`);return data;
}
export type SharedRecord={payload:Comparison;revision:number};

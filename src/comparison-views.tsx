import { TrashIcon } from './trash-icon';
import React, { useEffect, useRef, useState } from 'react';
import type { Box, Comparison } from './types';
import { imageFrom } from './images';

export function IgnoreEditor({image,regions,onChange,disabled=false}:{image:string;regions:Box[];onChange:(regions:Box[])=>void;disabled?:boolean}) {
  const [drawing,setDrawing]=useState(false);
  const [draft,setDraft]=useState<Box>();
  const start=useRef<{x:number;y:number}|undefined>(undefined);
  const point=(event:React.PointerEvent<HTMLDivElement>)=>{
    const bounds=event.currentTarget.getBoundingClientRect();
    return {x:Math.max(0,Math.min(1,(event.clientX-bounds.left)/bounds.width)),y:Math.max(0,Math.min(1,(event.clientY-bounds.top)/bounds.height))};
  };
  return <section className="ignore-editor card"><div className="ignore-toolbar"><strong>Ignore regions ({regions.length}/20)</strong><button disabled={disabled||regions.length>=20} aria-pressed={drawing} onClick={()=>setDrawing(!drawing)}>{drawing?'Done selecting':'Draw ignore regions'}</button><button className="remove-region" disabled={disabled||!regions.length} onClick={()=>onChange([])}><TrashIcon/> Clear regions</button></div><p>Draw rectangles over changing content. These areas are excluded at the same relative position in both images. Recapture or replace the reference clears the regions.</p>
    <div className="ignore-scroll"><div className={`ignore-surface ${drawing?'drawing':''}`} onPointerDown={event=>{if(!drawing||disabled||regions.length>=20)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);start.current=point(event);}} onPointerMove={event=>{if(!start.current)return;const end=point(event),begin=start.current;setDraft({x:Math.min(begin.x,end.x),y:Math.min(begin.y,end.y),width:Math.abs(end.x-begin.x),height:Math.abs(end.y-begin.y)});}} onPointerUp={event=>{if(!start.current)return;const end=point(event),begin=start.current;const box={x:Math.min(begin.x,end.x),y:Math.min(begin.y,end.y),width:Math.abs(end.x-begin.x),height:Math.abs(end.y-begin.y)};if(box.width>.002&&box.height>.002)onChange([...regions,box]);start.current=undefined;setDraft(undefined);}} onPointerCancel={()=>{start.current=undefined;setDraft(undefined);}}>
      <img src={image} alt="Capture for selecting ignored regions" draggable={false}/>{[...regions,...(draft?[draft]:[])].map((box,index)=><div className="ignore-box" key={index} style={{left:`${box.x*100}%`,top:`${box.y*100}%`,width:`${box.width*100}%`,height:`${box.height*100}%`}}><span>{index+1}</span></div>)}
    </div></div>{regions.length>0&&<div className="ignore-list">{regions.map((_,index)=><button className="remove-region" key={index} disabled={disabled} onClick={()=>onChange(regions.filter((_,i)=>i!==index))}><TrashIcon/> Remove region {index+1}</button>)}</div>}
  </section>;
}

export function VisualModes({record,mode}:{record:Comparison;mode:'overlay'|'difference'}) {
  const [opacity,setOpacity]=useState(50);
  const [error,setError]=useState('');
  const canvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    let cancelled=false;setError('');
    Promise.all([imageFrom(record.design.image),imageFrom(record.capture.image)]).then(([reference,actual])=>{
      if(cancelled||!canvas.current)return;
      const target=canvas.current;
      // Limit preview memory; comparison and exports keep their original resolution.
      const factor=Math.min(1,1600/actual.width,Math.sqrt(4000000/(actual.width*actual.height)));
      target.width=Math.max(1,Math.round(actual.width*factor));target.height=Math.max(1,Math.round(actual.height*factor));
      const ctx=target.getContext('2d')!;ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;
      ctx.drawImage(actual,0,0,target.width,target.height);
      if(mode==='difference')ctx.globalCompositeOperation='difference';else ctx.globalAlpha=opacity/100;
      ctx.drawImage(reference,0,0,target.width,target.height);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
      for(const box of record.options?.ignoreRegions??[]){ctx.fillStyle='#507f8c';ctx.fillRect(box.x*target.width,box.y*target.height,box.width*target.width,box.height*target.height);}
    }).catch(()=>{if(!cancelled)setError('Unable to render the comparison preview.');});
    return()=>{cancelled=true;};
  },[record,mode,opacity]);
  return <section className="visual-modes card"><div className="visual-mode-toolbar">{mode==='overlay'&&<label>Reference opacity {opacity}% <input aria-label="Reference opacity" type="range" min="0" max="100" value={opacity} onChange={event=>setOpacity(Number(event.target.value))}/></label>}</div><p>{mode==='difference'?'Raw pixel difference: black means identical; brighter colors show changes. This view includes rendering noise and does not apply the analysis tolerance.':'Reference blended over the live capture. Adjust opacity to inspect alignment.'} Images are normalized to the capture proportions. Teal blocks mark ignored regions.</p>{error&&<p role="alert">{error}</p>}<div className="blend-scroll" tabIndex={0} aria-label="Blended comparison preview"><canvas ref={canvas}/></div></section>;
}

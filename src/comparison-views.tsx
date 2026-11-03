import {PhonePreview,type usePhoneScrollSync} from './mobile-preview';
import {alignedReference} from './browser-compare';
import React, { useEffect, useRef, useState } from 'react';
import type { Comparison } from './types';
import { imageFrom } from './images';

export function VisualModes({record,mode,align=false,phone}:{record:Comparison;mode:'overlay'|'difference';align?:boolean;phone?:{presetId?:string;tv?:boolean;width:number;height:number;zoom:string;controller:ReturnType<typeof usePhoneScrollSync>}}) {
  const [opacity,setOpacity]=useState(50);
  const [error,setError]=useState('');
  const canvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    let cancelled=false;setError('');
    Promise.all([(align?alignedReference(record.design,record.capture,record.options??{tolerancePx:8,normalization:'fit'}).then(imageFrom):imageFrom(record.design.image)),imageFrom(record.capture.image)]).then(([reference,actual])=>{
      if(cancelled||!canvas.current)return;
      const target=canvas.current;
      // Limit preview memory; comparison and exports keep their original resolution.
      const factor=Math.min(1,1600/actual.width,Math.sqrt(4000000/(actual.width*actual.height)));
      target.width=Math.max(1,Math.round(actual.width*factor));target.height=Math.max(1,Math.round(actual.height*factor));
      const ctx=target.getContext('2d')!;ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;
      ctx.drawImage(actual,0,0,target.width,target.height);
      if(mode==='difference')ctx.globalCompositeOperation='difference';else ctx.globalAlpha=opacity/100;
      ctx.drawImage(reference,0,0,target.width,target.height);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';phone?.controller.align();
    }).catch(()=>{if(!cancelled)setError('Unable to render the comparison preview.');});
    return()=>{cancelled=true;};
  },[record,mode,opacity,align]);
  return <section className="visual-modes card"><div className="visual-mode-toolbar">{mode==='overlay'&&<label>Reference opacity {opacity}% <input aria-label="Reference opacity" type="range" min="0" max="100" value={opacity} onChange={event=>setOpacity(Number(event.target.value))}/></label>}</div><p>{mode==='difference'?'Raw pixel difference: black means identical; brighter colors show changes. This view includes rendering noise and does not apply the analysis tolerance.':'Reference blended over the live capture. Adjust opacity to inspect alignment.'} Images are normalized to the capture proportions.</p>{error&&<p role="alert">{error}</p>}{phone?<PhonePreview side={1} empty="Comparison" label={mode==='overlay'?'Mobile overlay screen':'Mobile difference screen'} {...phone}><canvas ref={canvas}/></PhonePreview>:(<div className="blend-scroll" tabIndex={0} aria-label="Blended comparison preview"><canvas ref={canvas}/></div>)}</section>;
}

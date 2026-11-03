import React,{useLayoutEffect,useRef} from 'react';
import './mobile-preview.css';
import {deviceMockup} from './device-mockups';
import {deviceFrameStyle,mobilePreset} from './device-presets';
export function usePhoneScrollSync(enabled:boolean,zoom:string,width:number,height:number,viewKey=''){
 const screens=useRef<[HTMLDivElement|null,HTMLDivElement|null]>([null,null]);
 const progress=useRef({x:0,y:0});
 const expected=useRef(new WeakMap<HTMLElement,{left:number;top:number}>());
 const apply=(element:HTMLDivElement)=>{const left=progress.current.x*Math.max(0,element.scrollWidth-element.clientWidth),top=progress.current.y*Math.max(0,element.scrollHeight-element.clientHeight);expected.current.set(element,{left,top});element.scrollLeft=left;element.scrollTop=top;};
 const align=()=>{if(enabled)screens.current.forEach(element=>{if(element)apply(element);});};
 const scroll=(index:0|1)=>{const source=screens.current[index];if(!source||!enabled)return;const planned=expected.current.get(source);expected.current.delete(source);if(planned&&Math.abs(source.scrollTop-planned.top)<1&&Math.abs(source.scrollLeft-planned.left)<1)return;
  const rangeX=source.scrollWidth-source.clientWidth,rangeY=source.scrollHeight-source.clientHeight;
  if(rangeX>0)progress.current.x=source.scrollLeft/rangeX;if(rangeY>0)progress.current.y=source.scrollTop/rangeY;
  const other=screens.current[index===0?1:0];if(other)apply(other);
 };
 useLayoutEffect(()=>{align();const observer=new ResizeObserver(align);screens.current.forEach(element=>{if(element)observer.observe(element);});return()=>observer.disconnect();},[enabled,zoom,width,height,viewKey]);
 return {screens,scroll,align};
}
export function PhonePreview({side,source,empty,width,height,zoom,controller,children,label,tv,presetId}:{side:0|1;source?:string;empty:string;width:number;height:number;zoom:string;controller:ReturnType<typeof usePhoneScrollSync>;children?:React.ReactNode;label?:string;tv?:boolean;presetId?:string}){
 const safeWidth=Number.isFinite(width)&&width>=320?width:390,safeHeight=Number.isFinite(height)&&height>=320?height:844;
 const shell=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{const element=shell.current;if(!element)return;const update=()=>{const width=element.getBoundingClientRect().width;const shortEdge=width/(safeWidth>safeHeight?safeWidth/safeHeight:1);element.style.setProperty('--shell-unit',`${shortEdge/100}px`);};update();const observer=new ResizeObserver(update);observer.observe(element);return()=>observer.disconnect();},[safeWidth,safeHeight]);
 const frame=deviceFrameStyle(presetId??''),deviceName=mobilePreset(presetId??'')?.name;
 const mockup=tv?undefined:deviceMockup(presetId??'custom',safeWidth>safeHeight?'landscape':'portrait');
 const mockupStyle:Record<string,string>=mockup?{'--mockup-ratio':`${mockup.width} / ${mockup.height}`,'--screen-left':`${mockup.x/mockup.width*100}%`,'--screen-top':`${mockup.y/mockup.height*100}%`,'--screen-width':`${mockup.screenWidth/mockup.width*100}%`,'--screen-height':`${mockup.screenHeight/mockup.height*100}%`}:{};
 const brand=frame==='tv-samsung'?'SAMSUNG':frame==='tv-lg'?'LG':frame==='tv-sony'?'SONY':'';
 return <div className={`phone-stage ${!source&&!children?'empty-device':''}`}><div ref={shell} data-device-preset={presetId} data-frame-style={frame} data-mockup-file={mockup?.file} title={deviceName?`${deviceName} · ${mockup?mockup.related?`Related artwork: ${mockup.name}`:`${mockup.name} PNG mockup`:'illustrative device frame'}`:undefined} className={`phone-frame ${mockup?'image-device':''} device-${frame} ${tv?'tv-frame':''} ${Math.min(safeWidth,safeHeight)>=600?'tablet-frame':''} ${safeWidth>safeHeight?'landscape-frame':''}`} style={{'--phone-ratio':safeWidth/safeHeight,...mockupStyle} as React.CSSProperties}>
  {!tv&&!mockup&&<span className="device-side-buttons" aria-hidden="true"><i/><i/><i/></span>}
  {!mockup&&<div className="phone-bezel" aria-hidden="true"><span/></div>}
  <div className="phone-screen" aria-label={label??(side===0?'Mobile reference screen':'Mobile capture screen')} tabIndex={0} ref={element=>{controller.screens.current[side]=element;}} onScroll={()=>controller.scroll(side)} style={{aspectRatio:`${safeWidth} / ${safeHeight}`}}>
   {children?<div className="phone-content" style={{width:zoom==='fit'?'100%':safeWidth*Number(zoom)/100}}>{children}</div>:source?<img draggable={false} src={source} alt={side===0?'Uploaded reference design':'Captured mobile page'} onLoad={controller.align} style={{width:zoom==='fit'?'100%':safeWidth*Number(zoom)/100,maxWidth:'none'}}/>:<div className="phone-empty"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m3 17 5-5 4 4 4-6 5 7"/></svg><strong>{empty}</strong></div>}
  </div>{!mockup&&<div className="phone-home" aria-hidden="true"><span/></div>}
  {mockup&&<img className="device-mockup-image" src={mockup.url} alt="" aria-hidden="true" draggable={false}/>}
  {tv&&<><span className="tv-brand" aria-hidden="true">{brand}</span><span className="tv-stand" aria-hidden="true"><i/><i/></span></>}
 </div>{mockup?.related&&<small className="mockup-caption">Related device artwork: {mockup.name}</small>}</div>;
}

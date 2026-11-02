import type {Comparison,ComparisonOptions,Design,Capture,Issue} from './types';
import {imageFrom} from './images';
export async function alignedReference(design:Design,capture:Capture,options:ComparisonOptions):Promise<string>{
 const alignment=options.alignment;
 if(!alignment||(alignment.x===0&&alignment.y===0&&alignment.scale===1))return design.image;
 if(options.normalization==='strict'&&(design.width!==capture.snapshot.width||design.height!==capture.snapshot.height))throw new Error('Exact pixels requires matching reference and capture dimensions.');
 const image=await imageFrom(design.image),canvas=document.createElement('canvas');
 canvas.width=capture.snapshot.width;canvas.height=capture.snapshot.height;
 const ctx=canvas.getContext('2d')!;ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.drawImage(image,alignment.x,alignment.y,canvas.width*alignment.scale,canvas.height*alignment.scale);
 return canvas.toDataURL('image/png');
}
export async function basicCompare(design:Design,capture:Capture,options:ComparisonOptions,signal:AbortSignal):Promise<Comparison>{
 const prepared=await alignedReference(design,capture,options);
 if(options.normalization==='strict'&&(design.width!==capture.snapshot.width||design.height!==capture.snapshot.height))throw new Error('Exact pixels requires matching dimensions.');
 if(Math.abs((design.width/design.height)/(capture.snapshot.width/capture.snapshot.height)-1)>.1)throw new Error('Reference and capture proportions differ by over 10%. Match capture mode and dimensions.');
 const [reference,actual]=await Promise.all([imageFrom(prepared),imageFrom(capture.image)]);
 const factor=Math.min(1,640/actual.width,Math.sqrt(500000/(actual.width*actual.height)));
 const width=Math.max(1,Math.round(actual.width*factor)),height=Math.max(1,Math.round(actual.height*factor));
 const pixels=(image:HTMLImageElement)=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);ctx.filter='blur(0.6px)';ctx.drawImage(image,0,0,width,height);return ctx.getImageData(0,0,width,height).data;};
 const a=pixels(reference),b=pixels(actual),radius=Math.min(8,Math.round(options.tolerancePx*width/capture.snapshot.width));
 const identical=a.length===b.length&&a.every((value,index)=>value===b[index]);
 const mask=new Uint8Array(width*height);
 function residual(source:Uint8ClampedArray,target:Uint8ClampedArray,x:number,y:number){
   const offset=(y*width+x)*4;
   for(let channel=0;channel<3;channel++){
     let min=255,max=0;
     for(let yy=Math.max(0,y-radius);yy<=Math.min(height-1,y+radius);yy++)for(let xx=Math.max(0,x-radius);xx<=Math.min(width-1,x+radius);xx++){
       const value=target[(yy*width+xx)*4+channel];min=Math.min(min,value);max=Math.max(max,value);
     }
     if(source[offset+channel]<min-35||source[offset+channel]>max+35)return true;
   }
   return false;
 }
 let changed=0;
 for(let y=radius;!identical&&y<height-radius;y++){
   if(y%32===0){await new Promise(resolve=>setTimeout(resolve,0));if(signal.aborted)throw new Error('Comparison cancelled.');}
   for(let x=radius;x<width-radius;x++)if(residual(a,b,x,y)||residual(b,a,x,y)){mask[y*width+x]=1;changed++;}
 }
 // Group connected changes into reviewable regions. Never invent OCR or CSS measurements.
 const visited=new Uint8Array(mask.length),regions:Comparison['diff']['regions']=[];
 for(let start=0;start<mask.length;start++){
   if(!mask[start]||visited[start])continue;
   const queue=[start];visited[start]=1;let count=0,minX=width,minY=height,maxX=0,maxY=0;
   for(let head=0;head<queue.length;head++){
     const index=queue[head],x=index%width,y=Math.floor(index/width);count++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
     for(const [xx,yy] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){if(xx<0||xx>=width||yy<0||yy>=height)continue;const next=yy*width+xx;if(mask[next]&&!visited[next]){visited[next]=1;queue.push(next);}}
   }
   if(count>=12)regions.push({x:minX/width,y:minY/height,width:(maxX-minX+1)/width,height:(maxY-minY+1)/height});
 }
 regions.sort((x,y)=>y.width*y.height-x.width*x.height);
 const issues:Issue[]=regions.slice(0,40).map((box,index)=>({id:`issue-${index+1}`,title:'Visible appearance difference',category:'style',severity:'low',confidence:.6,basis:'measured',annotation:'rectangle',box,expected:'Reference pixels in this area.',actual:'Captured pixels differ after scale and noise tolerance.',explanation:'Browser-only raster comparison; this does not identify the underlying CSS or semantic cause.',recommendation:'Review this area in Overlay or Difference and decide whether the change is intentional.'}));
 return {id:crypto.randomUUID(),createdAt:new Date().toISOString(),design:prepared===design.image?design:{...design,image:prepared,width:capture.snapshot.width,height:capture.snapshot.height},sourceDesign:prepared===design.image?undefined:design,capture,options,model:'browser-raster-v1',summary:issues.length?`${issues.length} raster regions need visual review. Browser mode has no OCR or DOM inference. Results are downsampled; small defects can be missed.`:'No raster regions exceeded tolerance. This does not guarantee design compliance.',diff:{changedPercent:Math.round(changed/mask.length*10000)/100,regions:regions.slice(0,60)},issues};
}

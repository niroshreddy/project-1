export type Orientation='portrait'|'landscape';
export type MobileSelection={presetId:string;orientation:Orientation};
export type MobilePreset={id:string;name:string;group:string;width:number;height:number};
// CSS viewport sizes, not physical pixels or automatic browser emulation.
// Named sizes checked against ChromeDevTools EmulatedDevices.ts, 2026-11-01.
export const MOBILE_PRESETS:MobilePreset[]=[
 {id:'iphone-12-pro',name:'iPhone 12 Pro',group:'iPhone',width:390,height:844},
 {id:'iphone-14-pro',name:'iPhone 14 Pro',group:'iPhone',width:393,height:852},
 {id:'iphone-14-pro-max',name:'iPhone 14 Pro Max',group:'iPhone',width:430,height:932},
 {id:'iphone-15',name:'iPhone 15',group:'iPhone',width:393,height:852},
 {id:'iphone-15-pro',name:'iPhone 15 Pro',group:'iPhone',width:393,height:852},
 {id:'iphone-15-pro-max',name:'iPhone 15 Pro Max',group:'iPhone',width:430,height:932},
 {id:'iphone-16e',name:'iPhone 16e',group:'iPhone',width:390,height:844},
 {id:'iphone-16',name:'iPhone 16',group:'iPhone',width:393,height:852},
 {id:'iphone-16-pro',name:'iPhone 16 Pro',group:'iPhone',width:402,height:874},
 {id:'iphone-16-pro-max',name:'iPhone 16 Pro Max',group:'iPhone',width:440,height:956},
 {id:'ipad-mini',name:'iPad Mini (DevTools preset)',group:'iPad',width:768,height:1024},
 {id:'ipad-pro-13',name:'iPad Pro 13',group:'iPad',width:1032,height:1376},
 {id:'pixel-7',name:'Google Pixel 7',group:'Android',width:412,height:915},
 {id:'pixel-8',name:'Google Pixel 8',group:'Android',width:412,height:915},
 {id:'pixel-9',name:'Google Pixel 9',group:'Android',width:412,height:924},
 {id:'pixel-9-pro',name:'Google Pixel 9 Pro',group:'Android',width:427,height:952},
 {id:'galaxy-s20-ultra',name:'Samsung Galaxy S20 Ultra',group:'Android',width:412,height:915},
 ...([['360x800','Small phone',360,800],['390x844','Phone',390,844],['412x915','Large phone',412,915],['768x1024','iPad viewport',768,1024],['820x1180','iPad viewport',820,1180],['834x1194','iPad viewport',834,1194],['1024x1366','iPad viewport',1024,1366]] as const).map(([id,name,width,height])=>({id,name,width,height,group:'Generic / existing'})),
 {id:'custom-ipad',name:'Custom iPad dimensions',group:'Custom',width:820,height:1180},
 {id:'custom',name:'Custom dimensions',group:'Custom',width:390,height:844}
];
export function mobilePreset(id:string){return MOBILE_PRESETS.find(p=>p.id===id);}
export function mobileScope(selection:MobileSelection){return `mobile:${selection.presetId}:${selection.orientation}`;}
export function mobileDimensions(selection:MobileSelection){const p=mobilePreset(selection.presetId)??mobilePreset('custom')!;return selection.orientation==='landscape'?{width:p.height,height:p.width}:{width:p.width,height:p.height};}

export function isIpadPreset(id:string){const preset=mobilePreset(id);return !!preset&&(preset.group==='iPad'||Math.min(preset.width,preset.height)>=600);}

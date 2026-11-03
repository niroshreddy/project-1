import assets from './device-mockup-assets.json';
import {isIpadPreset,isTvPreset,type Orientation} from './device-presets';
const mapping:Record<string,string>={
 'iphone-12-pro':'apple-iphone13pro-graphite',
 'iphone-14-pro':'apple-iphone14pro-spaceblack','iphone-14-pro-max':'apple-iphone14promax-spaceblack',
 'iphone-15':'apple-iphone-15-black','iphone-15-pro':'apple-iphone-15-pro-natural-titanium','iphone-15-pro-max':'apple-iphone-15-pro-max-natural-titanium',
 'iphone-16e':'apple-iphone13pro-graphite','iphone-16':'apple-iphone-15-black','iphone-16-pro':'apple-iphone-15-pro-natural-titanium','iphone-16-pro-max':'apple-iphone-15-pro-max-natural-titanium',
 'pixel-7':'google-pixel-7-obsidian','pixel-8':'google-pixel-8-obsidian','pixel-9':'google-pixel-8-obsidian','pixel-9-pro':'google-pixel-8-obsidian',
 'galaxy-s20-ultra':'samsung-galaxys20ultra-cosmicgrey','ipad-mini':'apple-ipadmini-starlight','ipad-pro-13':'apple-ipadpro13-spacegrey'
};
const exact=new Set(['iphone-14-pro','iphone-14-pro-max','iphone-15','iphone-15-pro','iphone-15-pro-max','pixel-7','pixel-8','galaxy-s20-ultra','ipad-pro-13']);
type Asset={file:string;width:number;height:number;x:number;y:number;screenWidth:number;screenHeight:number;name:string};
export function deviceMockup(presetId:string,orientation:Orientation){
 if(isTvPreset(presetId))return undefined;
 const key=mapping[presetId]??(isIpadPreset(presetId)?'apple-ipadair5-spacegrey':'apple-iphone-15-black');
 const asset=(assets as Record<string,Record<Orientation,Asset>>)[key][orientation];
 return {...asset,url:`./device-mockups/${asset.file}`,related:!exact.has(presetId)};
}

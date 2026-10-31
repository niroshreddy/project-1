import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTheme } from '../src/theme';

test('DevTools theme takes precedence over the operating system and updates live',()=>{
  const root={dataset:{theme:''},style:{colorScheme:''}} as unknown as HTMLElement;
  let handler:((theme:string)=>void)|undefined;
  const media={matches:false,addEventListener(){},removeEventListener(){}} as unknown as MediaQueryList;
  const stop=initializeTheme({root,media,panels:{themeName:'dark',setThemeChangeHandler:callback=>{handler=callback;}}});
  assert.equal(root.dataset.theme,'dark');assert.equal(root.style.colorScheme,'dark');
  handler!('default');assert.equal(root.dataset.theme,'light');
  stop();assert.equal(handler,undefined);
});
test('system theme is used only when DevTools theme is unavailable',()=>{
  const root={dataset:{theme:''},style:{colorScheme:''}} as unknown as HTMLElement;
  let change:()=>void=()=>{};
  const media={matches:true,addEventListener:(_name:string,listener:()=>void)=>{change=listener;},removeEventListener(){}} as unknown as MediaQueryList;
  const stop=initializeTheme({root,media,panels:undefined});
  assert.equal(root.dataset.theme,'dark');
  Object.defineProperty(media,'matches',{value:false});change();assert.equal(root.dataset.theme,'light');stop();
});

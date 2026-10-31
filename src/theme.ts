type ThemePanels = { themeName?: string; setThemeChangeHandler?: (callback?: (theme: string) => void) => void };
export function initializeTheme({
  root=document.documentElement,
  media=window.matchMedia('(prefers-color-scheme: dark)'),
  panels=globalThis.chrome?.devtools?.panels as ThemePanels | undefined
} = {}) {
  let hostTheme=panels?.themeName;
  const apply=()=>{
    const theme=hostTheme==='dark'?'dark':hostTheme==='default'?'light':media.matches?'dark':'light';
    root.dataset.theme=theme;root.style.colorScheme=theme;
  };
  const update=(theme:string)=>{hostTheme=theme;apply();};
  apply();media.addEventListener('change',apply);
  panels?.setThemeChangeHandler?.(update);
  // Older Chromium releases expose themeName without a change callback.
  const timer=panels&&!panels.setThemeChangeHandler?setInterval(()=>update(panels.themeName??''),2000):undefined;
  return ()=>{media.removeEventListener('change',apply);panels?.setThemeChangeHandler?.();if(timer)clearInterval(timer);};
}

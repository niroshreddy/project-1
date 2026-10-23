// Capture runs in the service worker so it always targets the inspected tab.
function inspectViewport() {
  document.getElementById('__project1_overlay')?.remove();
  const elements = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let node;
  let visited = 0;
  while ((node = walker.nextNode()) && visited++ < 15000 && elements.length < 350) {
    const rect = node.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2 || rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) continue;
    const style = getComputedStyle(node);
    if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
    if (['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(node.tagName)) continue;
    const text = [...node.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join(' ').trim().slice(0, 140);
    if (!text && !['IMG', 'BUTTON', 'A', 'SVG', 'VIDEO'].includes(node.tagName)) continue;
    elements.push({ tag: node.tagName.toLowerCase(), text,
      box: { x: Math.max(0, rect.x) / innerWidth, y: Math.max(0, rect.y) / innerHeight,
        width: (Math.min(innerWidth, rect.right) - Math.max(0, rect.x)) / innerWidth,
        height: (Math.min(innerHeight, rect.bottom) - Math.max(0, rect.y)) / innerHeight },
      fontSize: style.fontSize, fontFamily: style.fontFamily, color: style.color,
      background: style.backgroundColor, display: style.display, gap: style.gap, padding: style.padding });
  }
  return { url: location.href, title: document.title.slice(0, 1000), width: innerWidth, height: innerHeight,
    dpr: devicePixelRatio, scrollX, scrollY, elements };
}

async function capture(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.active || !tab.url || !/^https?:/.test(tab.url)) throw new Error('Select the inspected HTTP/HTTPS website tab before capturing.');
  const [before] = await chrome.scripting.executeScript({ target: { tabId }, func: inspectViewport });
  const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const [after] = await chrome.scripting.executeScript({ target: { tabId }, func: () => ({ url: location.href, width: innerWidth, height: innerHeight, scrollX, scrollY }) });
  const active = await chrome.tabs.query({ windowId: tab.windowId, active: true });
  if (active[0]?.id !== tabId || ['url', 'width', 'height', 'scrollX', 'scrollY'].some(k => before.result[k] !== after.result[k]))
    throw new Error('The page changed during capture. Keep the inspected tab selected and try again.');
  return { image, snapshot: before.result, capturedAt: new Date().toISOString() };
}

function showHighlight(box, snapshot, label) {
  document.getElementById('__project1_overlay')?.remove();
  if (!box) return;
  if (location.href !== snapshot.url || innerWidth !== snapshot.width || innerHeight !== snapshot.height || scrollX !== snapshot.scrollX || scrollY !== snapshot.scrollY)
    throw new Error('Page position or viewport changed. Capture and compare again to highlight this issue.');
  const host = document.createElement('div'); host.id = '__project1_overlay';
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  const shadow = host.attachShadow({ mode: 'closed' });
  const marker = document.createElement('div');
  marker.style.cssText = `position:absolute;box-sizing:border-box;border:2px solid #ef3340;background:#ef334014;left:${box.x * 100}%;top:${box.y * 100}%;width:${box.width * 100}%;height:${box.height * 100}%;`;
  const text = document.createElement('span'); text.textContent = label;
  text.style.cssText = 'position:absolute;top:0;left:0;background:#c51d30;color:white;font:12px system-ui;padding:3px 7px;max-width:300px';
  marker.append(text); shadow.append(marker); document.documentElement.append(host);
  const clear = () => host.remove();
  addEventListener('scroll', clear, { once: true, capture: true });
  addEventListener('resize', clear, { once: true });
  setTimeout(clear, 8000);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !['panel.html', 'dist/panel.html'].some(path => sender.url === chrome.runtime.getURL(path))) return;
  const run = async () => {
    if (message.type === 'capture') return capture(message.tabId);
    if (message.type === 'highlight') {
      await chrome.scripting.executeScript({ target: { tabId: message.tabId }, func: showHighlight, args: [message.box, message.snapshot, message.label] });
      return true;
    }
    throw new Error('Unsupported action.');
  };
  run().then(data => sendResponse({ data })).catch(error => sendResponse({ error: error.message }));
  return true;
});

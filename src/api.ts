import type { Capture, Comparison, Design } from './types';
export const API = 'http://127.0.0.1:8765';
export async function message<T>(payload: object): Promise<T> {
  if (!globalThis.chrome?.devtools) throw new Error('Open this panel from the installed extension in Developer Tools.');
  const response = await chrome.runtime.sendMessage({ ...payload, tabId: chrome.devtools.inspectedWindow.tabId });
  if (response?.error) throw new Error(response.error);
  if (!response || !('data' in response)) throw new Error('No response from the extension. Reload the extension and reopen Developer Tools.');
  return response.data;
}
export async function captureViewport(): Promise<Capture> {
  if (!globalThis.chrome?.permissions) throw new Error('Install the extension and open its project-1 DevTools tab to capture a page.');
  // captureVisibleTab requires activeTab or <all_urls>. A DevTools click does not grant activeTab.
  const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
  if (!granted) throw new Error('Website access is needed for viewport capture. Click Capture again to grant access.');
  return message<Capture>({ type: 'capture' });
}
export async function compare(design: Design, capture: Capture, signal: AbortSignal): Promise<Comparison> {
  const response = await fetch(`${API}/compare`, { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ design:design.image, actual:capture.image, snapshot:capture.snapshot }), signal });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'The comparison service rejected the request. Check image dimensions and restart the backend.');
  return { id:crypto.randomUUID(), createdAt:new Date().toISOString(), design, capture, ...data,
    issues:data.issues.map((issue: object, index: number) => ({ ...issue, id:`issue-${index+1}` })) };
}

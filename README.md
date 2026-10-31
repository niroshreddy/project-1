# project-1 local UI validation

A Chrome / Edge DevTools extension with a Python FastAPI backend. Upload a design, capture the entire scrollable website page, compare with local image processing and OCR, review numbered findings, and export annotated PNG/PDF reports. No API key, cloud model, external AI service, or per-comparison fee is required. Existing history, annotations, review controls, and downloads are preserved.

## Run the local version

The backend dependencies and OCR models are installed in this workspace's `.venv`. The built extension is in **dist**.

1. Open `chrome://extensions` or `edge://extensions` and reload the extension if it was already loaded from `dist`.
2. For a new installation, enable **Developer mode**, select **Load unpacked**, and choose `C:\Users\niros\OneDrive\Workspace\project-1\dist`. An existing source-folder installation also opens the compiled dist interface after a build; it does not need reinstalling.
3. Copy the installed extension ID into `backend/.env`:

   ```dotenv
   EXTENSION_ID=your-installed-extension-id
   ```

4. Start the service from this project folder:

   ```powershell
   .\.venv\Scripts\python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
   ```

   Alternatively, run `./start-backend.ps1`. Keep the terminal running. Stop an older service with Ctrl+C before starting the new one.
5. Open your website, press **F12**, and choose **project-1**. Check the **>>** overflow menu if hidden. Close and reopen DevTools after reloading the extension.
6. Settings should show **Local engine ready**. The first OCR initialization can take a few seconds.

No OpenAI configuration is read by the comparison engine. Old API key/model entries are unnecessary and may be removed from `.env`.

## Compare and review

1. Upload a PNG/JPG or PDF under 10 MB. Select a page for a multi-page PDF. Images are limited to 24 megapixels and 12,000 pixels per side.
2. Minor differences in screenshot proportions (up to 10%) are normalized automatically. Results include a note above 1%, since resizing can affect spacing and size measurements. Larger mismatches need cropping or a viewport adjustment. Docked DevTools can also reflow the page, which image normalization cannot undo.
3. Click **Capture full page** and grant the optional website-access permission when prompted. Keep the inspected website active and do not scroll while it captures. The extension scrolls and stitches the document, then restores your original position. Output uses CSS-pixel resolution to fit local processing limits.
4. Click **Compare & analyze**. Both images and supplied visible DOM information are processed only by the Python service on your computer.
5. Review findings under Issues, select a numbered issue to emphasize its screenshot annotation, and dismiss/restore findings as appropriate.
6. **Locate on live page** scrolls to below-fold issues and shows an eight-second highlight if URL, document size, and viewport still match. Legacy viewport captures still require the original scroll position. It clears on scrolling/resizing. Content changes at identical coordinates cannot reliably be detected; recapture after changes.
7. Download PNG/PDF from Results. Dismissed findings are omitted from exports; PDF includes a dismissed count.
8. History keeps the latest 15 comparisons locally. Existing records remain readable and are labeled as legacy findings when they lack the new evidence classification.

For a same-image self-check, click **Capture full page**, then **Download raw capture**. Upload that PNG as the reference and compare without recapturing or changing the page. This should return zero findings. Taking the reference before opening docked DevTools can change the viewport and cause the page to reflow; take both captures with the same docking, viewport, zoom, crop, and scroll position.

The engine skips OCR findings when no changed regions exceed rendering tolerance, normalizes OCR inputs to the same resolution, and requires local changed-pixel evidence for text/layout rules. Consistent whole-page shifts are grouped into one capture-alignment diagnostic rather than many separate label issues. Genuine small changed regions are retained even when the overall pixel-change percentage is low.

The default comparison tolerates local shifts of about 8 CSS pixels using a symmetric neighborhood comparison, along with small antialiasing/color changes and capture-edge noise. Layout and spacing rules use higher thresholds to avoid turning OCR bounding-box jitter into issues. This intentionally ignores minor spacing defects; it is aimed at meaningful visual discrepancies, not pixel-perfect verification. Missing text/buttons, substantial displacement, and strong color changes can still produce findings. Extra controls or overlays present in only one screenshot can also differ legitimately.

## What the local engine checks

- **Pixel differences:** proportional image normalization, slight blur to reduce rendering noise, thresholded differences, connected changed regions, and measured mean RGB colors. Region colors include text/images/backgrounds and are not CSS color values.
- **OCR:** packaged RapidOCR ONNX models run locally on CPU. Text matching combines recognized text, normalized spelling, geometric proximity, and available visible DOM labels. Repeated labels match one-to-one by proximity.
- **Position:** displacement of matching OCR text-region centers is reported in viewport CSS pixels.
- **Spacing:** vertical gaps between neighboring matched OCR text regions are compared. Glyph bounds are not CSS margins or padding.
- **Text and size:** differing OCR text and rendered glyph heights produce possible issues. Available DOM font-size is shown as live evidence, without inventing an expected CSS value.
- **Possibly missing text:** expected OCR text with changed pixels and no match in OCR/visible DOM is flagged for review, never asserted as a proven missing component.

Each finding is labeled **Measured difference** or **Possible issue**. Confidence values are rule heuristics, not statistical accuracy probabilities. A measured visual difference can still be harmless dynamic content. OCR may misread characters, split/wrap lines, or miss text; matching cannot fully recover a component tree, design font, or intended CSS from a raster image. Empty findings do not guarantee pixel-perfect compliance. Results are capped at 40 findings per comparison.

OCR is most useful for clear horizontal English/Latin labels; the bundled model also supports Chinese text. Do not assume reliable recognition of every script, tiny text, rotated text, or stylized fonts. Closed shadow roots, cross-origin iframe interiors, canvas content, and animation limit DOM evidence. Detection is less semantic than a vision-language model, intentionally favoring explicit evidence and reviewable rules.

## Privacy and offline behavior

Dependencies/models must be downloaded once during installation. After setup, OCR and comparison work offline and make no external network requests. The website itself may still need internet access to load. OCR uses local model files shipped in the `rapidocr-onnxruntime` wheel; it does not fetch models at comparison time.

The service binds to `127.0.0.1:8765`, restricts comparison requests to the configured extension origin, processes images in memory, and does not save reports on disk. Do not expose this development service publicly. Browser history uses IndexedDB and is not encrypted. Delete individual saved records in History; uninstalling removes extension storage. Input/textarea/select values are omitted from DOM extraction, but screenshots can contain private information.

No hosted sharing, direct Figma integration, code changes, or automated multi-viewport testing is included. Long screenshots are split across PDF pages at readable width. PDF reports use a Latin font; unsupported characters become `?` while screenshots retain their original text visually.

## Fresh installation and development

Use **Python 3.11 or 3.12** (the bundled OCR package requires Python below 3.13), Node.js 22+, and pnpm 11+ or npm.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
Copy-Item backend/.env.example backend/.env
# Set EXTENSION_ID in backend/.env.
pnpm install
pnpm build
```

Use `npm install` / `npm run build` if preferred. No separate Tesseract installation is needed. The extension bundles React, TypeScript output, PDF.js worker/fonts/CMaps, and jsPDF. No remote JavaScript is loaded. Rebuild/reload the extension and reopen DevTools after edits. `pnpm dev` is a UI preview; capture requires the installed extension.

Core files:

- `backend/local_engine.py`: local OCR, matching, pixel processing, evidence rules.
- `backend/app.py`: origin checks, validation, bounded concurrency, health and comparison routes.
- `src/main.tsx`: Compare, Results, History, and Settings interface.
- `src/images.ts`: numbered annotations and PNG/PDF downloads.
- `src/storage.ts`: IndexedDB history and atomic Undo restoration.
- `background.js`: unchanged inspected-tab capture and temporary highlights.

## Verification

```powershell
pnpm build
pnpm test
.\.venv\Scripts\python.exe -m pytest backend/test_local.py backend/test_tolerance.py -q
node tests/ui.mjs
node tests/runtime.mjs
node tests/capture-regression.mjs
```

Backend tests cover validation, origin restrictions, missing-key independence, rule evidence, repeated labels, and real OCR/comparison with network connections forbidden. UI tests use a mocked comparison response to verify PDF input, history persistence, dismiss/restore, annotations, and PNG/PDF downloads. Runtime tests use an isolated headless Edge profile and the real Python service to capture a page and compare a shifted button with actual local OCR. They do not alter your normal browser profile. The runtime test needs port 8765 free.

Evaluate representative design/website pairs manually to measure false positives, missed labels, and accepted findings. The rules are deterministic for fixed OCR output; CPU inference and image rendering may vary slightly across platforms.

Local OCR uses [RapidOCR](https://github.com/RapidAI/RapidOCR), distributed under Apache-2.0, with bundled model artifacts in the [rapidocr-onnxruntime package](https://pypi.org/project/rapidocr-onnxruntime/). These are local software dependencies, not hosted services.

## Full-page capture limits

Captures include the top-level document in both scroll directions. Fixed elements are recorded once and suppressed after scroll handlers run on subsequent tiles, including controls inside open shadow roots. Sticky elements are temporarily rendered in their natural document positions so they are preserved once instead of repeated or omitted. Capture width uses reachable document scrolling; clipped body overflow does not add blank columns. Scroll position, visibility, and animation styles are restored even if capture fails. Independently scrolling inner panels are captured as rendered, not expanded. Infinite-scroll or changing-size pages must finish loading first; a size change aborts with an explanation instead of returning a partial screenshot. Full pages are bounded to 24 megapixels, 12,000 CSS pixels per side, 80 tiles, and an 8.5 MB PNG payload. Larger pages show an actionable error rather than being silently truncated. OCR scans overlapping strips so text below the fold remains legible, with the existing 350-text-region and 40-finding limits.

## Compact workspace and deletion recovery

The Compare view uses a compact header, smaller preview panels, expandable capture help, and collapsible recent comparisons. A persistent bottom action bar keeps Compare visible and explains missing inputs or service setup. Comparison is disabled while the local service is offline; uploads, capture, history, and downloads remain available. Connection guidance includes a retry button and expandable startup instructions. The connection is rechecked periodically.

Deleting a comparison removes it immediately and shows an Undo notification for 12 seconds. Hovering over or focusing the notification pauses dismissal. Consecutive deletions are grouped so Undo restores all pending items together, including their images and reviewed findings. The deletion is finalized when the notification expires, is dismissed, or the panel is reloaded. Undo restores the stored record rather than rerunning analysis.

## DevTools drawer workflow

The internal UI is named UI Compare; the browser DevTools tab remains project-1. A single toolbar replaces the large product header. Compare and History are always available; Results appears only after a comparison or when opening a saved record. PNG/PDF exports are actions inside Results. Settings is accessed through the gear icon. Empty recent history is hidden, and nonempty recent items are collapsed by default.

The Local disclosure owns connection status, privacy information, capture guidance, and startup instructions. The panel follows Chrome DevTools themeName and live theme-change notifications, with system-theme fallback outside DevTools.

Each comparison exposes these controls directly in the workspace:

- Viewport: the inspected page's live width and height, or the captured viewport when live inspection is unavailable. Resize the inspected page or use Chrome's device toolbar to change it. A width change requires a fresh capture.
- Scale: Fit reference normalizes the reference to the capture, subject to the existing 10% proportion limit. Exact pixels rejects images with different pixel dimensions instead of silently scaling them.
- Tolerance: 0–16 CSS pixels, default 8. Larger values suppress minor local spacing/rendering differences and can hide small defects. OCR geometry checks use conservative thresholds derived from this value.

The selected scale/tolerance values are sent to the local engine and saved with the result and PDF report. Old history remains readable without a schema migration. Ctrl+Enter (Cmd+Enter on macOS) runs a ready comparison when focus is inside the panel. The bottom action bar remains visible in a 400px-high drawer.

### Ignore regions and visual review
After capturing a page, use **Draw ignore regions** to drag rectangles over the capture. Up to 20 regions can be excluded; remove them individually or clear all. Regions use relative page coordinates and apply to both images after scale normalization. Replacing the reference or recapturing clears the selection. Run **Compare & analyze** after editing regions. Saved comparisons retain their regions in local history, and PDF reports record the exclusion count. Raw captures and reference images remain unchanged.

In Results, choose **Side-by-side**, **Overlay**, or **Difference** from the View control. Overlay offers a reference-opacity slider. Difference displays raw absolute RGB differences (black means identical), without spacing tolerance or rendering-noise filtering; it is a visual aid rather than a finding score. Teal blocks cover ignored regions in both blended modes. Large blended previews are downsampled to at most 1600 pixels wide / 4 megapixels for browser memory; original images and exports retain their resolution.

Restart the Python backend after updating to this version so it accepts the new `ignoreRegions` comparison option.

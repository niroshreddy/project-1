# project-1 UI comparison and team review

A Chrome / Edge DevTools extension with a Python FastAPI backend. Upload a design, capture a website, compare with image processing and OCR, review numbered findings, and export annotated PNG/PDF reports. No external AI service or AI API key is required. Use local Python OCR, optional browser-only raster comparison, or a self-hosted team workspace. Hosting may have infrastructure costs.

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
4. Click **Compare & analyze**. Images and available DOM evidence use local Python by default. Browser-only mode processes raster pixels in the panel without OCR. Signing in to Team sends analysis requests to the configured team server.
5. Review findings in Results, select a numbered issue to emphasize its screenshot annotation, and dismiss/restore findings as appropriate.
6. **Locate on live page** scrolls to below-fold issues and shows an eight-second highlight if URL, document size, and viewport still match. Legacy viewport captures still require the original scroll position. It clears on scrolling/resizing. Content changes at identical coordinates cannot reliably be detected; recapture after changes.
7. Download PNG/PDF from Results. Annotated PNG omits dismissed findings. PDF includes review decisions, owner/impact notes, accepted/fixed findings, alignment and verification context.
8. History keeps the latest 15 unpinned comparisons and all pinned baselines locally. Existing records remain readable and are labeled as legacy findings when they lack the new evidence classification.

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

Direct Figma integration and automatic code changes are not included. Responsive capture and optional self-hosted Team sharing are described below; no live hosted deployment is bundled. Long screenshots are split across PDF pages at readable width. PDF reports use a Latin font; unsupported characters become `?` while screenshots retain their original text visually.

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

The Compare view uses a compact header, smaller preview panels, expandable capture help, and collapsible recent comparisons. A persistent bottom action bar keeps Compare visible and explains missing inputs or service setup. Python comparison is disabled while its service is offline; browser-only comparison can be selected instead; uploads, capture, history, and downloads remain available. Connection guidance includes a retry button and expandable startup instructions. The connection is rechecked periodically.

Deleting a comparison removes it immediately and shows an Undo notification for 12 seconds. Hovering over or focusing the notification pauses dismissal. Consecutive deletions are grouped so Undo restores all pending items together, including their images and reviewed findings. The deletion is finalized when the notification expires, is dismissed, or the panel is reloaded. Undo restores the stored record rather than rerunning analysis.

## DevTools drawer workflow

The internal UI is named UI Compare; the browser DevTools tab remains project-1. A single toolbar replaces the large product header. Compare and History are always available; Results appears only after a comparison or when opening a saved record. PNG/PDF exports are actions inside Results. Settings is accessed through the gear icon. Empty recent history is hidden, and nonempty recent items are collapsed by default.

The Local disclosure owns connection status, privacy information, capture guidance, and startup instructions. The panel follows Chrome DevTools themeName and live theme-change notifications, with system-theme fallback outside DevTools.

Each comparison exposes these controls directly in the workspace:

- Viewport: the inspected page's live width and height, or the captured viewport when live inspection is unavailable. Resize the inspected page or use Chrome's device toolbar to change it. A changed live width does not invalidate saved screenshots, but live highlighting requires matching capture geometry.
- Scale: Fit reference normalizes the reference to the capture, subject to the existing 10% proportion limit. Exact pixels rejects images with different pixel dimensions instead of silently scaling them.
- Tolerance: 0–16 CSS pixels, default 8. Larger values suppress minor local spacing/rendering differences and can hide small defects. OCR geometry checks use conservative thresholds derived from this value.

The selected scale/tolerance values are sent to the local engine and saved with the result and PDF report. Old history remains readable without a schema migration. Ctrl+Enter (Cmd+Enter on macOS) runs a ready comparison when focus is inside the panel. The bottom action bar remains visible in a 400px-high drawer.

### Visual review
In Results, choose **Side-by-side**, **Overlay**, or **Difference** from the View control. Overlay offers a reference-opacity slider. Difference displays raw absolute RGB differences (black means identical), without spacing tolerance or rendering-noise filtering; it is a visual aid rather than a finding score. Large blended previews are downsampled to at most 1600 pixels wide / 4 megapixels for browser memory; original images and exports retain their resolution.


## End-to-end review workflow

- Choose **Full page** or **Visible viewport** before capture. Quality checks wait for visible images and web fonts, sample document dimensions for stability, and warn about broken images and dynamic canvas/video. This does not detect every animation or content change.
- **Upload a capture instead** supports screenshot review in the hosted web app without an extension. Supply the page URL. Uploaded images have no live DOM evidence.
- Use **Reference alignment** for X/Y offsets and scale, with a live overlay preview. White fills exposed edges. The aligned reference is used consistently for analysis and exports; the original reference remains in the saved record.
- **Browser-only comparison** needs no Python service. It produces downsampled, connected raster regions with spatial/color tolerance, no OCR or semantic findings. Use local/hosted Python when text evidence is needed. A clean run cannot prove compliance.
- Each finding supports **Open**, **Accepted difference**, or **Fixed (reviewer marked)**, owner, business impact, and notes. **Copy issue for tracker** copies URL, timestamp, raster bounds, evidence, expected/actual and review metadata for a bug tracker. It does not directly create GitHub/Jira issues.
- **Review and sign-off** records a reviewer, decision, and note. Approval requires a named reviewer and no unresolved findings. Editing findings returns the decision to Draft. PDF reports include these details.
- In History, **Pin baseline** protects a record from automatic retention cleanup. **Verify fixes** reuses its reference and settings. Capture the updated page at the same URL/dimensions. Exact matching accepted findings carry forward; changed evidence reopens review. A previous finding absent from a new run is labeled **Not detected**, never automatically called fixed. Confirm visually.
- The **Responsive capture suite** resizes the inspected browser window, captures each visible viewport, restores original bounds/state/scroll even on failure, and lets you upload a distinct reference for each width. **Compare all responsive widths** runs those pairs sequentially and saves pinned results. Results completed before an error remain saved. Chrome may refuse widths below its window minimum; use device emulation and individual capture for those mobile widths. Browser resizing is not emulation of a physical mobile device.

## Easier local setup

Python 3.11 or 3.12 is supported. On Windows:

```powershell
.\setup.ps1 -ExtensionId your-installed-extension-id
.\start-backend.ps1
```

The setup script creates the virtual environment, installs packaged OCR dependencies, and configures the extension ID. It requires network access for the initial dependency installation. The start script detects an already-running service; stop its original process first when applying backend code updates.

## Hosted team workspace

`backend.team_app:app` is a separate server application serving the built browser UI and authenticated analysis/review APIs. The original `backend.app:app` remains the localhost-only extension backend. Both use the same Python comparison engine, with no external AI calls.

Team features: password accounts, first-account bootstrap secret, email-bound single-use invitations (48 hours), owner/member workspaces, explicit shared-review saves, server-side record validation, SQLite persistence, optimistic revision conflicts, human review decisions and account-attributed audit events. Invitations are displayed to the owner for private sharing; no email is sent. Bearer sessions expire in 12 hours; only their SHA-256 hashes are stored in the database. Passwords use salted scrypt. Browser session tokens stay in sessionStorage and sign-out revokes the current server session.

### Docker deployment (requires Docker on the deployment host)

1. Copy `team.env.example` to `.env.team`. Generate a random bootstrap key with `python -c "import secrets; print(secrets.token_urlsafe(32))"` and set `TEAM_BOOTSTRAP_KEY`. Set `TEAM_ORIGINS` to the exact public HTTPS origin and installed `chrome-extension://...` origin(s), comma-separated. No wildcard origins are enabled by default.
2. Run `docker compose --env-file .env.team up --build -d`. The server binds to `127.0.0.1:8080` on the host; SQLite uses the named `team-data` volume.
3. Put an HTTPS reverse proxy in front of that loopback port, using your own domain/TLS configuration. Configure authentication rate limits, a 32 MB body limit, appropriate timeouts for OCR, and a single application worker. The app also limits request bodies and applies an in-process authentication attempt guard. Do not publish port 8080 directly on the public internet.
4. Open the HTTPS site, go to **Team**, enter the workspace origin, email and a password of at least 12 characters. Expand **Create an account**, use the bootstrap key for the first account, then sign in. Remove the bootstrap key from the deployment after initial account creation and restart. Create a workspace and generate invitations for teammates.
5. In the Chrome extension, open **Team** and sign in to the same HTTPS origin. Grant access to that exact origin when Chrome prompts. Signed-in analysis uses the hosted Python service. **Save current review to team** explicitly uploads screenshots, URL/DOM evidence and review data. Local edits do not silently synchronize; save again to publish them. Other members use **Refresh teams and reviews** to see updates. A conflicting revision is rejected; reopen the latest shared review before retrying.
6. Back up the persistent SQLite volume and restore-test backups. Shared reviews retain screenshot content until managed by the server operator; local History deletion does not delete a shared server review. This initial hosted version has no SSO, email verification, password-reset email service, live cursors, automatic merge, or shared-review deletion UI. Review records/audit events are accessible only to workspace members, and all authenticated requests must pass the server's workspace authorization checks.

No live hosting account, domain, DNS record, TLS certificate or deployment credential is included in the repository. Docker files are provided, but require a container build/deployment verification on the target host.

For a local hosted-workspace test, build `dist`, set `TEAM_BOOTSTRAP_KEY` and `TEAM_DB` in the process environment, then run `python -m uvicorn backend.team_app:app --host 127.0.0.1 --port 8080`. Open `http://127.0.0.1:8080` directly; extension access additionally needs `TEAM_ORIGINS` configured.

### Additional verification

```powershell
node --import tsx --test tests/*.test.ts
.\.venv\Scripts\python.exe -m pytest backend/test_local.py backend/test_tolerance.py backend/test_team.py -q
node tests/ui.mjs --source-install
node tests/team-ui.mjs
```

`tests/team-ui.mjs` launches the real hosted Python server on loopback port 8770 with a disposable database and isolated browser profile, then verifies registration/login, workspace creation, real image analysis, approval, shared-review roundtrip and audit history. It does not use production accounts or send email.

## UX Journey Recovery Agent — checkout address recovery MVP

A separate **Journey Agent** tab sits alongside Compare. Existing comparison features, local history and team reviews remain available. The agent runs Python Playwright in a fresh, isolated browser with synthetic inputs. It does not attach to your personal Chrome session, reuse login cookies, finalize purchases, or modify production UI.

### Quick local demo

1. Update dependencies with `.\setup.ps1` (or `.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt`). Windows can use the installed Edge browser automatically. Otherwise run `.\.venv\Scripts\python.exe -m playwright install chromium`.
2. Stop the previous Python service, then run `.\start-backend.ps1`. Reload the extension and reopen DevTools.
3. Select **Journey Agent → Use local demo**. The bundled synthetic checkout at `http://127.0.0.1:8765/journey/demo/buggy` intentionally clears address fields after a postal error. No real customer or payment data is involved.
4. Optionally select **Use one viewport** for a shorter first run. Select **Discover form controls**, review the synthetic data and selectors, then **Start recovery investigation**.
5. Review grouped findings, repetition counts, attempt details, focus/error evidence, blocked requests, and before/invalid/recovery screenshots. **Download evidence report (JSON)** exports the contract and evidence.
6. Expand **Re-test a fix using this exact plan and data**. The demo suggests `/journey/demo/fixed`; enter a new build label and confirm the staging target. Re-testing freezes the original scenario plan, data, dimensions and repetitions rather than silently changing the test.
7. Review baseline outcomes. **Not detected** is not automatic closure. A named human reviewer can record a decision; **Verified fixed** requires a completed baseline replay without remaining findings or inconclusive attempts. Human decisions are appended, not substituted for the browser evidence.

### Supported investigation and limits

The bounded scenario catalog covers invalid postal, empty postal, and keyboard submission with an invalid postal code. Cases run two or three times at up to two widths (320–1920 CSS px). The checks observe preservation of untouched field values, configured/native validation feedback, feedback visibility, detectable postal/error association, bounded keyboard reachability, and a declared shipping-success marker after correcting only the postal field. The whole investigation has a four-minute limit; individual browser operations have shorter bounds. Cancel stops after the current bounded operation and closes the isolated browser.

Selectors must identify one address `<form>`, one postal field, one address Continue control, and a success marker that becomes visible only when the shipping step succeeds. Use the discovery tool to obtain editable selectors and synthetic values. Supply a known valid/invalid postal pair for the selected country. A supposedly invalid input that reaches success is **inconclusive** and needs a corrected task contract; it is not used to invent a recovery failure. Authenticated checkout setup, multi-page login, cross-origin payment frames, CAPTCHA, and arbitrary journey recording are outside this first MVP.

Only explicitly enabled origins in `JOURNEY_ALLOWED_ORIGINS` are allowed. URL credentials, query strings, fragments and cloud-metadata targets are rejected. External-origin resources, WebSockets, unsupported/destructive methods and payment/order actions are blocked. POST/PUT/PATCH validation requests also require exact `allowedWritePaths` in the task contract; GraphQL/payment/order payload boundaries still apply. A blocked submission or navigation is **inconclusive**, not evidence of a UX defect. External fonts/assets can be blocked; inspect the request warnings before making appearance judgments. These restrictions are bounded safeguards, not a substitute for a dedicated synthetic staging environment.

Findings are **observed** or **reproduced** mechanical checks, never claims to represent customer preferences, emotion, conversion lift, complete accessibility, or screen-reader usability. Keyboard reachability is bounded to 35 Tab steps. Screenshots are task checkpoints; scrolling/focus can change, so they are not pixel-equivalent baselines. Error selectors and success criteria are supplied by the operator; ambiguous selectors, network boundaries and unexpected navigation are surfaced as inconclusive attempts.

### Local AI status

Model installation was deferred by request. The working default is explicitly labeled **built-in recovery checks**, not AI analysis. Optional `backend/journey_ai.py` integrates with a loopback Ollama service and an installed local model. Set `OLLAMA_NO_CLOUD=1` when configuring that separate runtime; cloud/remote-backed model entries are rejected by the adapter. The model receives the goal and limited form metadata, chooses only scenarios in the fixed catalog, and supplies rationale/hypotheses. It cannot provide executable actions, arbitrary code, selectors, URLs, or production changes. Model output is schema-validated; failed inference is reported rather than silently replaced by a claimed AI result. Real model inference has not been verified on this machine because no model/runtime is installed.

### Data and API

The agent always connects to the localhost backend on port 8765, even when signed in to a hosted Team. Journey endpoints retain the local backend's extension-origin and loopback-host restrictions. Only the two synthetic demo GET pages are public within that loopback service. The hosted team API does not expose journey execution.

Reports are JSON files in ignored `data/journeys/` by default (`JOURNEY_DATA_DIR` can override it). They contain synthetic field values, screenshots and review names; review evidence before exporting. History displays the latest 20 records; files persist until explicitly deleted using **Delete**. No automatic Team upload or external AI upload occurs. A backend restart interrupts unfinished jobs; reopening them marks them interrupted instead of presenting success. Evidence is bounded to 48 MB per report and only a handful of completed reports stay cached in process memory.

Tests:

```powershell
.\.venv\Scripts\python.exe -m pytest backend/test_journey.py -q
node tests/journey-ui.mjs
```

The tests use real isolated browsers against synthetic buggy/fixed forms and a disposable backend data directory. They verify repeated data-loss failures, successful recovery on the fixed variant, local API/origin constraints, bounded model plans, evidence export, frozen-plan re-testing, human review and preservation of the Compare UI. Local AI response parsing is tested without asserting that a real model ran.


### Desktop and responsive mobile comparisons

Choose **Desktop** or **Mobile** in Compare. Desktop defaults to the current browser viewport; phone/tablet and desktop presets or custom CSS dimensions are available. Upload the mockup for that layout. For a chosen target, toggle Chrome/Edge Device Toolbar with Ctrl+Shift+M, select Responsive, enter the displayed width/height, and select Mobile in the device-type menu for mobile emulation. Reload the website if needed. The selector does not programmatically resize the inspected website. Capture rejects a mismatched viewport instead of silently comparing a desktop page with a phone mockup. Full-page capture preserves the selected viewport width while capturing the scrollable page; viewport mode captures only the screen. Capture layout metadata is retained with comparison history. Uploaded screenshots still work without emulation or live DOM evidence. These are responsive website checks, not native iOS/Android app testing.


## Ask about this page — local UX advisor MVP

Restart the Python backend and reload the extension after building. Open **Ask this page**, select the inspected website and desired desktop/mobile viewport, then **Collect page evidence**. This is read-only: it does not click, submit, or navigate the page. Review the JSON evidence and question for sensitive information, confirm review, and run built-in checks or explicitly enable local AI. Refresh evidence after changing page state. Reports live only in the current panel session; **Download advice and QA checks** exports JSON. Nothing is automatically uploaded to Team or persisted by the advisor backend.

The collector samples at most 160 visible controls in the current document. It includes dimensions, a bounded name heuristic, aria-invalid/error associations, and document overflow. It excludes input values, screenshots, cookies, and URL paths/query strings. Simple email/long-number redaction is limited: labels, your question and product context can still contain sensitive information. Review before sending them even to a local model. Frames, shadow DOM, offscreen states, computed contrast, full accessible-name semantics, actual focus order, user behavior, and automated recovery testing are not covered by this snapshot. Use Journey Agent for supported repeated recovery investigations.

Built-in checks report document overflow, potentially missing names, small target bounds, and missing detectable error associations. They link to related WCAG guidance without claiming compliance; spacing, exceptions, native semantics and assistive technology require human verification. With no model, the UI explicitly states that open-ended questions are not answered. QA steps are proposals, never represented as executed tests.

For question-specific answers, configure a separately installed Ollama local model using the same loopback `JOURNEY_OLLAMA_URL` setting as Journey Agent. Disable cloud features in that runtime (`OLLAMA_NO_CLOUD=1`). Select **Use local AI** and an installed model. Model output is schema-validated and unknown evidence references are rejected. The model cannot execute tools or change the website. Recommendations remain hypotheses for review; cited IDs associate advice with observed controls but cannot prove the model's interpretation. Inference errors are reported without silent AI fallback. The adapter disallows external endpoints and remote-backed model entries; HTTP proxy use and redirects are disabled. Model installation and real inference remain deferred, so model quality/latency have not been evaluated here.

`GET /advisor/status` and `POST /advisor/ask` are local-service routes protected by the configured extension origin and loopback host boundary. They are not exposed on the hosted team app. No arbitrary web URL fetching is performed. Inference has a 90-second timeout and allows one advisor generation at a time. Cancel stops waiting in the panel; a local runtime may continue processing until timeout. Example questions: “How could this mobile form improve?”, “Which dialog tradeoffs apply to this task?”, or “What should QA verify for this layout?” Supply product constraints for meaningful advice and do not enter private customer data.

Verification:

```powershell
.\.venv\Scripts\python.exe -m pytest backend/test_advisor.py -q
node tests/advisor-ui.mjs
```

The UI test uses a synthetic DOM, real local Python checks, and an isolated headless browser. Python tests mock local model responses to check grounding and failure behavior; these do not claim real model inference.

Desktop and each Mobile device/orientation workspace keep separate drafts: reference/PDF page, live or uploaded capture, viewport preset, alignment/tolerance, baseline selection and results. Switching modes restores that mode without clearing the other. Drafts are autosaved in local IndexedDB and restore after closing DevTools or restarting the same browser profile; finished comparisons also remain in History. Opening a saved comparison selects its recorded device mode when available; older records use the currently selected mode.


### Persistent Desktop/Mobile workspaces

References, original PDF files/page selection, live or uploaded captures, comparison results, viewport presets and comparison settings are automatically stored in the browser profile using IndexedDB (`project-1-workspaces`, separate from comparison History). The last selected device mode also restores. The device toolbar shows **Saving workspaces locally…**, then **Workspaces saved in this browser** when the transaction completes. Wait for saved status before closing the panel. Save failures are visible with Retry; a failed restore blocks editing to protect existing drafts. Removing a reference or capture saves that removal independently in its mode.

Saved captures are historical snapshots: recapture after the website, viewport or content changes. Storing a draft does not reopen its website or reapply Chrome device emulation. Original PDF content and screenshots may include private information. Drafts stay on this profile and are not automatically synced or sent to Team. Clearing extension/browser data, removing the extension or deleting the profile can remove them; use exports for backups. Draft autosave is intended for one active comparison panel; concurrent panels do not merge their workspace edits. History deletion removes saved history records; a separately retained draft reference/capture must be removed in its workspace too.

`node tests/workspace-persistence.mjs` verifies a full isolated browser close/relaunch, both modes, images, PDF source reuse, settings, results, independent removal, and save-error/retry behavior.


## Labeled comparison benchmark and visual-region matching

The Python comparison engine is now `local-rules-v4`. Alongside OCR it uses local contour/RGB-patch matching for distinctive rectangular visual regions. New **possible** findings cover moved/resized regions and regions that may have disappeared into a plain background. Repeated/ambiguous appearances abstain; color changes on retained shapes do not become missing-component claims. This does not infer a component tree or identify arbitrary buttons/icons semantically. Existing rendering tolerance, DOM evidence, screenshot annotations, reports, local workspaces, advisor and Journey workflows remain available.

See [benchmark protocol and real-pair label format](benchmarks/comparison/README.md). Run `python -m backend.comparison_benchmark` in the project venv for a fully local report under `artifacts/comparison-benchmark/`. `--baseline` disables only visual component matching for a controlled comparison. The shipped 24 synthetic cases are a reproducible development benchmark, not customer accuracy evidence. Read case-level false positives and misses as well as aggregate metrics. Restart the Python backend to use the new matcher.

Screenshot annotations use translucent red with red borders and numbered markers. Selecting a finding increases its fill and border emphasis. The Results preview and annotated PNG/PDF exports share the same renderer; downloaded raw captures remain unannotated.

The shared browser-toolbar palette in `src/tokens.css` uses a neutral header `#F1F3F4`, blue primary actions `#1967D2`, teal supporting actions `#00796B`, white cards `#FFFFFF`, light blue-gray background `#EDF2FA`, preview areas `#F5F8FC`, and light-orange review highlights. `src/palette.css` applies consistent finding, recommendation and focus treatments across the workspaces. Dark mode adapts surfaces while retaining the accent family; destructive actions and status indicators keep distinct semantic colors.


### Mobile phone preview frames

Mobile Compare displays matching phone frames for the reference and live capture. **Preview zoom** applies to both screens: Fit screen width or 100/150/200% of the selected CSS viewport width. Scroll either screen with **Sync phone scrolling** enabled to follow the same relative horizontal/vertical progress; disable it to inspect independently. This is proportional progress, not semantic alignment of unequal page content. Zoom and sync preferences autosave with the Mobile workspace. The neutral bezel sits outside the screenshot; it does not emulate iPhone/Safari hardware or add browser controls. Frames, zoom and scrolling are presentation only: the analysis inputs, raw PNG, annotated PNG/PDF and Desktop previews retain their existing behavior. Use the explicit Choose file/Replace reference button or drag a file onto the reference frame; scrolling the phone does not open the file picker.

Mobile Results also uses matching phone frames around the reference and numbered annotated capture. Shared mobile zoom/sync preferences apply to this side-by-side review. Overlay and Difference use a single phone frame. Frames never enter image analysis or PNG/PDF exports; Desktop Results retains its existing previews.

Mobile viewport presets include iPad sizes 768×1024, 820×1180, 834×1194 and 1024×1366 CSS px. Choosing a tablet viewport gives both Compare and Results matching wider tablet frames. Set the same dimensions in Chrome Device Toolbar before live capture; these are viewport presets, not real iPad/Safari testing. Custom dimensions remain available.

Mobile Compare and Results provide Portrait/Landscape buttons for phone and iPad viewports. Orientation selects a separate saved workspace and its matching frame; new workspaces use swapped preset dimensions. Selecting another preset retains the current orientation. Dimensions and orientation restore with the saved Mobile workspace. Source screenshots are not bitmap-rotated: use an orientation-matching reference and recapture the responsive website at the displayed Device Toolbar dimensions. Desktop is unchanged.


### Separate device and orientation workspaces

**Mobile → Viewport preset** now groups named iPhone, iPad and Android presets. Named dimensions were checked against [Chrome DevTools device presets](https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/emulation/EmulatedDevices.ts) on 2026-11-01. These are CSS viewport presets, not claims about all hardware generations or actual Safari/Android browser behavior. Generic existing presets and Custom remain available.

Every preset **ID plus orientation** has independent references, live/uploaded captures, original PDF/page selection, capture mode, tolerance/alignment/normalization, browser-only choice, baseline, visual mode, zoom/sync preferences, and current results. Devices with equal dimensions (for example Pixel 7 and Pixel 8) are deliberately separate. A device or orientation with no saved draft starts empty; it does not reuse another device's files. Select the former device/orientation to restore its draft. Desktop remains a separate workspace. Last selected mode/model/orientation also restores after browser restart in the same extension profile.

Existing version-1 Desktop/Mobile drafts migrate automatically: Desktop stays intact and the former Mobile draft moves into its previous generic preset/custom orientation. Look under **Generic / existing** for earlier presets. Files and PDFs are preserved without copying that draft into new named slots. Unknown storage versions stop with a restore error instead of overwriting data. Workspace schema version 2 uses the existing IndexedDB database, and save failures remain visible with Retry. Old comparisons with no model identity open in a Custom workspace; new saved comparisons carry preset/orientation metadata so opening History selects the original workspace.

Editing dimensions selects the independent Custom workspace for that orientation. There is one Custom workspace per orientation, rather than one per arbitrary width. Orientation selection does not rotate image pixels, resize Chrome automatically, or convert a portrait mockup into a landscape design. Match Device Toolbar to the displayed dimensions and upload/capture the corresponding layout. Save status and local storage/privacy limits apply to every slot; multiple simultaneous panels still do not merge edits. Large numbers of screenshots/PDFs can reach browser quota, so retain exports as backups.

Verification includes migration of a legacy Mobile PDF and capture, multiple named devices/orientations across a complete isolated browser restart, equal-size device isolation, independent removal, PDF source reuse, history routing and simulated quota recovery (`node tests/workspace-persistence.mjs`).


## Automatic live device preview

Reload the extension and reopen DevTools after building. This version declares Chrome's **debugger permission**: Chrome does not allow it as an optional permission ([permissions documentation](https://developer.chrome.com/docs/extensions/reference/api/permissions)). Chrome may disable an existing installation until you manually approve the permission and re-enable it in `chrome://extensions`. Review the browser warning yourself. The debugging permission is broad, but this implementation attaches only to its own created preview tab and starts only after **Open device preview**.

1. Open the website in your normal tab and choose project-1 → Mobile.
2. Select a named device and orientation, then **Open device preview**. Grant website access if requested. The extension creates a separate Chrome popup and loads the original tab's current HTTP/HTTPS URL.
3. Changing device, orientation or custom dimensions automatically changes the preview webpage viewport. The physical browser window is constrained to an already visible rectangle; content can be scaled to fit, while captures retain the selected CSS-pixel dimensions. Enlarge the preview and reselect a preset if you want more physical display space.
4. Use Capture viewport/full page in project-1. While automatic preview is enabled, captures come from that preview and save to the exact device/orientation workspace that initiated capture. Requests are serialized, and capture reapplies/validates its selected dimensions so stale resize requests cannot silently capture another preset. Original Desktop capture and manual Mobile capture remain available when preview is closed.
5. **Show preview window** focuses it. **Close device preview** detaches debugging and closes only that preview. The inspected original tab is never resized or attached to. Closing the original tab detaches management without forcibly closing a potentially edited preview page.

The preview shares the Chrome profile's normal cookies but performs a new page load; it does not copy form values, sessionStorage, scroll state or unsaved SPA state from the original tab. It uses Chrome mobile/touch viewport emulation at DPR 1 for CSS-resolution screenshots, without spoofing Safari or device-specific user agents. Device names are viewport presets, not real hardware tests. Websites without appropriate viewport metadata may expose a different layout width; capture reports that mismatch instead of labeling a desktop layout as a phone capture. Load lazy content by scrolling in the preview before capturing long pages.

Do not open DevTools on the preview tab: Chrome can detach its debugging session. Cancelling Chrome's debugging banner is respected; there is no automatic reattachment. Use Reopen device preview to explicitly reconnect. If the original tab navigates, Reopen loads its current URL; resize/capture does not silently switch websites. There is no fallback to the original tab after a preview error. Saved captures retain preview provenance, and live highlighting rejects captures from an older preview. Screenshots exclude Chrome UI/device frames and remain subject to the existing pixel/PNG-size limits. Full-page capture restores temporary sticky/animation styles and scroll position even after errors.

Preview mappings are Chrome-session state, separate from persistent device workspaces. Closing/restarting Chrome does not erase saved references or captures; open the preview again for new live captures. No remote debugging port, external AI or hosted capture service is used. Normal website network requests still occur when its new preview page loads. Manual permission approval and actual website authentication are left to you.

Verification: `node --import tsx --test tests/device-preview.test.ts` checks isolation, permission boundaries, serialized capture provenance, invalid settings/URL changes and detach/reconnect. `node tests/device-preview-runtime.mjs` uses actual extension/CDP APIs with synthetic pages in an isolated Edge profile; only the test copy pre-grants permissions. It verifies phone/tablet dimensions and orientation, screenshots, per-workspace persistence, full-page restoration, original-tab isolation and disconnect/reconnect/close behavior.

The layout selector has separate Desktop, Mobile and iPad buttons. Mobile lists phone presets (iPhone/Android); iPad lists tablet presets. Each category restores its last selected device/orientation and continues using the existing per-preset saved workspaces. Phone and iPad Custom workspaces are independent too.

### Compact comparison setup

Mobile and iPad use a compact device toolbar with preset dimensions and a Custom size action. Preview controls, zoom, and synced scrolling sit above the comparison cards; workflow and setup explanations expand on demand. The status shows which workspace is saved locally. When the local service is offline, the comparison bar offers Start service and Use browser-only. Existing per-device and orientation workspaces are retained.

### Desktop, Phone, Tablet, and TV

Phone and Tablet retain their existing saved device/orientation workspaces (including all iPhone, Android phone, and iPad presets). TV adds Full HD (1920 x 1080), 4K (3840 x 2160), and custom CSS viewport presets, defaulting to landscape. Each TV preset/orientation saves its own reference, capture, comparison settings, and results across browser restarts. TV frames appear in Compare and all Results modes, and are excluded from analysis and exports. Automatic TV preview uses desktop layout without touch emulation. This is Chrome responsive viewport testing, not emulation of a particular smart TV browser or remote control. Existing capture size limits still apply.

Device preview shells follow the selected model family: notched iPhones, Dynamic Island iPhones, Pixel/Galaxy camera holes, and iPad bezels, including landscape rotation. These are illustrative CSS frames, not dimensionally exact hardware replicas. Both reference and live previews (including Results) use the same shell; camera decorations stay outside image content and never enter comparison data or exports.

### Device-family frame appearance

Samsung, LG, and Sony TV Full HD/4K presets each have separate saved workspaces. Their decorative shells use distinct pedestal/foot designs and bezel labels. Existing generic TV preset IDs are retained. Phone frames include family-specific corner/bezel treatments, camera cutouts, side controls, and rotated landscape details; iPad Mini and Pro use different bezel/camera placement. The same renderer is used in Compare, annotated Results, overlay, and difference views. Shells and stands never enter analysis or exports. TV branding is illustrative: no exact TV model, physical size, or vendor browser is claimed. Named phone/tablet frames are approximations rather than measured hardware replicas.

Design references: [Apple iPhone 15 Pro](https://support.apple.com/en-us/111829), [Sony BRAVIA design](https://www.sony.com/en/SonyInfo/design/stories/HarmonicPresence/), [LG OLED design](https://www.lg.com/levant_en/why-lgoled/design), [Samsung TV design](https://image-us.samsung.com/SamsungUS/samsung/us/tvs/QN9DASpecSheet_2.4.21.pdf).

Comparison input actions now appear above their previews. Empty device shells use a compact size; loaded images retain zoom and scrolling. Live preview, zoom, and sync share a toolbar. Capture viewport mismatch guidance shows selected/current CSS sizes and offers a matching preview for device modes. Comparison settings use Image scaling and Difference sensitivity labels, with alignment and baseline controls under Advanced settings; existing stored setting names and values are unchanged.

### Local phone and iPad PNG mockups

Phone/tablet Compare and Results now use bundled transparent PNG device mockup images instead of CSS-drawn hardware. Both portrait and landscape assets include screen-opening coordinates; screenshot/canvas content remains independently scrollable and zoomable below the artwork. Raw captures, comparisons, PNG/PDF exports, and saved workspaces are unchanged. TV rendering is unchanged.

Assets: [MockUPhone attribution](https://mockuphone.com/attribution/), pinned source revision `7e570f420ad91d895df926214c206d0833fb53a5`. Local `public/device-mockups/manifest.json` lists per-image source and contributor credits; notices are bundled and linked in How it works. Exact artwork is available for iPhone 14 Pro/Pro Max, iPhone 15/Pro/Pro Max, Pixel 7/8, Galaxy S20 Ultra, and iPad Pro 13. Other named, generic, and custom presets use explicitly labeled related-device artwork; their viewport dimensions and stored IDs are never substituted. The iPad Mini image is also labeled related because its hardware generation differs from the existing DevTools viewport preset. No runtime connection to the artwork provider is used. All 24 PNGs have transparent screen openings validated against their placement metadata.

### Neutral surfaces and keyboard focus

The light theme uses a neutral gray workspace (#F5F7F9), white cards, neutral preview wells, the existing dark teal header, and stronger teal actions (#176B78). Shared text/control/status token pairs were checked against 4.5:1 text and 3:1 control/focus contrast targets; primary button text is 6.16:1, muted text on white is 6.38:1, and input borders on white are 3.68:1. Keyboard focus uses a white inset ring in the header and contrasting rings on content controls in light/dark themes. These targeted checks are not a full accessibility audit. No saved workspace schema or screenshot colors were changed.

## Project Knowledge + Traceability — local pilot

Open **Knowledge** in project-1 after restarting the Python backend and reloading the extension. This opt-in workspace leaves existing comparison routes, per-device IndexedDB drafts, and history stores unchanged. A `knowledge` field is added only when you explicitly evaluate a saved comparison.

1. Create a local project. Upload or paste company guidelines as TXT/Markdown (100,000 characters max). Add a source title and immutable version such as `v1`.
2. Upload an approved Figma PNG/JPG export (8 MB max) or structured Figma JSON export (500,000 characters max). Native `.fig` files, Figma OAuth/API access, and automatic design-token/component matching are not part of this pilot. Image inputs retain existing 24 MP / 12,000px limits.
3. Review the full source preview/download, enter an approver name, and explicitly approve each source version. Draft sources are excluded from validation and retrieval. The local approver label is not authenticated enterprise sign-off. Approved versions cannot be overwritten; corrections require a new version.
4. Select an approved guideline version and create explicit rules. Supported checks: exact sampled text presence, minimum computed font size, exact opaque text color, minimum sampled native-control dimensions, and manual guidance. Mark each as mandatory or optional. Rules are human-authored and explicitly approved, not silently extracted or adopted by AI.
5. Optionally **Use … as reference** on an approved Figma image. It replaces the reference in the device workspace that initiated that action; capture and compare normally. Existing references in other device workspaces are untouched.
6. Open Knowledge with your current comparison (or one opened from History). Select the approved guideline and Figma versions, review the evidence, and run **Validate explicit rules**. Matching uses exact bounded DOM text labels, not CSS selectors or Figma component identity. Missing samples are **needs-review/not-checked**, never proof of absence. **Observed** is a sampled measurement, not a compliance or release pass. Uploaded capture images without DOM evidence cannot support these measured checks.
7. The report freezes project/source versions, SHA-256 source/reference hashes, approver names, explicit rules, evidence IDs and measurements, capture URL/time/device/size, and uncertainties. Figma image correspondence is checked against the original comparison reference bytes; mismatches and JSON-only sources are explicitly labeled. Reports remain attached in Results, local History, per-device saved results, JSON evidence exports, and PDF reports. Human visual-finding-to-rule links are labeled associations, not measured violations.
8. **Check local AI**, choose an installed local Ollama model, and explicitly enable it to ask for an explanation. Retrieval ranks bounded text chunks from only the two selected approved source versions. Every model recommendation must cite valid source and captured evidence IDs; invalid citations, remote-backed models, and external model endpoints are rejected. Source/page text is treated as untrusted data. AI output is a review hypothesis and never changes the website or approves policy. PNG export contents are not interpreted by a vision model. This pilot uses lexical retrieval, not embeddings or a full Figma knowledge graph.

No model is installed automatically. Actual local-model inference remains dependent on your Ollama installation; tests simulate local responses and verify citations, remote rejection, and failure behavior. Existing Ask this page and Journey Agent remain available independently.

Explicitly imported sources (including design images) and approved rules persist in the separate SQLite database `data/knowledge.sqlite3`. Override with `PROJECT_KNOWLEDGE_DB` if needed. Back up that database separately from Chrome storage. It is local, not encrypted, and not an enterprise identity/permission system. The backend's existing extension-origin/loopback boundary protects these routes. Source imports/evaluation do not contact Team or external services; choosing **Save current review to team** also shares the attached trace and source text with your configured Team server. Team serialization retains the optional typed trace. Automatic deletion, revocation, connector sync, multi-project retrieval, and policy conflict resolution are deferred; select source versions explicitly and rerun after changes.

Verification:

```powershell
.\.venv\Scripts\python.exe -m pytest backend/test_knowledge.py -q
node tests/knowledge-ui.mjs
```

The browser test starts its own loopback Python service on port 8798, uses temporary test databases/profiles under ignored `artifacts`, and does not control your open Chrome or restart your existing backend.

## Evidence overview dashboard

Open **Overview** for an enterprise-style dashboard using the existing teal/neutral palette. On windows at least 1600 CSS px wide, a sidebar exposes existing workspaces; narrower/docked DevTools retain the compact navigation. Compare remains the initial screen. No reference, capture, settings, or storage-key migration is performed by opening the dashboard.

The dashboard displays real selected-comparison findings, a side-by-side annotated preview, overlay/difference modes, severity filters and finding navigation, PDF export, saved Knowledge explanations and rule-check coverage, human review status, and links to Ask this page, Knowledge, checkout Journey Agent, History, and Team. A comparison chooser reads history and saved device results. Workspace-wide device counts distinguish prepared references/captures from saved results; neither is a pass or real-device certification. Source-less/unevaluated states are shown explicitly. Pixel-change percentages are never converted into a design-match or release-readiness score, and component counts are not invented.

Figma-to-code component mapping, Jira requirements ingestion, Sanity content validation, repository change-impact analysis, and release-wide aggregation remain clearly labeled roadmap gaps. This dashboard connects existing features; it does not pretend those integrations are implemented.

## Streamlined Compare, Advisor, and Journey flows

The header indicator now explicitly describes **Comparison**, not all backend capabilities. Ask and Journey show independent Comparison / Advisor-or-Journey / Browser runner / Local AI states where relevant. A responding rules service without a model is distinguished from a failed endpoint. Status checks have bounded timeouts, stop displaying Checking after failure, and refresh when returning to a workspace. Access-denied (403), missing updated endpoints (404), unavailable services, and missing local models have different guidance. Missing service status never implies the browser or AI has been checked successfully.

Compare has one desktop upload target, a compact empty capture preview, and initially collapsed comparison settings showing the current image-scaling and tolerance values. Values still use the existing per-device storage. Phone/Tablet/TV mockups, captures, modes, exports, and all existing settings remain available.

Ask has Accessibility / Responsive layout / Form usability / Company guidelines question shortcuts, naturally sized evidence cards, collapsible optional product context, a link to approved Knowledge, and an explicit action-readiness explanation. Built-in checks remain question-independent; shortcuts do not simulate local AI answers. Evidence review and consent remain required.

Journey uses four steps: Choose page, Configure task, Run checks, and Review evidence. Advanced selectors and synthetic values expand in configuration; network boundaries, optional local planning, repetitions, viewports, staging confirmation, discovery, cancellation, history, evidence export, and fix verification are retained. Changing steps does not recreate or clear the task contract. Active-run cancellation remains visible outside the steps. No local model is installed automatically.
# Local accessibility and unified service status

The header **Services** menu lists comparison, advisor, Journey, browser runner,
and local AI status independently. **Check all services** retries their connections;
setup instructions remain in the same menu. Optional AI setup does not block
browser-only comparison or accessibility checks.

Open **Accessibility → Run accessibility checks** to scan the inspected HTTP/HTTPS
page with bundled axe-core 4.11.0. The scan runs in Chrome's isolated script world;
it needs website permission but no Python, AI, or network service. Supported shadow
DOM is checked; embedded frames and other page states require separate checks.
Violations and incomplete/manual-review results stay separate from visual findings.
Evidence includes selectors and remediation text, without collecting element HTML or
input values. Selectors can still contain sensitive identifiers: review before exporting.
Scan triage is session-only, survives navigation between tool tabs, and is included in
the downloadable JSON report. Refreshing the scan starts a new review.

Overview now supports accepting/dismissing and reopening visual findings directly.
These use the existing accepted-difference status, reset human approval to draft,
and save to history and matching device workspaces. **Show reviewed** restores
reviewed findings to the list. Results also exposes quick Accept deviation/Reopen
actions alongside existing detailed review and dismissal controls.

Automated accessibility checks do not establish complete WCAG compliance. The
vendored engine is unmodified; license and pinned distribution integrity are in
`public/vendor/axe-LICENSE.txt` and `public/vendor/axe-NOTICE.txt`.

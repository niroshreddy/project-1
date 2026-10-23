/* Firefox exposes browser; Chromium browsers expose chrome. */
const extensionApi = globalThis.browser ?? globalThis.chrome;
// Source-folder installs use the compiled UI; packaging rewrites this path.
extensionApi.devtools.panels.create("project-1", "", "dist/panel.html");

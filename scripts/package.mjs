import { copyFileSync, mkdirSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
for (const file of ['manifest.json', 'devtools.html', 'background.js', 'device-preview.js']) copyFileSync(file, `dist/${file}`);
writeFileSync('dist/devtools.js', readFileSync('devtools.js', 'utf8').replace('"dist/panel.html"', '"panel.html"'));
mkdirSync('dist/vendor', { recursive: true });
copyFileSync('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'dist/vendor/pdf.worker.min.mjs');
cpSync('node_modules/pdfjs-dist/standard_fonts', 'dist/vendor/standard_fonts', { recursive: true });
cpSync('node_modules/pdfjs-dist/cmaps', 'dist/vendor/cmaps', { recursive: true });
cpSync('node_modules/pdfjs-dist/wasm', 'dist/vendor/wasm', { recursive: true });
console.log('Load the dist folder as an unpacked Chrome / Edge extension.');

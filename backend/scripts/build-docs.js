#!/usr/bin/env node
// Builds a static, self-contained Swagger UI documentation site from
// backend/openapi.json into the repository's docs/ folder. The site is
// deployable to GitHub Pages (or any static host) with zero backend running:
// the spec is inlined into the HTML, and a copy of the raw spec is included
// for direct download / API consumers.
//
// Usage: node scripts/build-docs.js
const fs = require('node:fs');
const path = require('node:path');

const backendDir = path.join(__dirname, '..');
const specFile = path.join(backendDir, 'openapi.json');
const docsDir = path.join(backendDir, '..', 'docs');

const SWAGGER_UI_VERSION = '5.17.14';
const CDN = `https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}`;

function readSpec() {
  return JSON.parse(fs.readFileSync(specFile, 'utf8'));
}

// Inline the spec JSON safely (escape the sequence that could close the tag).
function inlineSpec(spec) {
  return JSON.stringify(spec).replace(/<\//g, '<\\/');
}

function html(spec) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${spec.info.title || 'API'} — OpenAPI Docs</title>
  <link rel="stylesheet" href="${CDN}/swagger-ui.css" />
  <style>
    html { box-sizing: border-box; }
    *, *:before, *:after { box-sizing: inherit; }
    body { margin: 0; background: #fafafa; }
    #banner {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 20px; background: #1a1a2e; color: #fff;
      font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    #banner h1 { font-size: 16px; margin: 0; font-weight: 600; }
    #banner a { color: #7ec8ff; text-decoration: none; font-size: 13px; }
    #banner a:hover { text-decoration: underline; }
    .swagger-ui .topbar { display: none; }
  </style>
</head>
<body>
  <div id="banner">
    <h1>${spec.info.title || 'API'} <span style="opacity:.6;font-weight:400">— OpenAPI 3.0.3</span></h1>
    <div><a href="./openapi.json" download>Download openapi.json</a></div>
  </div>
  <div id="swagger-ui"></div>
  <script src="${CDN}/swagger-ui-bundle.js"></script>
  <script src="${CDN}/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function () {
      var spec = ${inlineSpec(spec)};
      window.ui = SwaggerUIBundle({
        spec: spec,
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: 'StandaloneLayout',
        showExtensions: true,
        showCommonExtensions: true,
      });
    };
  </script>
</body>
</html>
`;
}

function main() {
  const spec = readSpec();
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'openapi.json'), JSON.stringify(spec, null, 2) + '\n');
  fs.writeFileSync(path.join(docsDir, 'index.html'), html(spec));
  // Tell GitHub Pages not to run the site through Jekyll (it would rewrite or
  // drop files, e.g. anything starting with _). Without this, the static docs
  // site can silently break after deployment.
  fs.writeFileSync(path.join(docsDir, '.nojekyll'), '');
  console.log(`✓ Built static docs site in ${path.relative(process.cwd(), docsDir)}`);
  console.log('  index.html (self-contained Swagger UI) + openapi.json + .nojekyll');
}

main();

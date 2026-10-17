#!/usr/bin/env node
// Full audit of both backends against openapi.json for all paths.
const fs = require('fs');
const path = require('path');

const backendDir = path.resolve(__dirname, '..');
const spec = JSON.parse(fs.readFileSync(path.join(backendDir, 'openapi.json'), 'utf8'));
const specPaths = Object.keys(spec.paths);

function normalize(p){ return p.replace(/\/:(\w+)/g, '/{$1}'); }
function templateMatches(t, c){
  const ta = t.split('/'); const ca = c.split('/');
  if(ta.length !== ca.length) return false;
  return ta.every((s,i)=> s===ca[i] || /^\{[^}]+\}$/.test(s));
}

// Express side
const appSrc = fs.readFileSync(path.join(backendDir, 'src', 'app.js'), 'utf8');
const routesDir = path.join(backendDir, 'src', 'routes');
const expressRoutes = [];
{
  const flatRe = /app\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g;
  let m;
  while((m = flatRe.exec(appSrc)) !== null) expressRoutes.push({ method: m[1].toUpperCase(), path: normalize(m[2]) });
  const requireRe = /const\s+(\w+)\s*=\s*require\(\s*['"]\.\/routes\/([^'"]+)['"]\s*\)/g;
  const varToFile = {};
  while((m = requireRe.exec(appSrc)) !== null) varToFile[m[1]] = m[2];
  const mountRe = /app\.use\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)\s*\)/g;
  while((m = mountRe.exec(appSrc)) !== null){
    const mountPath = m[1];
    const routerFile = varToFile[m[2]];
    if(!routerFile) continue;
    const routerPath = path.join(routesDir, routerFile + '.js');
    if(!fs.existsSync(routerPath)) continue;
    const routerSrc = fs.readFileSync(routerPath, 'utf8');
    const reRe = /router\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g;
    let rm;
    while((rm = reRe.exec(routerSrc)) !== null){
      const sub = rm[3];
      const full = mountPath + (sub === '/' ? '' : sub);
      expressRoutes.push({ method: rm[1].toUpperCase(), path: normalize(full) });
    }
  }
}

// npm-free side
const npmfreeSrc = fs.readFileSync(path.join(backendDir, 'src', 'server_npmfree.js'), 'utf8');
const npmfreeLiterals = [];
{
  const re = /url\s*(?:\.startsWith|\.endsWith|\.split\('\?'\)[0]\s*===|===)\s*'([^']+)'/g;
  let m;
  while((m = re.exec(npmfreeSrc)) !== null){
    const clean = m[1].replace(/\?$/, '');
    if(clean.startsWith('/api/')) npmfreeLiterals.push(clean);
  }
}

const errors = [];
specPaths.forEach(p=>{
  const inExpress = expressRoutes.some(r=> r.path===p || templateMatches(r.path, p));
  const inNpmfree = npmfreeLiterals.some(l=> p===l || p.startsWith(l));
  if(!inExpress) errors.push('SPEC_WITOUT_EXPRESS: ' + p);
  if(!inNpmfree) errors.push('SPEC_WITOUT_NPMFREE: ' + p);
});

console.log('SPEC_PATHS:', specPaths.length);
console.log('EXPRESS_ROUTES:', expressRoutes.length);
console.log('NPMFREE_LITERALS:', npmfreeLiterals.length);
console.log('ERRORS:', errors.length);
errors.slice(0, 200).forEach(e=>console.log('  '+e));
if(errors.length === 0) console.log('ALL_COVERED');
EOF
const fs=require('fs');
const appSrc=fs.readFileSync('src/app.js','utf8');
const requireRe=/const\s+(\w+)\s*=\s*require\(\s*['"]\.\/routes\/([^'"]+)['"]\s*\)/g;
const varToFile={};
let m;
while((m=requireRe.exec(appSrc))!==null) varToFile[m[1]]=m[2];
const mountRe=/app\.use\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)\s*\)/g;
const mounts=[];
let x;
while((x=mountRe.exec(appSrc))!==null) mounts.push({mount:x[1],routerVar:x[2]});
const expressRepos=[];
mounts.forEach(({mount,routerVar})=>{
  const routerFile=varToFile[routerVar];
  if(!routerFile) return;
  const routerSrc=fs.readFileSync('src/routes/'+routerFile+'.js','utf8');
  const re=/router\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g;
  let r;
  while((r=re.exec(routerSrc))!==null){
    const sub=r[2];
    const full=mount+(sub==='/' ? '' : sub);
    expressRepos.push({method:r[1],path:full});
  }
});
const flatRe=/app\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g;
let f;
while((f=flatRe.exec(appSrc))!==null) expressRepos.push({method:f[1],path:f[2]});
const byPath={};
expressRepos.forEach(r=>{ (byPath[r.path]=byPath[r.path]||new Set()).add(r.method); });
const pathsOfInterest=[
  '/api/notifications',
  '/api/notifications/{id}',
  '/api/back-orders',
  '/api/back-orders/{id}',
  '/api/back-orders/{id}/resolve',
  '/api/correction-requests',
  '/api/correction-requests/{id}',
  '/api/correction-requests/{id}/resolve',
  '/api/unit-conversions',
  '/api/unit-conversions/{id}'
];
console.log('EXPRESS_PATHS_OF_INTEREST:');
pathsOfInterest.forEach(p=>{
  const methods=byPath[p];
  console.log('  '+p+' -> '+(methods?[...methods].join(' '):'NONE'));
});
console.log('TOTAL_EXPRESS_ROUTES:',expressRepos.length);
console.log('EXPRESS_ROUTE_SAMPLES:');
expressRepos.slice(0,10).forEach(r=>console.log('  '+r.method+' '+r.path));

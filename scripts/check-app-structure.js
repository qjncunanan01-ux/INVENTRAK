#!/usr/bin/env node
// Structure guard for the two Expo apps: every screen under <app>/src/screens/
// must live in the section folder of the navigator surface that shows it, and
// nothing under screens/ may be orphaned (a screen no navigator can reach).
//
// This mirrors frontend-admin/src/pages/navSections.test.js. The Expo apps have
// no test runner — AGENTS.md validates them by `expo export` — so the guard is a
// dependency-free node script instead of a vitest suite, run from each app's
// `npm run structure:check` and from CI's mobile-lint job.
//
// The section map below is checked in BOTH directions against src/App.js, so it
// cannot silently drift: register a screen in App.js without giving it a section
// and this fails; keep a section for a screen App.js no longer registers and
// this fails too. Section names are declared rather than derived from route
// names because a route name is not always the section name — mobile-client's
// four AuthStack routes are one `auth/` section, and staff-client's `QrScanTab`
// is the `qr-scan/` section.
//
// Usage:
//   node scripts/check-app-structure.js              # both apps
//   node scripts/check-app-structure.js mobile-client
const fs = require('node:fs');
const path = require('node:path');

// Section folder -> the screen files inside it (without the .js extension).
// The folders mirror the navigator surfaces in each app's src/App.js:
//
//   mobile-client                                     staff-client
//   home/     HomeTab                                 auth/      RootStack "Login"
//   catalog/  CatalogTab (CatalogStack)               qr-scan/   QrScanTab  "Scan Tag"
//   cart/     CartTab                                 count/     CountTab
//   orders/   OrdersTab (OrdersStack)                 stocktake/ StocktakeTab
//   account/  AccountTab                              requests/  RequestsTab
//   auth/     AuthStack (login/signup/forgot/verify)  account/   AccountTab
const APPS = {
  'mobile-client': {
    home: ['HomeScreen'],
    catalog: [
      'ProductScreen',
      'RecommendationScreen',
      'CategoriesScreen',
      'SearchScreen',
    ],
    cart: ['CartScreen'],
    orders: ['InquiryHistoryScreen', 'OrderInquiryScreen', 'PaymentScreen', 'NotificationsScreen'],
    account: ['AccountScreen', 'DemoPolicyScreen'],
    auth: ['LoginScreen', 'SignupScreen', 'ForgotPasswordScreen', 'VerifyEmailScreen'],
  },
  'staff-client': {
    auth: ['LoginScreen'],
    'qr-scan': ['QrScanScreen'],
    count: ['CountScreen'],
    stocktake: ['StocktakeScreen'],
    requests: ['RequestsScreen'],
    account: ['AccountScreen'],
  },
};

const posix = (p) => p.split(path.sep).join('/');

// Every .js under a directory, as absolute paths.
function jsFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) jsFiles(full, acc);
    else if (entry.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

// --- reachability walker ---------------------------------------------------
// Breadth-first over import edges. Kept independent of the filesystem so the
// synthetic fixture in selfTest() can prove it follows edges rather than just
// checking the roots it was handed.
function reach({ roots, readImports, resolveTarget }) {
  const seen = new Set();
  const queue = [...roots];
  for (let i = 0; i < queue.length; i += 1) {
    const file = queue[i];
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of readImports(file)) {
      const target = resolveTarget(file, spec);
      if (target && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

// Prove the walker reaches the end of an A -> B -> C chain. Without this the
// transitive half of the orphan check could break silently and still pass.
function selfTest() {
  // Keys are the resolved targets the walker passes back into readImports.
  const graph = { root: ['a'], a: ['b'], b: [] };
  const seen = reach({
    roots: ['root'],
    readImports: (f) => graph[f] || [],
    resolveTarget: (_from, spec) => spec,
  });
  return seen.has('a') && seen.has('b');
}

const relImports = (file) => {
  // A registered screen whose file is missing is reported by check (2); don't
  // also blow up the walk here.
  if (!fs.existsSync(file)) return [];
  const src = fs.readFileSync(file, 'utf8');
  const specs = [];
  for (const m of src.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)) specs.push(m[1]);
  for (const m of src.matchAll(/\brequire\(\s*['"](\.[^'"]+)['"]/g)) specs.push(m[1]);
  return specs;
};

function resolveRelative(from, spec) {
  const base = path.resolve(path.dirname(from), spec);
  for (const cand of [base, `${base}.js`, `${base}.jsx`, path.join(base, 'index.js')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

// --- per-app check ---------------------------------------------------------
function checkApp(appDir, declared) {
  const name = path.basename(path.resolve(appDir));
  const srcDir = path.join(appDir, 'src');
  const screensDir = path.join(srcDir, 'screens');
  const appSrc = fs.readFileSync(path.join(srcDir, 'App.js'), 'utf8');
  const errors = [];
  const fail = (title, items) => {
    if (items.length) errors.push(`${title}\n${items.map((i) => `   - ${i}`).join('\n')}`);
  };

  // Screens registered in App.js: `<SomeNavigator.Screen ... component={X} />`
  // where X is imported from './screens/…'. The registration blocks are
  // self-closing and some span several lines, so match attributes across lines
  // rather than line by line.
  const importedVar = {};
  for (const m of appSrc.matchAll(/import\s+(\w+)\s+from\s+'\.\/screens\/([^']+)'/g)) {
    importedVar[m[1]] = m[2];
  }
  const registered = new Map(); // 'section/File' -> route name shown in App.js
  for (const m of appSrc.matchAll(/<[A-Za-z_$][\w$]*\.Screen\b([\s\S]*?)\/>/g)) {
    const attrs = m[1];
    const comp = attrs.match(/component=\{(\w+)\}/);
    if (!comp) continue;
    const key = importedVar[comp[1]];
    if (!key) continue; // component is another navigator, not a screen
    registered.set(key, (attrs.match(/name="([^"]+)"/) || [])[1] || '?');
  }

  const declaredScreens = new Map(); // 'section/File' -> section
  for (const [folder, files] of Object.entries(declared)) {
    for (const file of files) declaredScreens.set(`${folder}/${file}`, folder);
  }

  const folders = fs
    .readdirSync(screensDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  // (0) Guard against a silent no-op: a parse that finds nothing must not pass.
  if (registered.size < 3 || declaredScreens.size < 3 || folders.length < 2) {
    errors.push(
      `parsed too little to be meaningful (registered=${registered.size}, declared=${declaredScreens.size}, folders=${folders.length}) — the App.js parse or the section map is broken`
    );
  }

  // (1) App.js and the section map must describe the same set of screens.
  fail(
    'registered in src/App.js but missing from the section map in scripts/check-app-structure.js:',
    [...registered.keys()].filter((k) => !declaredScreens.has(k))
  );
  fail(
    'declared in the section map but no longer registered in src/App.js:',
    [...declaredScreens.keys()].filter((k) => !registered.has(k))
  );

  // (2) Each declared screen must actually sit in its section folder.
  fail(
    'declared screens whose file is not where the map says:',
    [...declaredScreens.keys()]
      .filter((k) => !fs.existsSync(path.join(screensDir, `${k}.js`)))
      .map((k) => `screens/${k}.js (declared as the ${declaredScreens.get(k)}/ section)`)
  );

  // (3) The folders on disk and the declared sections must be the same set.
  const declaredFolders = [...new Set(Object.keys(declared))].sort();
  fail(
    'folder(s) under src/screens/ that no section claims — give it a navigator surface or move the file:',
    folders.filter((f) => !declaredFolders.includes(f))
  );
  fail(
    'declared section(s) with no folder under src/screens/:',
    declaredFolders.filter((f) => !folders.includes(f))
  );

  // (4) No orphans: every screen file must be registered in App.js or reachable
  // from a registered screen by following imports (a screen may legitimately
  // pull in a non-routed panel file).
  const registeredFiles = new Set(
    [...registered.keys()].map((k) => path.join(screensDir, `${k}.js`))
  );
  const reached = reach({
    roots: [...registeredFiles],
    readImports: relImports,
    resolveTarget: (from, spec) => {
      const target = resolveRelative(from, spec);
      // Stay inside src/: never wander into node_modules or app assets.
      if (!target || path.relative(srcDir, target).startsWith('..')) return null;
      return target;
    },
  });
  const allScreenFiles = jsFiles(screensDir);
  fail(
    'screen file(s) no navigator can reach — register one in App.js or delete it:',
    allScreenFiles
      .filter((f) => !reached.has(f))
      .map((f) => posix(path.relative(screensDir, f)))
  );

  if (errors.length) return { name, errors };
  return {
    name,
    summary: `${allScreenFiles.length} screens in ${folders.length} section folders (${folders.join(', ')})`,
  };
}

function main() {
  const args = process.argv.slice(2);
  const targets = args.length ? args : Object.keys(APPS);

  const results = targets.map((dir) => {
    const name = path.basename(path.resolve(dir));
    const declared = APPS[name];
    if (!declared) {
      return { name, errors: [`no section map in scripts/check-app-structure.js for app '${name}'`] };
    }
    return checkApp(dir, declared);
  });

  const broken = results.flatMap((r) => (r.errors || []).map((e) => `[${r.name}] ${e}`));
  if (!selfTest()) broken.push('[guard] the reachability walker failed its own A->B->C self-test');

  if (broken.length) {
    console.error('✗ screen structure check FAILED:');
    for (const b of broken) console.error(` ${b}`);
    process.exit(1);
  }
  for (const r of results) console.log(`✓ ${r.name}: ${r.summary}`);
}

main();

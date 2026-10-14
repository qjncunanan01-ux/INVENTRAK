#!/usr/bin/env node
// Workflow YAML guard. Every file under .github/workflows must:
//   1. parse as YAML and describe a usable `jobs` mapping, and
//   2. only invoke `npm run` scripts that exist in the package.json of the
//      directory that step actually runs in.
//
// Why this exists: a workflow file that does not parse is not a failing check,
// it is a silently disabled one. GitHub refuses the whole file, so every job in
// it stops running and the only signal is a red mark on a commit whose tests
// never ran. That is exactly how a duplicated `steps:` key in test.yml hid the
// backend spec/docs/test pipeline — and how that orphaned `steps:` block would
// have run `npm run docs:validate` from the repo root (where there is no
// package.json) if a lenient parser had kept it.
//
// The gate cannot live only in the file it guards: if ci.yml is the broken one,
// GitHub never starts its jobs, so nothing inside ci.yml can report it. That is
// why the same script is invoked from a second workflow (docs.yml) as well as
// from `backend npm run verify`, which ci.yml runs as part of that chain.
//
// The second check exists because `npm run spec:auditt` (renamed or typo'd
// script) is a failure CI *can* report but only after burning a whole run, as a
// confusing "Missing script" error that reads like a test failure. Resolving
// the name against the target package.json here turns it into a local guard
// failure, and catches the variant CI cannot report at all: a step whose
// working directory has no package.json, so npm dies before running anything.
//
// Usage: node scripts/check-workflows.js [repoRoot]
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

// `load` is the strict parser from js-yaml 4 onward (safe by default), and it
// still errors on duplicate mapping keys — the defect this guard was written
// for. Do NOT feature-detect on the v3 `safeLoad`: js-yaml 4 keeps it as a
// throwing deprecation stub, so a `typeof` probe looks fine and then rejects
// every valid file.
const parseYaml = yaml.load;

const repoRoot = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', '..');
const workflowsDir = path.join(repoRoot, '.github', 'workflows');
const rel = (p) => path.relative(repoRoot, p).split(path.sep).join('/');

const errors = [];
const fail = (file, message) => errors.push(`${file}: ${message}`);

// ── package.json resolution ────────────────────────────────────────────────
// Cached per directory: the same folder is the working directory of many steps.
const packageCache = new Map();
function packageScripts(dir) {
  if (packageCache.has(dir)) return packageCache.get(dir);
  let result;
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    result = { ok: false, reason: 'that directory has no package.json' };
  } else {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const scripts = pkg && pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
      result = { ok: true, scripts };
    } catch (err) {
      result = { ok: false, reason: `${rel(pkgPath)} is not valid JSON (${String(err.message).split('\n')[0]})` };
    }
  }
  packageCache.set(dir, result);
  return result;
}

// ── shell scanning ─────────────────────────────────────────────────────────
// A `run:` value is a shell script — several commands, several lines, `cd`
// changing directory mid-script — so the only reliable way to know where an
// `npm run` executes is to walk it the way the shell does. Each character is
// tagged UNQUOTED / IN_QUOTES / QUOTE_CHAR: quotes decide both where a command
// ends (an `&&` inside `echo '...'` is text, not a separator) and whether a
// token can be a command at all (`echo npm run x` must never be mistaken for an
// invocation).
const UNQUOTED = 0;
const IN_QUOTES = 1;
const QUOTE_CHAR = 2;

// Shell metacharacters, named so the state machine reads as grammar instead of
// as a pile of escaped quote literals.
const BACKSLASH = '\\';
const SINGLE_QUOTE = '\'';
const DOUBLE_QUOTE = '"';
const HASH = '#';
const NEWLINE = '\n';

// Where a quote character leaves the scanner: it opens a quote, closes the one
// it is inside, or — the other kind of quote — is plain content. null means
// "just content", so the caller does not have to repeat the four cases.
function quoteTransition(mode, ch) {
  if (mode === 'single') return ch === DOUBLE_QUOTE ? null : 'plain';
  if (mode === 'double') return ch === SINGLE_QUOTE ? null : 'plain';
  return ch === SINGLE_QUOTE ? 'single' : 'double';
}

// A `#` only starts a comment at the start of a word, so `a#b` stays literal.
function startsWord(chars) {
  const prev = chars.length ? chars[chars.length - 1][0] : '';
  return prev === '' || /\s/.test(prev);
}

function shellCommands(script) {
  const commands = [];
  let chars = [];
  let mode = 'plain'; // plain | single | double | comment
  const end = () => {
    if (chars.length) commands.push(chars);
    chars = [];
  };
  const put = (ch, kind) => chars.push([ch, kind]);

  for (let i = 0; i < script.length; i++) {
    const ch = script[i];
    if (mode === 'comment') {
      if (ch === NEWLINE) {
        mode = 'plain';
        end();
      }
      continue;
    }
    // A backslash escapes the next character outside single quotes; when what
    // it escapes is a newline (line continuation) the character is ordinary
    // whitespace to the word splitter, so a `\`-wrapped command stays one.
    if (ch === BACKSLASH && mode !== 'single') {
      const next = script[++i];
      if (next !== undefined) put(next, mode === 'double' ? IN_QUOTES : UNQUOTED);
      continue;
    }
    if (ch === SINGLE_QUOTE || ch === DOUBLE_QUOTE) {
      const next = quoteTransition(mode, ch);
      if (next === null) put(ch, IN_QUOTES);
      else {
        mode = next;
        put(ch, QUOTE_CHAR);
      }
      continue;
    }
    if (mode !== 'plain') {
      put(ch, IN_QUOTES);
      continue;
    }
    if (ch === HASH && startsWord(chars)) {
      mode = 'comment';
      continue;
    }
    // `;`, `&&`, `||` and a pipe all end a command; a doubled separator is
    // consumed as one, so no stray `&` leaks into the next command.
    if (ch === '&' || ch === '|' || ch === ';' || ch === NEWLINE) {
      if (script[i + 1] === ch) i++;
      end();
      continue;
    }
    put(ch, UNQUOTED);
  }
  end();
  return commands;
}

// Split one command into words; quote characters themselves are dropped, and
// whitespace only separates words when it was not quoted (so a quoted argument
// stays a single word).
function words(chars) {
  const out = [];
  let word = '';
  for (const [ch, kind] of chars) {
    if (kind === UNQUOTED && /\s/.test(ch)) {
      if (word) out.push(word);
      word = '';
      continue;
    }
    if (kind === QUOTE_CHAR) continue;
    word += ch;
  }
  if (word) out.push(word);
  return out;
}

// `npm`, plus any `VAR=value` env prefix the step sets inline.
function npmInvocation(parts) {
  let i = 0;
  while (i < parts.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(parts[i])) i++;
  return parts[i] === 'npm' ? parts.slice(i) : null;
}

// Which script does this invocation run? Unknown for built-ins (`ci`,
// `install`, `audit`, ...) and for `npm run` with no name, so those are skipped
// rather than guessed at.
function scriptNameOf(invocation) {
  const [, sub, ...rest] = invocation;
  if (!sub) return null;
  if (sub === 'run' || sub === 'run-script') {
    // Options like `--prefix <dir>` take a value we cannot resolve without
    // knowing the flag's arity, so only the exactly-one-plain-word form is
    // checked (which is every form this repo uses).
    const head = [];
    for (const w of rest) {
      if (w.startsWith('-')) break;
      head.push(w);
    }
    return head.length === 1 ? head[0] : null;
  }
  // `npm test` / `npm start` are shorthand for `npm run test` / `npm run start`.
  if (['test', 'start', 'stop', 'restart'].includes(sub)) return sub;
  if (sub === 't') return 'test';
  return null;
}

// True for a statically readable path. `${{ matrix.x }}`, `$VAR`, `~` and
// absolute paths are all unknowable here.
function staticPath(value) {
  return typeof value === 'string' && value.length > 0 && !/[$`~]/.test(value) && !path.isAbsolute(value);
}

function checkStepScripts(fileName, jobName, step, baseDir, counters) {
  const label = step.name ? `step "${step.name}"` : 'a step with no name';
  let cwd = baseDir; // absolute; null once a `cd` makes it unknowable
  for (const command of shellCommands(String(step.run))) {
    if (cwd === null) break; // stop reporting rather than guess at a directory
    const parts = words(command);
    if (!parts.length) continue;

    if (parts[0] === 'cd') {
      cwd = staticPath(parts[1]) ? path.resolve(cwd, parts[1]) : null;
      continue;
    }

    const invocation = npmInvocation(parts);
    if (!invocation) continue;
    const name = scriptNameOf(invocation);
    if (!name) continue;
    counters.refs++;
    counters.checked.add(`${rel(cwd) || '.'}:${name}`);

    const relDir = rel(cwd);
    const location = `job \`${jobName}\` ${label} in ${relDir ? `${relDir}/` : 'the repo root'}`;
    const info = packageScripts(cwd);
    if (!info.ok) {
      fail(fileName, `${location} runs \`${invocation.join(' ')}\`, but ${info.reason} — npm would fail before running anything`);
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(info.scripts, name)) {
      const near = Object.keys(info.scripts).find((s) => s.toLowerCase() === name.toLowerCase());
      const hint = near ? ` — did you mean \`${near}\`?` : '';
      fail(fileName, `${location} runs \`${invocation.join(' ')}\`, but that package.json has no \`${name}\` script (renamed or typo'd?)${hint}`);
    }
  }
}

// The directory a step runs in decides which package.json applies: its own
// working-directory, else the job default, else the repo root. null when it is
// an expression (`${{ matrix.dir }}`) and therefore unknowable.
function stepBaseDir(step, jobDefault) {
  const workingDirectory = step['working-directory'] || jobDefault;
  if (workingDirectory === undefined) return repoRoot;
  return staticPath(workingDirectory) ? path.resolve(repoRoot, workingDirectory) : null;
}

function checkJob(fileName, jobName, job, counters) {
  if (!job || typeof job !== 'object' || Array.isArray(job)) {
    fail(fileName, `job \`${jobName}\` is not a mapping`);
    return;
  }
  if (job.uses) return; // reusable-workflow call: no steps of its own
  if (!Array.isArray(job.steps) || job.steps.length === 0) {
    fail(fileName, `job \`${jobName}\` has no steps — if this job swallowed another job's steps, they were indented wrong`);
    return;
  }
  const jobDefault = job.defaults && job.defaults.run && job.defaults.run['working-directory'];
  for (const step of job.steps) {
    if (!step || typeof step !== 'object') continue;
    if (typeof step.run !== 'string') continue; // `uses:` step
    const baseDir = stepBaseDir(step, jobDefault);
    if (baseDir === null) continue;
    checkStepScripts(fileName, jobName, step, baseDir, counters);
  }
}

// ── workflow files ─────────────────────────────────────────────────────────
// GitHub reads only files sitting directly in .github/workflows/ — a workflow
// in a nested directory is ignored, so it would never run at all.
let entries;
try {
  entries = fs.readdirSync(workflowsDir, { withFileTypes: true });
} catch {
  console.error(`✗ workflow validation FAILED:\n   - ${rel(workflowsDir)} does not exist`);
  process.exit(1);
}

for (const entry of entries) {
  if (entry.isDirectory()) {
    fail(rel(path.join(workflowsDir, entry.name)), 'directory under .github/workflows/ is ignored by GitHub — a workflow placed here never runs');
  }
}

const files = entries
  .filter((e) => e.isFile() && /\.ya?ml$/i.test(e.name))
  .map((e) => e.name)
  .sort();

// Guard against a silent no-op: a bad path or extension filter must not pass.
if (files.length === 0) {
  console.error(`✗ workflow validation FAILED:\n   - no workflow files found in ${rel(workflowsDir)}`);
  process.exit(1);
}

const counters = { refs: 0, checked: new Set() };

for (const name of files) {
  const file = path.join(workflowsDir, name);
  let doc;
  try {
    // Strict parse: unknown tags and duplicate mapping keys are errors, the
    // latter being the exact defect this guard was written for.
    doc = parseYaml(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    fail(name, `does not parse as YAML (${String(err.message).split('\n')[0]})`);
    continue;
  }

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    fail(name, 'is not a YAML mapping');
    continue;
  }
  const jobs = doc.jobs;
  if (!jobs || typeof jobs !== 'object' || Array.isArray(jobs)) {
    fail(name, 'has no `jobs` mapping — GitHub would run nothing from this file');
    continue;
  }
  if (Object.keys(jobs).length === 0) {
    fail(name, 'has an empty `jobs` mapping — GitHub would run nothing from this file');
    continue;
  }

  for (const [jobName, job] of Object.entries(jobs)) {
    checkJob(name, jobName, job, counters);
  }
}

if (errors.length) {
  console.error('✗ workflow validation FAILED:');
  for (const e of errors) console.error(`   - ${e}`);
  process.exit(1);
}
console.log(
  `✓ workflows: ${files.length} file(s) parse, every job has steps, ` +
  `${counters.refs} \`npm run\` reference(s) resolve (${files.join(', ')})`,
);

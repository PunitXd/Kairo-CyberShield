// Repository detection for kairo-init (ARCH §10.3). Walks the repo to depth 2
// (skipping dependencies, build output and dot-directories) and reports:
//   npmProjects      directories with package.json + package-lock.json (npm audit + build)
//   uncoveredNpm     package.json without an npm lockfile (yarn/pnpm or none): not covered in v1
//   dockerfiles      every Dockerfile, and whether its directory is an npm project
//   flutterProjects  pubspec.yaml: not covered by dependency scanning in v1 [Q-6]
//   exampleFiles     committed example env files (reported, never auto-allowlisted)
//   gitleaks         the existing .gitleaks.toml allowlist, so human-written reasons survive
// Everything is sorted, so the same repo always produces the same output.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export const MAX_DEPTH = 2;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor', 'Pods', 'out']);
const EXAMPLE_FILE = /^(\.env\.(example|sample|template)|.+\.example\.json)$/;
const NPM_LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json'];

const walk = (root, rel = '', depth = 0, out = []) => {
  let entries;
  try {
    entries = readdirSync(join(root, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  out.push({ dir: rel || '.', files: entries.filter((e) => e.isFile()).map((e) => e.name) });
  if (depth >= MAX_DEPTH) return out;
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue; // never follows symlinks
    walk(root, rel ? `${rel}/${e.name}` : e.name, depth + 1, out);
  }
  return out;
};

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

/**
 * The allowlist kairo-init manages in .gitleaks.toml: one [[allowlists]] with
 * a description and `paths`, each path preceded by its "# reason:" line.
 * `unmanaged` is true when the file has anything else (custom rules, more
 * allowlists), which a re-render would drop.
 */
export const parseGitleaksConfig = (text) => {
  const entries = [];
  let description = null;
  let reason = null;
  let inPaths = false;
  let unmanaged = false;
  let allowlists = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (inPaths) {
      if (line === ']') inPaths = false;
      else if (line.startsWith('# reason:')) reason = line.slice('# reason:'.length).trim();
      else {
        const m = /^'''(.+)''',?$/.exec(line);
        if (m) {
          entries.push({ regex: m[1], reason });
          reason = null;
        } else if (line && !line.startsWith('#')) unmanaged = true;
      }
      continue;
    }
    if (line === '[[allowlists]]') allowlists += 1;
    else if (/^\[/.test(line) && line !== '[extend]') unmanaged = true;
    else if (line.startsWith('description')) description = /^description\s*=\s*"(.*)"$/.exec(line)?.[1] ?? description;
    else if (/^paths\s*=\s*\[$/.test(line)) inPaths = true;
    else if (/^(regexes|commits|stopwords|condition|regexTarget)\s*=/.test(line)) unmanaged = true;
  }
  return { description, entries, unmanaged: unmanaged || allowlists > 1 };
};

const matches = (regex, path) => {
  try {
    return new RegExp(regex).test(path);
  } catch {
    return false;
  }
};

/** @returns {object} what kairo-init found in the repository at `root` */
export const detect = (root) => {
  const dirs = walk(root);
  const npmProjects = [];
  const uncoveredNpm = [];
  const dockerfiles = [];
  const flutterProjects = [];
  const exampleFiles = [];

  for (const { dir, files } of dirs) {
    const has = (f) => files.includes(f);
    const isNpm = has('package.json') && NPM_LOCKFILES.some(has);
    if (has('package.json')) {
      const pkg = readJson(join(root, dir, 'package.json'));
      if (isNpm && dir !== '.') npmProjects.push({ dir, hasBuild: Boolean(pkg?.scripts?.build) });
      else uncoveredNpm.push({ dir, reason: dir === '.' ? 'root-level project (v1 scans sub-projects only)' : 'no package-lock.json (npm only in v1)' });
    }
    if (has('Dockerfile')) dockerfiles.push({ dir, npm: isNpm && dir !== '.' });
    if (has('pubspec.yaml')) flutterProjects.push({ dir });
    for (const f of files) if (EXAMPLE_FILE.test(f)) exampleFiles.push(dir === '.' ? f : `${dir}/${f}`);
  }

  const gitleaksPath = join(root, '.gitleaks.toml');
  const gitleaks = existsSync(gitleaksPath) ? parseGitleaksConfig(readFileSync(gitleaksPath, 'utf8')) : null;
  const byDir = (a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0);

  return {
    projectName: basename(root),
    npmProjects: npmProjects.sort(byDir),
    uncoveredNpm: uncoveredNpm.sort(byDir),
    dockerfiles: dockerfiles.sort(byDir),
    flutterProjects: flutterProjects.sort(byDir),
    exampleFiles: exampleFiles.sort().map((path) => ({ path, allowlisted: Boolean(gitleaks?.entries.some((e) => matches(e.regex, path))) })),
    gitleaks,
  };
};

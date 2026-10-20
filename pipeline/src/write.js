// Plan and write kairo-init's output (ARCH §10.3). Only two paths are ever
// written, both inside the target repo; a symlink anywhere on the way is
// refused, so the generator can't be tricked into writing elsewhere. An
// existing file that would change is only overwritten with --force.

import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

export const OUTPUTS = { workflow: '.github/workflows/kairo-shield.yml', gitleaks: '.gitleaks.toml' };

/** Lines the new text adds and removes compared with the old (LCS; files are small). */
export const lineDiff = (oldText, newText) => {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const common = dp[0][0];
  return { added: b.length - common, removed: a.length - common };
};

const assertInside = (root, rel) => {
  const target = join(root, rel);
  if (relative(root, target).startsWith('..')) throw new Error(`refusing to write outside the repo: ${rel}`);
  // Every existing component from the root down must be a real directory/file, not a link.
  let p = root;
  for (const part of rel.split('/')) {
    p = join(p, part);
    if (existsSync(p) && lstatSync(p).isSymbolicLink()) throw new Error(`refusing to write through a symlink: ${relative(root, p).split(sep).join('/')}`);
  }
  return target;
};

/** @returns {Array<{ rel, content, status: 'new'|'unchanged'|'changed', headerOnly, added, removed }>} */
export const planFiles = (root, rendered, headerLines) =>
  Object.entries(OUTPUTS).map(([key, rel]) => {
    const target = assertInside(root, rel);
    const content = rendered[key];
    if (!existsSync(target)) return { rel, content, status: 'new' };
    const old = readFileSync(target, 'utf8');
    if (old === content) return { rel, content, status: 'unchanged' };
    const { added, removed } = lineDiff(old, content);
    const headerOnly = removed === 0 && content === `${headerLines}\n${old}`;
    return { rel, content, status: 'changed', headerOnly, added, removed };
  });

export const writeFiles = (root, plan) => {
  for (const f of plan) {
    if (f.status === 'unchanged') continue;
    const target = assertInside(root, f.rel);
    mkdirSync(dirname(target), { recursive: true });
    assertInside(root, f.rel); // re-check after mkdir
    const tmp = `${target}.kairo-init.tmp`;
    writeFileSync(tmp, f.content, { mode: 0o644 });
    renameSync(tmp, target);
  }
};

/** The repo root, resolved (so a symlinked path can't move the target). */
export const resolveRoot = (path) => {
  const root = realpathSync(path);
  if (!lstatSync(root).isDirectory()) throw new Error('target is not a directory');
  return root;
};

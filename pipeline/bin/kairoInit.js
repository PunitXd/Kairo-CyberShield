#!/usr/bin/env node
// kairo-init: generate the Kairo Shield security pipeline for a repository
// (ARCH §10.3, PHASES Oct 22 #1).
//
//   node pipeline/bin/kairoInit.js <repo> [--dry-run] [--force]
//
// Detects npm projects, Dockerfiles, Flutter projects and example env files,
// then writes .github/workflows/kairo-shield.yml (Gitleaks + npm audit +
// Trivy image scan + build; actions pinned to SHAs and binaries to checksums
// from versions.json) and .gitleaks.toml (keeps
// the existing allowlist and its reasons; never allowlists anything itself).
// --dry-run prints the plan and the workflow and writes nothing; an existing
// file that would change needs --force. Prints the branch-protection steps to
// do by hand. Exit codes: 0 done, 1 refused (would overwrite), 2 usage/error.

import { detect } from '../src/detect.js';
import { generatedHeader, loadVersions, renderGitleaks, renderWorkflow, requiredChecks } from '../src/render.js';
import { planFiles, resolveRoot, writeFiles } from '../src/write.js';

const USAGE = 'Usage: node pipeline/bin/kairoInit.js <repo> [--dry-run] [--force]';

export const run = (argv, out = console.log) => {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const paths = argv.filter((a) => !a.startsWith('--'));
  const unknown = [...flags].filter((f) => !['--dry-run', '--force', '--help'].includes(f));
  if (flags.has('--help') || paths.length !== 1 || unknown.length) {
    out(USAGE);
    return flags.has('--help') ? 0 : 2;
  }
  const dryRun = flags.has('--dry-run');
  const force = flags.has('--force');

  const versions = loadVersions();
  const root = resolveRoot(paths[0]);
  const found = detect(root);
  const plan = planFiles(root, { workflow: renderWorkflow(found, versions), gitleaks: renderGitleaks(found, versions) }, generatedHeader(versions));

  const list = (items) => (items.length ? items.join(', ') : 'none');
  out(`kairo-init ${versions.generator} → ${found.projectName}${dryRun ? ' (dry run: nothing is written)' : ''}\n`);
  out('Detected');
  out(`  npm projects     ${list(found.npmProjects.map((p) => p.dir))}  → npm audit (production, high/critical) + build`);
  for (const u of found.uncoveredNpm) out(`  not covered      ${u.dir}: ${u.reason}`);
  out(`  Dockerfiles      ${list(found.dockerfiles.map((d) => `${d.dir}${d.npm ? '' : ' (not an npm project: not scanned)'}`))}  → Trivy image scan (fixable high/critical)`);
  out(`  Flutter          ${list(found.flutterProjects.map((p) => p.dir))}${found.flutterProjects.length ? '  → not covered by dependency scanning in v1' : ''}`);
  out(`  example files    ${list(found.exampleFiles.map((f) => `${f.path} (${f.allowlisted ? 'allowlisted' : 'not allowlisted'})`))}`);
  if (found.exampleFiles.some((f) => !f.allowlisted)) {
    out('                   kairo-init never allowlists on its own: if Gitleaks flags one, add it to .gitleaks.toml with a "# reason:" line.');
  }
  if (found.gitleaks?.unmanaged) out('  warning          .gitleaks.toml has rules kairo-init does not manage; they would be dropped.');

  out('\nFiles');
  for (const f of plan) {
    const what =
      f.status === 'new' ? 'new' : f.status === 'unchanged' ? 'unchanged' : f.headerOnly ? 'changes: adds the generated header only' : `changes: +${f.added} / -${f.removed} lines`;
    out(`  ${f.rel.padEnd(36)} ${what}`);
  }

  if (dryRun) {
    out(`\n--- ${plan[0].rel} ---\n${plan[0].content}`);
    return 0;
  }
  const changed = plan.filter((f) => f.status === 'changed');
  if (changed.length && !force) {
    out(`\nNot written: ${changed.map((f) => f.rel).join(', ')} would change. Re-run with --force to overwrite (check the diff first with --dry-run).`);
    return 1;
  }
  writeFiles(root, plan);
  out(`\nWritten. Review with: git -C "${root}" diff`);
  out('\nBranch protection (by hand, on GitHub → Settings → Branches → main):');
  out(`  require status checks: ${requiredChecks(found).join(', ')}`);
  out('  require branches to be up to date; no bypass for admins');
  return 0;
};

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('kairoInit.js')) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (err) {
    console.error(`kairo-init: ${err.message}`);
    process.exitCode = 2;
  }
}

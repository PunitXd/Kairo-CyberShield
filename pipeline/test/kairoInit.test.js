import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { detect, parseGitleaksConfig } from '../src/detect.js';
import { generatedHeader, loadVersions, renderGitleaks, renderWorkflow, requiredChecks } from '../src/render.js';
import { run } from '../bin/kairoInit.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const versions = loadVersions();
const HEADER = generatedHeader(versions);
const quiet = () => {};

/** A throwaway copy of the sample repo, with dependency folders the walker must skip. */
const sampleRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'kairo-init-'));
  const repo = join(dir, 'SampleApp');
  cpSync(join(FIXTURES, 'sampleRepo'), repo, { recursive: true });
  mkdirSync(join(repo, 'node_modules', 'left-pad'), { recursive: true });
  writeFileSync(join(repo, 'node_modules', 'left-pad', 'package.json'), '{}');
  writeFileSync(join(repo, 'node_modules', 'left-pad', 'package-lock.json'), '{}');
  return repo;
};

/** A repo shaped like CypherFy (same projects, example files and hand-written .gitleaks.toml). */
const cypherfyLike = () => {
  const dir = mkdtempSync(join(tmpdir(), 'kairo-init-'));
  const repo = join(dir, 'CypherFy');
  for (const [p, build] of [['backend', false], ['frontend-web', true]]) {
    mkdirSync(join(repo, p), { recursive: true });
    writeFileSync(join(repo, p, 'package.json'), JSON.stringify({ name: p, scripts: build ? { build: 'vite build' } : { start: 'node .' } }));
    writeFileSync(join(repo, p, 'package-lock.json'), '{}');
    writeFileSync(join(repo, p, 'Dockerfile'), 'FROM node:22-alpine\n');
    writeFileSync(join(repo, p, '.env.example'), 'X=placeholder\n');
  }
  mkdirSync(join(repo, 'frontend'));
  writeFileSync(join(repo, 'frontend', 'pubspec.yaml'), 'name: cypherfy\n');
  writeFileSync(join(repo, 'frontend', 'dart_defines.example.json'), '{}');
  writeFileSync(join(repo, '.gitleaks.toml'), readFileSync(join(FIXTURES, 'cypherfy', 'gitleaks.toml'), 'utf8'));
  return repo;
};

test('detect: npm projects with lockfiles, uncovered ones, Dockerfiles, Flutter, example files; skips node_modules', () => {
  const found = detect(sampleRepo());
  assert.equal(found.projectName, 'SampleApp');
  assert.deepEqual(found.npmProjects, [
    { dir: 'api', hasBuild: false },
    { dir: 'web', hasBuild: true },
  ]);
  assert.deepEqual(found.uncoveredNpm.map((u) => u.dir), ['legacy']);
  assert.deepEqual(found.dockerfiles, [
    { dir: 'api', npm: true },
    { dir: 'mobile', npm: false },
  ]);
  assert.deepEqual(found.flutterProjects, [{ dir: 'mobile' }]);
  assert.deepEqual(found.exampleFiles, [{ path: 'api/.env.example', allowlisted: false }]);
  assert.equal(found.gitleaks, null);
});

test('render: matrix and build steps from the detected projects, actions pinned to SHAs, deterministic', () => {
  const found = detect(sampleRepo());
  const yml = renderWorkflow(found, versions);
  assert.ok(yml.startsWith(HEADER));
  assert.match(yml, /project: \[api, web\]/);
  assert.match(yml, /- run: npm ci --prefix api\n {6}- run: npm ci --prefix web\n {6}- run: npm run build --prefix web\n$/);
  assert.ok(!/@(v\d|main|master|latest)\b/.test(yml.replace(/# v[\d.]+/g, '')), 'no floating action tags');
  for (const a of Object.values(versions.actions)) assert.ok(yml.includes(`${a.uses}@${a.sha}`));
  assert.ok(!yml.includes('@@'), 'every marker filled');
  assert.equal(renderWorkflow(detect(sampleRepo()), versions), yml, 'same input → same output');
  assert.deepEqual(requiredChecks(found), ['secrets', 'deps (api)', 'deps (web)', 'image (api)', 'build']);
});

test('render: an image job for each Dockerfile in an npm project, Trivy pinned by version and checksum', () => {
  const yml = renderWorkflow(detect(sampleRepo()), versions);
  assert.match(yml, /^ {2}image:\n {4}needs: \[secrets, deps\]/m);
  assert.match(yml, /image:[\s\S]*?project: \[api\]/, 'mobile has a Dockerfile but is not an npm project');
  assert.match(yml, /--severity HIGH,CRITICAL --ignore-unfixed --exit-code 1/);
  assert.ok(yml.includes(`TRIVY_SHA256: ${versions.trivy.sha256}`));
  assert.match(yml, /sha256sum -c -/);
  assert.match(yml, /^ {4}needs: \[secrets, deps, image\]$/m, 'build waits for the image scan');
  assert.ok(!yml.includes('trivy-action'), 'no third-party action for Trivy');
});

test('render: no npm Dockerfile → no image job, and build needs only secrets + deps', () => {
  const repo = sampleRepo();
  const found = detect(repo);
  found.dockerfiles = found.dockerfiles.filter((d) => !d.npm);
  const yml = renderWorkflow(found, versions);
  assert.ok(!/^ {2}image:/m.test(yml));
  assert.match(yml, /^ {4}needs: \[secrets, deps\]$/m);
});

test('render: a repo without npm projects gets only the secrets job', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kairo-init-'));
  const yml = renderWorkflow(detect(dir), versions);
  assert.match(yml, /^ {2}secrets:/m);
  assert.ok(!/^ {2}(deps|build):/m.test(yml));
  assert.deepEqual(requiredChecks(detect(dir)), ['secrets']);
});

test('gitleaks: a new config allowlists nothing; an existing allowlist keeps its paths and reasons', () => {
  const fresh = renderGitleaks(detect(sampleRepo()), versions);
  assert.ok(!fresh.includes('[[allowlists]]'), 'never allowlists on its own');
  assert.match(fresh, /title = "SampleApp secret scan \(Kairo Shield\)"/);

  const parsed = parseGitleaksConfig(readFileSync(join(FIXTURES, 'cypherfy', 'gitleaks.toml'), 'utf8'));
  assert.equal(parsed.entries.length, 2);
  assert.ok(parsed.entries.every((e) => e.reason && e.reason.length > 10));
  assert.equal(parsed.unmanaged, false);
  assert.equal(parseGitleaksConfig('[[rules]]\nid = "x"\n').unmanaged, true);
});

test('golden: on a CypherFy-shaped repo the output is the hand-written files plus the header, nothing else', () => {
  const found = detect(cypherfyLike());
  assert.equal(renderWorkflow(found, versions), `${HEADER}\n${readFileSync(join(FIXTURES, 'cypherfy', 'kairoShield.yml'), 'utf8')}`);
  assert.equal(renderGitleaks(found, versions), `${HEADER}\n${readFileSync(join(FIXTURES, 'cypherfy', 'gitleaks.toml'), 'utf8')}`);
  assert.deepEqual(
    found.exampleFiles.map((f) => [f.path, f.allowlisted]),
    [
      ['backend/.env.example', true],
      ['frontend-web/.env.example', false],
      ['frontend/dart_defines.example.json', true],
    ]
  );
});

test('CLI: --dry-run writes nothing; a first run writes both files; a re-run is unchanged', () => {
  const repo = sampleRepo();
  const lines = [];
  assert.equal(run([repo, '--dry-run'], (l) => lines.push(l)), 0);
  assert.ok(lines.join('\n').includes('--- .github/workflows/kairo-shield.yml ---'));
  assert.equal(existsSync(join(repo, '.github')), false);

  assert.equal(run([repo], quiet), 0);
  assert.ok(readFileSync(join(repo, '.github/workflows/kairo-shield.yml'), 'utf8').startsWith(HEADER));
  assert.ok(existsSync(join(repo, '.gitleaks.toml')));

  const again = [];
  assert.equal(run([repo], (l) => again.push(l)), 0);
  assert.equal(again.filter((l) => l.includes('unchanged')).length, 2);
});

test('CLI: an edited file is only overwritten with --force', () => {
  const repo = sampleRepo();
  run([repo], quiet);
  const wf = join(repo, '.github/workflows/kairo-shield.yml');
  writeFileSync(wf, 'name: hand-edited\n');
  const lines = [];
  assert.equal(run([repo], (l) => lines.push(l)), 1);
  assert.match(lines.join('\n'), /Re-run with --force/);
  assert.equal(readFileSync(wf, 'utf8'), 'name: hand-edited\n');
  assert.equal(run([repo, '--force'], quiet), 0);
  assert.ok(readFileSync(wf, 'utf8').startsWith(HEADER));
});

test('CLI: refuses to write through a symlink, and rejects bad usage', () => {
  const repo = sampleRepo();
  const outside = mkdtempSync(join(tmpdir(), 'kairo-init-outside-'));
  symlinkSync(outside, join(repo, '.github'));
  assert.throws(() => run([repo], quiet), /symlink/);
  assert.equal(existsSync(join(outside, 'workflows')), false, 'nothing written outside the repo');
  assert.equal(run([], quiet), 2);
  assert.equal(run([repo, '--yolo'], quiet), 2);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { composeArgs, parseCommand, pointerTag } from './deployer.js';

const ID = '01JAA0000000000000000000AA';
const msg = (o) => JSON.stringify({ v: 1, op: 'deploy', tag: 'abc1234', deploymentId: ID, ...o });

test('deployer accepts only deploy/rollback with a SHA tag and ulid ids', () => {
  assert.deepEqual(parseCommand(msg({})), { op: 'deploy', tag: 'abc1234', deploymentId: ID, actionId: null });
  assert.deepEqual(parseCommand(msg({ op: 'rollback', actionId: ID })), { op: 'rollback', tag: 'abc1234', deploymentId: ID, actionId: ID });
  for (const bad of [
    msg({ op: 'exec' }),
    msg({ tag: 'latest' }),
    msg({ tag: 'abc1234; rm -rf /' }),
    msg({ tag: '$(id)' }),
    msg({ tag: 'ABC1234' }),
    msg({ deploymentId: '../x' }),
    msg({ actionId: 'nope' }),
    msg({ v: 2 }),
    'not json',
    'null',
  ]) {
    assert.equal(parseCommand(bad), null, bad);
  }
});

test('deployer runs one fixed compose command: no shell, no build, cypherfy-backend only', () => {
  const args = composeArgs('/repo');
  assert.deepEqual(args, ['compose', '--project-directory', '/repo', 'up', '-d', '--no-deps', '--no-build', '--force-recreate', 'cypherfy-backend']);
  assert.ok(!args.some((a) => /[;&|$`]/.test(a)));
});

test('the deployer re-points the tag Compose runs (CYPHERFY_TAG), and only to a plain tag', () => {
  assert.equal(pointerTag({}), 'dev');
  assert.equal(pointerTag({ CYPHERFY_TAG: 'dev' }), 'dev');
  assert.throws(() => pointerTag({ CYPHERFY_TAG: 'dev; rm -rf /' }));
  assert.throws(() => pointerTag({ CYPHERFY_TAG: '../x' }));
});

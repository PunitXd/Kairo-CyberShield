import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs, DEFAULT_TARGET } from './args.js';

test('parseArgs reads the flags the attack scripts use', () => {
  assert.deepEqual(parseArgs(['--mode', 'events', '--target', 'http://localhost:8000', '--count', '40']), {
    mode: 'events',
    target: 'http://localhost:8000',
    count: '40',
  });
  assert.deepEqual(parseArgs(['--via', 'socket']), { via: 'socket' });
  assert.deepEqual(parseArgs(['--help']), { help: true });
  assert.deepEqual(parseArgs(['-h']), { help: true });
});

test('a flag with no value (followed by another flag or nothing) is boolean true', () => {
  assert.deepEqual(parseArgs(['--via', '--target', 'http://localhost:8000']), { via: true, target: 'http://localhost:8000' });
  assert.deepEqual(parseArgs(['--count']), { count: true });
});

test('DEFAULT_TARGET is the local stack', () => {
  assert.equal(new URL(DEFAULT_TARGET).hostname, 'localhost');
});

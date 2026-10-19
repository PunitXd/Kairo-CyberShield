import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readZip } from '../../src/utils/readZip.js';
import { makeZip } from '../zipFixture.js';

test('reads deflated entries written with a data descriptor (GitHub artifact layout)', () => {
  const zip = makeZip({ 'secrets.json': '[{"RuleID":"x"}]', 'deps-backend.json': '{"a":1}' });
  const entries = readZip(zip);
  assert.deepEqual(
    entries.map((e) => [e.name, e.data.toString()]),
    [
      ['secrets.json', '[{"RuleID":"x"}]'],
      ['deps-backend.json', '{"a":1}'],
    ],
  );
});

test('reads stored entries', () => {
  const [entry] = readZip(makeZip({ 'a.txt': 'hello' }, { method: 0, dataDescriptor: false }));
  assert.equal(entry.data.toString(), 'hello');
});

test('refuses an entry larger than maxEntryBytes (zip bomb guard)', () => {
  const zip = makeZip({ 'big.json': 'x'.repeat(5000) });
  assert.throws(() => readZip(zip, { maxEntryBytes: 1000 }), /entry too large/);
});

test('refuses garbage and truncated archives', () => {
  assert.throws(() => readZip(Buffer.from('not a zip at all, definitely not')), /end of central directory/);
  assert.throws(() => readZip(Buffer.alloc(3)), /not a zip/);
  const zip = makeZip({ 'a.json': '{"k":"value value value"}' });
  const cut = Buffer.concat([zip.subarray(0, 40), zip.subarray(zip.length - 22 - 58)]);
  assert.throws(() => readZip(cut));
});

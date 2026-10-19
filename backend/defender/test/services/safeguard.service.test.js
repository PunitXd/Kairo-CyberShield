import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRemediation } from '../../src/services/remediation.service.js';
import { rules } from '../../src/rules/index.js';
import { CONFIG, IP_A, T0, authFail, fakeRedis, silentLog, withRules } from '../helpers.js';

const [r1a, r1b] = rules;

const throttleDecision = { severity: 'medium', summary: 's', actions: [{ type: 'throttle', scope: 'auth', ttlMs: 300_000 }], evidence: { observed: 5, threshold: 5, windowMs: 60_000 }, fieldsUsed: [] };
const blockDecision = { severity: 'high', summary: 's', actions: [{ type: 'block', scope: 'auth' }], evidence: { observed: 10, threshold: 10, windowMs: 300_000 }, fieldsUsed: [] };

const setup = ({ env = 'staging', config = CONFIG } = {}) => {
  const clock = { now: T0 };
  const redis = fakeRedis(clock);
  const remediation = createRemediation({ redis, mongo: null, env, log: silentLog, now: () => clock.now });
  const handle = (rule, decision, cfg = config) =>
    remediation.handle({ rule, subject: IP_A, decision, event: authFail({ ts: clock.now - 40 }), ruleCfg: cfg.rules[rule.id], config: cfg, rules });
  return { clock, redis, handle };
};

const resultOf = async (handlePromise) => (await handlePromise).actions[0].result;

test('enforce in staging: throttle key written with a TTL and the rule, incident key opened', async () => {
  const { redis, handle } = setup();
  const out = await handle(r1a, throttleDecision);
  assert.equal(out.actions[0].result, 'applied');
  assert.equal(out.actions[0].latencyMs, 40, 'TTR measured from the trigger event');
  assert.equal(await redis.pttl(`kairo:throttle:auth:${IP_A}`), 300_000);
  const value = JSON.parse(await redis.get(`kairo:throttle:auth:${IP_A}`));
  assert.equal(value.rule, 'R1a');
  assert.equal(value.level, 'throttle');
  assert.equal(value.incidentId, out.incidentId);
  assert.equal(await redis.get(`kairo:inc:open:auth:${IP_A}`), out.incidentId);
});

test('safeguard 1: any env other than staging is shadow, even with everything else permissive', async () => {
  for (const env of ['production', 'local']) {
    const { redis, handle } = setup({ env });
    assert.equal(await resultOf(handle(r1a, throttleDecision)), 'skipped_shadow', env);
    assert.equal(await redis.exists(`kairo:throttle:auth:${IP_A}`), 0);
  }
});

test('safeguard order: killswitch (2) beats shadow mode (3); shadow (3) beats allowlist (4)', async () => {
  const shadowCfg = withRules({ R1a: { mode: 'shadow' } });
  const a = setup({ config: shadowCfg });
  await a.redis.set('kairo:killswitch', '{"by":"test"}');
  assert.equal(await resultOf(a.handle(r1a, throttleDecision)), 'skipped_killswitch');

  const b = setup({ config: shadowCfg });
  await b.redis.set(`kairo:allow:${IP_A}`, '{"by":"test"}');
  assert.equal(await resultOf(b.handle(r1a, throttleDecision)), 'skipped_shadow');
});

test('safeguard 4: an allowlisted source is detected but not acted on', async () => {
  const { redis, handle } = setup();
  await redis.set(`kairo:allow:${IP_A}`, '{"by":"test"}', 'PX', 86_400_000);
  const out = await handle(r1b, blockDecision);
  assert.equal(out.actions[0].result, 'skipped_allowlist');
  assert.equal(await redis.exists(`kairo:block:auth:${IP_A}`), 0);
  assert.equal(await redis.exists(`kairo:strikes:auth:${IP_A}`), 0, 'no strike burned on a skip');
});

test('safeguard 5: at the active-block cap new actions are skipped and one fp_storm is raised', async () => {
  const { clock, redis, handle } = setup();
  for (let i = 0; i < CONFIG.global.activeBlockCap; i++) await redis.zadd('kairo:blocks:active', clock.now + 60_000, `auth:${i}`);
  assert.equal(await resultOf(handle(r1b, blockDecision)), 'skipped_cap');
  assert.equal(await redis.get('kairo:system:fp_storm'), '1');
});

test('safeguard 5: expired entries are pruned before counting against the cap', async () => {
  const { clock, redis, handle } = setup();
  for (let i = 0; i < CONFIG.global.activeBlockCap; i++) await redis.zadd('kairo:blocks:active', clock.now - 1, `auth:${i}`);
  assert.equal(await resultOf(handle(r1b, blockDecision)), 'applied');
  assert.equal(await redis.zcard('kairo:blocks:active'), 1);
});

test('ladder: 5 → 15 → 60 min per strike, then stays at 60 min; every block is in blocks:active', async () => {
  const { clock, redis, handle } = setup();
  const ttls = [];
  for (let i = 0; i < 4; i++) {
    const out = await handle(r1b, blockDecision);
    ttls.push(out.actions[0].ttlMs);
    clock.now += out.actions[0].ttlMs + 1; // let the block expire before the next offence
  }
  assert.deepEqual(ttls, [300_000, 900_000, 3_600_000, 3_600_000]);
  assert.equal(await redis.pttl(`kairo:strikes:auth:${IP_A}`) > 0, true, 'strikes expire (24 h)');
});

test('ladder TTL is clamped to maxBlockMs', async () => {
  const cfg = withRules();
  cfg.global.ladderMs = [7_200_000];
  const { redis, handle } = setup({ config: cfg });
  const out = await handle(r1b, blockDecision, cfg);
  assert.equal(out.actions[0].ttlMs, 3_600_000);
  assert.equal(await redis.pttl(`kairo:block:auth:${IP_A}`), 3_600_000);
});

test('an existing longer block is never shortened', async () => {
  const { redis, handle } = setup();
  await redis.set(`kairo:block:auth:${IP_A}`, '{"rule":"R1b"}', 'PX', 900_000);
  const fixed = { ...blockDecision, actions: [{ type: 'block', scope: 'auth', ttlMs: 300_000 }] };
  assert.equal(await resultOf(handle(r1b, fixed)), 'already_active');
  assert.equal(await redis.pttl(`kairo:block:auth:${IP_A}`), 900_000);
});

test('R1a then R1b for the same source share one incident', async () => {
  const { handle } = setup();
  const first = await handle(r1a, throttleDecision);
  const second = await handle(r1b, blockDecision);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.incidentId, first.incidentId);
});

// Redis key names come from the shared schema package so the hooks and the
// Defender can never disagree (ARCH §8.1). Defender-only keys live here.

export { KEYS, STREAM_MAXLEN, CONSUMER_GROUP } from 'kairo-schema';

export const CONSUMER_NAME = 'defender-1';

/** NX guard so a false-positive storm raises one critical incident, not hundreds. */
export const FP_STORM_KEY = 'kairo:system:fp_storm';

// R4 (ARCH §8.1): Defender ↔ host deployer. Not used by the hooks, so they
// live here rather than in the shared schema.
export const DEPLOY_KEYS = {
  /** Pub/sub: Defender → deployer.js ({ op: 'deploy'|'rollback', tag, deploymentId, actionId? }). */
  commands: 'kairo:deploy:commands',
  /** One automatic rollback per window: SET NX PX budgetMs is the idempotency and the loop guard. */
  budget: 'kairo:rollback:budget',
  /** Automation stopped until an operator clears it (no TTL). */
  frozen: 'kairo:rollback:frozen',
};

/** Image tags the deployer will run: a git SHA, 7–40 hex (ARCH §3.9). */
export const DEPLOY_TAG_RE = /^[a-f0-9]{7,40}$/;

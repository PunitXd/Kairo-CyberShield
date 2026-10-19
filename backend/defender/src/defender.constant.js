// Redis key names come from the shared schema package so the hooks and the
// Defender can never disagree (ARCH §8.1). Defender-only keys live here.

export { KEYS, STREAM_MAXLEN, CONSUMER_GROUP } from 'kairo-schema';

export const CONSUMER_NAME = 'defender-1';

/** NX guard so a false-positive storm raises one critical incident, not hundreds. */
export const FP_STORM_KEY = 'kairo:system:fp_storm';

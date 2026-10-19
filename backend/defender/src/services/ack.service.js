// kairo.ack → the command action it answers (ARCH §5.3, §14.2). A socket
// action is `sent` when the Defender publishes it; when the CypherFy instance
// holding the socket reports back, the action becomes `applied` with
// appliedAt = ackedAt, so time-to-remediate for a disconnect is measured to the
// moment the socket was actually cut, not to the publish.
//
// Only a `sent` action changes, so a duplicate ack is a no-op.

export const createAckService = ({ mongo, bus = null, log }) => ({
  async handle(event) {
    if (event.type !== 'kairo.ack' || !mongo) return;
    const { actionId, ok } = event.ack;
    try {
      const action = await mongo.actions.findOne({ _id: actionId });
      if (!action || action.result !== 'sent') return;
      const ackedAt = new Date(event.ts);
      const update = ok
        ? { result: 'applied', ackedAt, appliedAt: ackedAt, latencyMs: Math.max(0, event.ts - action.triggerEventTs) }
        : { result: 'failed', ackedAt, error: 'the hooks could not carry it out' };
      const res = await mongo.actions.updateOne({ _id: actionId, result: 'sent' }, { $set: update });
      if (!res.modifiedCount) return;
      log.info({ msg: 'action.acked', actionId, rule: action.ruleId, action: action.type, result: update.result, ttrMs: update.latencyMs ?? null });
      bus?.emit('action.applied', { ...action, ...update });
    } catch (err) {
      log.error({ msg: 'mongo.write_failed', what: 'action.ack', error: err?.message?.slice(0, 200) });
    }
  },
});

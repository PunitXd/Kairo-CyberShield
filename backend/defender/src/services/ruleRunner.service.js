// Rule runner (ARCH §6.4): for each event, every rule that consumes its type
// gets the event added to its window and then evaluates the subject's state.
//
// Two keys per rule: `subject(e)` is who gets acted on (a source's ipHash:
// incidents, strikes, blocks, allowlist), and the optional `windowKey(e)` is
// what is counted (e.g. one socket). Firings are recorded per subject, so
// "R3a fired 3 times" still adds up when the attacker reconnects on a new socket.
//
// After a rule fires, its window for that key is cleared. Without that, the
// event after a threshold crossing would fire the rule again (and again), so
// "R1a fired twice in 15 min" would escalate to R1b at 6 failures instead of
// 10, and in-flight events would burn extra strikes on the ladder.

export const createRuleRunner = ({ rules, windows, getConfig, onDecision, log }) => ({
  async handle(event) {
    const config = getConfig();
    for (const rule of rules) {
      if (!rule.on.includes(event.type)) continue;
      const ruleCfg = config.rules[rule.id];
      if (!ruleCfg || ruleCfg.mode === 'off') continue;

      const subject = rule.subject(event);
      if (!subject) continue;

      const windowKey = rule.windowKey?.(event) ?? subject;
      windows.add(rule.id, windowKey, rule.measure(event, ruleCfg), event.ts, ruleCfg.windowMs);
      const decision = rule.evaluate(windows.view(windowKey, event.ts, subject), ruleCfg, event, config);
      if (!decision) continue;

      windows.recordFiring(rule.id, subject, event.ts);
      windows.reset(rule.id, windowKey);
      try {
        await onDecision({ rule, subject, decision, event, ruleCfg, config });
      } catch (err) {
        log?.error({ msg: 'remediation.failed', rule: rule.id, error: err?.message?.slice(0, 200) });
      }
    }
  },
});

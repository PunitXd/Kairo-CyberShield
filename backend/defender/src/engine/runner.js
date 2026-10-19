// Rule runner (ARCH §6.4): for each event, every rule that consumes its type
// gets the event added to its window and then evaluates the subject's state.
//
// After a rule fires, its window for that subject is cleared. Without that, the
// event after a threshold crossing would fire the rule again (and again), so
// "R1a fired twice in 15 min" would escalate to R1b at 6 failures instead of
// 10, and in-flight events would burn extra strikes on the ladder.

export const createRunner = ({ rules, windows, getConfig, onDecision, log }) => ({
  async handle(event) {
    const config = getConfig();
    for (const rule of rules) {
      if (!rule.on.includes(event.type)) continue;
      const ruleCfg = config.rules[rule.id];
      if (!ruleCfg || ruleCfg.mode === 'off') continue;

      const subject = rule.subject(event);
      if (!subject) continue;

      windows.add(rule.id, subject, rule.measure(event, ruleCfg), event.ts, ruleCfg.windowMs);
      const decision = rule.evaluate(windows.view(subject, event.ts), ruleCfg, event);
      if (!decision) continue;

      windows.recordFiring(rule.id, subject, event.ts);
      windows.reset(rule.id, subject);
      try {
        await onDecision({ rule, subject, decision, event, ruleCfg, config });
      } catch (err) {
        log?.error({ msg: 'remediation.failed', rule: rule.id, error: err?.message?.slice(0, 200) });
      }
    }
  },
});

// S6 Rules & safety (BRIEF §6, PHASES Oct 21 #3): Safety panel (kill switch,
// active-block cap, allowlist count) above the rules table. Each rule's mode
// is an Enforce / Shadow / Off SegmentedControl; moving to Enforce asks first
// in a ConfirmPopover, because it starts real blocking. Thresholds are
// read-only here (BRIEF D4; Flow E step 5 fallback). A change applies to the
// next event and arrives everywhere as config.updated.

import { useCallback, useRef, useState } from 'react';

import ConfirmPopover from '../../components/ConfirmPopover.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import KillSwitchControl from '../../components/KillSwitchControl.jsx';
import SegmentedControl from '../../components/SegmentedControl.jsx';
import { useConsole } from '../../hooks/useConsole.js';
import { useRules } from '../../hooks/useRules.js';
import { setRuleMode } from '../../services/api.service.js';
import { showToast } from '../../services/toast.service.js';
import { formatClock } from '../../utils/formatTime.js';
import { ENFORCE_EFFECT, MODE_LABEL, paramsText, thresholdText } from '../../utils/ruleText.js';
import { actionBlockedReason, isRedisDown, isStale } from '../../utils/systemState.js';

const MODES = ['enforce', 'shadow', 'off'];
const count = (n) => (n === null || n === undefined ? '—' : String(n));

function RuleRow({ rule, blockedReason, killSwitch, onChanged }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const triggerRef = useRef(null);

  const apply = async (mode) => {
    setBusy(true);
    setError(null);
    try {
      const r = await setRuleMode(rule.id, mode);
      if (confirming) {
        setConfirming(false);
        requestAnimationFrame(() => triggerRef.current?.focus()); // back to the Enforce button
      }
      showToast({ message: `${rule.id} is now ${MODE_LABEL[mode]} · config v${r.configVersion}` });
      onChanged();
    } catch (err) {
      const message = `Could not change ${rule.id}: ${err.message}`;
      if (confirming) setError(message);
      else showToast({ message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const onChange = (mode, button) => {
    if (mode === 'enforce') {
      triggerRef.current = button;
      setConfirming(true);
    } else apply(mode);
  };

  const cancel = useCallback(() => {
    setConfirming(false);
    setError(null);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const options = MODES.map((m) => ({
    value: m,
    label: MODE_LABEL[m],
    disabled: !rule.allowedModes.includes(m),
    reason: `${rule.id} cannot be set to ${MODE_LABEL[m]}`,
  }));
  const extra = paramsText(rule.params, rule.id);

  return (
    <tr>
      <th scope="row" className="rules__rule">
        <span className="mono">{rule.id}</span> <span className="rules__name">{rule.name}</span>
      </th>
      <td>
        <span className="mono">{thresholdText(rule)}</span>
        {extra && <span className="rules__params">{extra}</span>}
      </td>
      <td>
        <span className="rules__mode">
          <SegmentedControl
            label={`Mode for ${rule.id}`}
            options={options}
            value={rule.mode}
            onChange={onChange}
            disabled={Boolean(blockedReason) || busy}
            title={blockedReason ?? undefined}
          />
          {killSwitch && rule.mode === 'enforce' && <span className="rules__held">Shadow (kill switch)</span>}
          {confirming && (
            <ConfirmPopover
              id={`enforce-${rule.id}`}
              title={`Put ${rule.id} in Enforce?`}
              confirmLabel={`Enforce ${rule.id}`}
              tone="primary"
              busy={busy}
              error={error}
              onConfirm={() => apply('enforce')}
              onCancel={cancel}
            >
              <p>
                From the next event, {rule.id} {ENFORCE_EFFECT[rule.id] ?? 'acts on what it detects'}, with no one in the loop.
                {killSwitch ? ' The kill switch is on, so nothing is enforced until it is turned off.' : ''}
              </p>
            </ConfirmPopover>
          )}
        </span>
      </td>
      <td className="rules__num">{count(rule.fired7d)}</td>
      <td className="rules__num">{count(rule.falsePositives7d)}</td>
    </tr>
  );
}

export default function Rules() {
  const { connection, connectionSince, status } = useConsole();
  const stale = isStale(connection);
  const redisDown = isRedisDown(connection, status);
  const blockedReason = actionBlockedReason(connection, status);
  const killSwitch = Boolean(status?.killSwitch);
  const { data, error, loaded, reload } = useRules(connection, killSwitch);
  const safety = data?.safety;

  return (
    <section aria-labelledby="screen-title">
      <h1 id="screen-title" className="screen__title">
        Rules &amp; safety
      </h1>

      <section className="panel safety" aria-labelledby="safety-title">
        <h2 id="safety-title" className="panel__title">
          Safety
          {stale && <span className="stale-stamp">as of {formatClock(connectionSince)}</span>}
        </h2>
        <dl className="safety__grid">
          <div>
            <dt>Kill switch</dt>
            <dd>
              <span className={killSwitch ? 'safety__on' : undefined}>
                {status ? (killSwitch ? `On${status.killSwitchSince ? ` since ${formatClock(status.killSwitchSince)}` : ''}` : 'Off') : '—'}
              </span>
              <KillSwitchControl status={status} blockedReason={blockedReason} variant="panel" />
              <span className="safety__hint">{killSwitch ? 'Kairo is detecting but not acting.' : 'Stops all blocking at once; detection continues.'}</span>
            </dd>
          </div>
          <div>
            <dt>Active blocks</dt>
            <dd>
              <span className="safety__value mono">{redisDown || !safety ? '—' : `${count(safety.activeBlocks)} of ${safety.activeBlockCap}`}</span>
              <span className="safety__hint">Above the cap Kairo stops adding blocks and raises a critical incident.</span>
            </dd>
          </div>
          <div>
            <dt>Allowlisted sources</dt>
            <dd>
              <span className="safety__value mono">{redisDown || !safety ? '—' : count(safety.allowlisted)}</span>
              <span className="safety__hint">Never blocked while on the allowlist.</span>
            </dd>
          </div>
        </dl>
      </section>

      <section className="panel" aria-labelledby="rules-title">
        <h2 id="rules-title" className="panel__title">
          Rules {data && <span className="rules__version mono">config v{data.configVersion}</span>}
        </h2>
        {error && !loaded ? (
          <EmptyState hint={error.message}>Could not load the rules.</EmptyState>
        ) : !loaded ? (
          <EmptyState>Waiting for the Defender…</EmptyState>
        ) : (
          <div className="feed-scroll">
            <table className="rules__table">
              <thead>
                <tr>
                  <th scope="col">Rule</th>
                  <th scope="col">Threshold / window</th>
                  <th scope="col">Mode</th>
                  <th scope="col" className="rules__num">
                    Fired 7 d
                  </th>
                  <th scope="col" className="rules__num">
                    False positives 7 d
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((rule) => (
                  <RuleRow key={rule.id} rule={rule} blockedReason={blockedReason} killSwitch={killSwitch} onChanged={reload} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="rules__note">
          Thresholds are read-only here. They live in <span className="mono">backend/defender/config/rules.json</span>; rebuild the
          Defender to apply a change. Mode changes apply from the next event and last until the Defender restarts (demo:reset goes
          back to the file).
        </p>
      </section>
    </section>
  );
}

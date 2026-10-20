// Allowlist panel on the Blocklist (BRIEF Flow B, PHASES Oct 21 #4), collapsed
// by default. Each entry: hashed source, reason, where it came from, time
// left, Remove (no confirm: removing restores protection). Adding by IP is for
// presenter devices: the Defender hashes the IP and never stores it; because
// allowlisting reduces protection, adding asks first.

import { useCallback, useRef, useState } from 'react';

import ConfirmPopover from './ConfirmPopover.jsx';
import Countdown from './Countdown.jsx';
import EmptyState from './EmptyState.jsx';
import HashValue from './HashValue.jsx';
import { addAllowlist, removeAllowlist } from '../services/api.service.js';
import { showToast } from '../services/toast.service.js';
import { formatHash } from '../utils/formatHash.js';

const HOUR_OPTIONS = [1, 4, 12, 24];

function AddForm({ blockedReason }) {
  const [ip, setIp] = useState('');
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState(24);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submitRef = useRef(null);

  const close = useCallback(() => {
    setConfirming(false);
    setError(null);
    requestAnimationFrame(() => submitRef.current?.focus());
  }, []);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const { entry } = await addAllowlist({ ip: ip.trim(), hours, ...(reason.trim() ? { reason: reason.trim() } : {}) });
      showToast({ message: `Allowlisted ${formatHash('ip', entry.subject)} for ${hours} h` });
      setIp(''); // the raw IP leaves the page as soon as it is hashed
      setReason('');
      close();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="allowlist__form"
      onSubmit={(e) => {
        e.preventDefault();
        if (ip.trim()) setConfirming(true);
      }}
    >
      <label>
        <span>IP address</span>
        <input className="input mono" value={ip} onChange={(e) => setIp(e.target.value)} placeholder="192.168.1.42" autoComplete="off" spellCheck="false" />
      </label>
      <label>
        <span>Reason (no names or emails)</span>
        <input className="input" value={reason} maxLength={80} onChange={(e) => setReason(e.target.value)} placeholder="presenter phone" />
      </label>
      <label>
        <span>For</span>
        <select className="input" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          {HOUR_OPTIONS.map((h) => (
            <option key={h} value={h}>
              {h} h
            </option>
          ))}
        </select>
      </label>
      <span className="killswitch">
        <button type="submit" ref={submitRef} className="btn btn--secondary" disabled={!ip.trim() || Boolean(blockedReason)} title={blockedReason ?? undefined}>
          Allowlist
        </button>
        {confirming && (
          <ConfirmPopover id="allowlist-add" title={`Allowlist this IP for ${hours} h?`} confirmLabel={`Allowlist ${hours} h`} busy={busy} error={error} onConfirm={confirm} onCancel={close}>
            <p>Kairo will not block, throttle or disconnect this source for {hours} h. The IP is hashed by the Defender and not stored.</p>
          </ConfirmPopover>
        )}
      </span>
    </form>
  );
}

function AllowRow({ entry, now, blockedReason }) {
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await removeAllowlist(entry.subject);
      showToast({ message: `Removed ${formatHash('ip', entry.subject)} from the allowlist` });
    } catch (err) {
      showToast({ message: `Could not remove: ${err.message}`, tone: 'error' });
      setBusy(false);
    }
  };
  return (
    <tr>
      <td>
        <HashValue kind="ip" value={entry.subject} />
      </td>
      <td>{entry.reason ?? <span className="allowlist__muted">—</span>}</td>
      <td className="allowlist__muted">{entry.source === 'false_positive' ? 'False positive' : 'Added by hand'}</td>
      <td style={{ textAlign: 'right' }}>
        <Countdown expiresAt={entry.expiresAt} now={now} />
      </td>
      <td>
        <button type="button" className="btn btn--secondary" onClick={remove} disabled={busy || Boolean(blockedReason)} title={blockedReason ?? undefined}>
          {busy ? 'Removing…' : 'Remove'}
        </button>
      </td>
    </tr>
  );
}

export default function AllowlistPanel({ allowlist, now, blockedReason, redisDown }) {
  const { items, loaded, error } = allowlist;
  const live = items.filter((e) => e.expiresAt > now);
  return (
    <details className="panel allowlist">
      <summary className="allowlist__summary">
        Allowlist · {redisDown ? 'unknown' : loaded ? `${live.length} source${live.length === 1 ? '' : 's'}` : '…'}
      </summary>
      {redisDown ? (
        <EmptyState>Hidden while Redis is unreachable.</EmptyState>
      ) : error && !loaded ? (
        <EmptyState hint={error.message}>Could not load the allowlist.</EmptyState>
      ) : live.length === 0 ? (
        <EmptyState hint="Allowlisted sources are never blocked, throttled or disconnected until they expire.">Nothing allowlisted.</EmptyState>
      ) : (
        <div className="feed-scroll">
          <table className="feed">
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Reason</th>
                <th scope="col">From</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Time left
                </th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {live.map((e) => (
                <AllowRow key={e.subject} entry={e} now={now} blockedReason={blockedReason} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!redisDown && <AddForm blockedReason={blockedReason} />}
    </details>
  );
}

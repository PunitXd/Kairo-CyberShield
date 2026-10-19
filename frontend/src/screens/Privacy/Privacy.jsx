// S8 Metadata contract (BRIEF §6 S8, §11 fixes, principle 3). Two lists side
// by side, Received and Never received, then a live sample of the last 20 raw
// events, so anyone can watch an attack happen and see that the events hold
// hashes and counts, nothing else. Evidence, not a slogan.
//
// The Received list comes from GET /api/schema, which is generated from the
// strict zod schema the hooks and the Defender enforce. It describes what
// Kairo receives, and never claims anything about CypherFy's server (PRD Q11).

import { useEffect, useState } from 'react';

import EmptyState from '../../components/EmptyState.jsx';
import { getSchema } from '../../services/api.service.js';
import { useEventSample } from '../../hooks/useEventSample.js';
import { checkSample } from '../../utils/sampleCheck.js';
import { formatClock } from '../../utils/formatTime.js';

function SlashIcon() {
  return (
    <svg className="never__icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <circle cx="6" cy="6" r="4.5" />
      <path d="M2.8 9.2 9.2 2.8" />
    </svg>
  );
}

function CheckLine({ events }) {
  if (!events.length) return null;
  const c = checkSample(events);
  const found = [c.ipAddress && 'an IP address', c.email && 'an email', c.roomCode && 'a room code'].filter(Boolean);
  return found.length ? (
    <p className="sample__check sample__check--bad" role="alert">
      Found {found.join(', ')} in these {c.count} events. This should never happen.
    </p>
  ) : (
    <p className="sample__check">
      Checked these {c.count} events: no IP address, no email, no room code.
    </p>
  );
}

export default function Privacy() {
  const [contract, setContract] = useState(null);
  const [contractError, setContractError] = useState(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const { items, loaded, error, updatedAt } = useEventSample({ paused });

  useEffect(() => {
    getSchema().then(setContract, setContractError);
  }, []);

  return (
    <section aria-labelledby="screen-title">
      <h1 id="screen-title" className="screen__title">
        Privacy
      </h1>
      <p className="privacy__lead">
        The Defender receives <strong>metadata only</strong>: hashes, counts, routes and status codes.{' '}
        {contract && <span className="privacy__hashing">Identifiers are {contract.hashing}.</span>}
      </p>

      <div className="privacy-grid">
        <section className="panel" aria-labelledby="received-title">
          <h2 id="received-title" className="panel__title">
            Received
          </h2>
          {contractError ? (
            <EmptyState hint={contractError.message}>Could not load the event contract.</EmptyState>
          ) : !contract ? (
            <EmptyState>Loading…</EmptyState>
          ) : (
            <div className="feed-scroll">
              <table className="contract">
                <thead>
                  <tr>
                    <th scope="col">Field</th>
                    <th scope="col">Type</th>
                    <th scope="col">Carried by</th>
                    <th scope="col">Example</th>
                  </tr>
                </thead>
                <tbody>
                  {contract.received.map((f) => (
                    <tr key={f.field}>
                      <td>
                        <span className="mono contract__field">{f.field}</span>
                        {!f.required && <span className="contract__optional"> optional</span>}
                        <span className="contract__note">{f.note}</span>
                      </td>
                      <td className="contract__type mono">{f.type}</td>
                      <td className="contract__carried mono">{f.carriedBy.join(', ')}</td>
                      <td className="mono contract__example">{JSON.stringify(f.example)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel" aria-labelledby="never-title">
          <h2 id="never-title" className="panel__title">
            Never received
          </h2>
          {contract && (
            <ul className="never">
              {contract.neverReceived.map((n) => (
                <li key={n.item} className="never__item">
                  <SlashIcon />
                  <span className="never__name">{n.item}</span>
                  <span className="never__note">{n.note}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="panel sample" aria-labelledby="sample-title">
        <div className="sample__head">
          <h2 id="sample-title" className="panel__title">
            Live sample · last 20 events
          </h2>
          <span className={`sample__status${paused ? ' sample__status--paused' : ''}`}>
            {paused ? 'Paused while you read · move away to resume' : updatedAt ? `Updating every 2 s · ${formatClock(updatedAt)}` : 'Starting…'}
          </span>
        </div>
        <CheckLine events={items} />
        {error && !items.length ? (
          <EmptyState hint={error.message}>Could not load events.</EmptyState>
        ) : loaded && !items.length ? (
          <EmptyState hint="Events appear here as CypherFy answers logins and room lookups.">No events yet.</EmptyState>
        ) : (
          <pre
            className="sample__events mono"
            tabIndex={0}
            aria-label="Last 20 raw events as JSON. Updates pause while this is focused."
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          >
            {items.map((e) => JSON.stringify(e)).join('\n')}
          </pre>
        )}
      </section>

      <p className="privacy__scope">{contract?.scope ?? "This describes what Kairo Shield receives. CypherFy's own encryption model is documented separately."}</p>
    </section>
  );
}

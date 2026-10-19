// S4 Blocklist (BRIEF §6): every active block and throttle, with Unblock.
// Placeholder from the dashboard shell (Oct 20 task 3); built in Oct 21 task 5.

import EmptyState from '../../components/EmptyState.jsx';

export default function Blocklist() {
  return (
    <section aria-labelledby="screen-title">
      <h1 id="screen-title" className="screen__title">
        Blocklist
      </h1>
      <div className="panel">
        <EmptyState hint="Unblock with a 10-second Undo lands on Oct 21.">Active blocks will be listed here.</EmptyState>
      </div>
    </section>
  );
}

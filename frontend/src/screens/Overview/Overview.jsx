// S1 Overview (BRIEF §6): KPI strip, incident feed, active blocks rail.
// Placeholder from the dashboard shell (Oct 20 task 3); built in Oct 20 task 4.

import EmptyState from '../../components/EmptyState.jsx';

export default function Overview() {
  return (
    <section aria-labelledby="screen-title">
      <h1 id="screen-title" className="screen__title">
        Overview
      </h1>
      <div className="panel">
        <EmptyState hint="The KPI strip, incident feed and active blocks arrive in the next build step.">Kairo is watching. Nothing to show here yet.</EmptyState>
      </div>
    </section>
  );
}

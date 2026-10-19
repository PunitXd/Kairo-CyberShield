// S5 Pipeline (BRIEF §6): security checks per commit, redacted findings.
// Placeholder from the dashboard shell (Oct 20 task 3); built in Oct 22 task 2.

import EmptyState from '../../components/EmptyState.jsx';

export default function Pipeline() {
  return (
    <section aria-labelledby="screen-title">
      <h1 id="screen-title" className="screen__title">
        Pipeline
      </h1>
      <div className="panel">
        <EmptyState hint="The GitHub Actions poller lands on Oct 22.">Pipeline runs will be listed here.</EmptyState>
      </div>
    </section>
  );
}

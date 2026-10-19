// S8 Metadata contract (BRIEF §6): received / never received fields and a live sample of raw events.
// Placeholder from the dashboard shell (Oct 20 task 3); built in Oct 21 task 3.

import EmptyState from '../../components/EmptyState.jsx';

export default function Privacy() {
  return (
    <section aria-labelledby="screen-title">
      <h1 id="screen-title" className="screen__title">
        Privacy
      </h1>
      <div className="panel">
        <EmptyState hint="The full field list and a live sample of raw events land on Oct 21.">The Defender receives metadata only: hashes, counts, routes and status codes.</EmptyState>
      </div>
    </section>
  );
}

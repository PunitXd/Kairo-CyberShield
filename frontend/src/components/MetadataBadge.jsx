// "Metadata only" — persistent, never hidden (BRIEF principle 3). It claims
// what the Defender receives, not that CypherFy's server can't read messages
// (PRD Q11), and opens the event contract so the claim can be checked.

import { Link } from 'react-router';

export default function MetadataBadge() {
  return (
    <Link
      to="/privacy"
      className="metadata-badge"
      title="The Defender receives metadata only. Open the event contract to see every field it receives."
    >
      Metadata only
    </Link>
  );
}

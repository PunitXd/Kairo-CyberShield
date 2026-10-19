// 48 px top bar (BRIEF §6), left to right: wordmark (D10: text, no shield
// icon), environment chip, connection status, Metadata only badge.
// The degraded and Protection paused bands join on Oct 22.

import { Link } from 'react-router';

import EnvChip from './EnvChip.jsx';
import ConnectionStatus from './ConnectionStatus.jsx';
import MetadataBadge from './MetadataBadge.jsx';
import KillSwitchControl from './KillSwitchControl.jsx';

export default function TopBar({ console: consoleState }) {
  return (
    <header className="topbar">
      <Link to="/" className="topbar__wordmark">
        Kairo Shield
      </Link>
      <EnvChip
        status={consoleState.status}
        stale={consoleState.connection !== 'live'}
        statusAt={consoleState.statusAt}
      />
      <ConnectionStatus {...consoleState} />
      <span className="topbar__spacer" />
      <MetadataBadge />
      <KillSwitchControl status={consoleState.status} disabled={consoleState.connection !== 'live'} />
    </header>
  );
}

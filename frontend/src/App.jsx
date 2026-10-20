// App shell (BRIEF §6): top bar, left nav, main area. One /console socket for
// the whole page, shared through useConsole().

import { Route, Routes } from 'react-router';

import TopBar from './components/TopBar.jsx';
import SideNav from './components/SideNav.jsx';
import EmptyState from './components/EmptyState.jsx';
import ToastHost from './components/ToastHost.jsx';
import Banner from './components/Banner.jsx';
import KillSwitchControl from './components/KillSwitchControl.jsx';
import { formatClock } from './utils/formatTime.js';
import { actionBlockedReason, isStale, systemBanner } from './utils/systemState.js';
import Overview from './screens/Overview/Overview.jsx';
import IncidentDrawer from './screens/Overview/IncidentDrawer.jsx';
import Blocklist from './screens/Blocklist/Blocklist.jsx';
import Pipeline from './screens/Pipeline/Pipeline.jsx';
import Privacy from './screens/Privacy/Privacy.jsx';
import Rules from './screens/Rules/Rules.jsx';
import { useConsole } from './hooks/useConsole.js';

function NotFound() {
  return (
    <div className="panel">
      <EmptyState hint="Use the navigation on the left.">This page doesn't exist.</EmptyState>
    </div>
  );
}

export default function App() {
  const consoleState = useConsole();
  // BRIEF §8: Defender unreachable ≥ 10 s or Redis unreachable. Neither can be dismissed.
  const band = systemBanner(consoleState, formatClock);
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <div className="shell">
        <TopBar console={consoleState} />
        <SideNav />
        <main id="main" className={`shell__main${isStale(consoleState.connection) ? ' shell__main--stale' : ''}`} tabIndex={-1}>
          {band && <Banner tone={band.tone}>{band.text}</Banner>}
          {consoleState.status?.killSwitch && (
            <Banner
              tone="critical"
              action={<KillSwitchControl status={consoleState.status} blockedReason={actionBlockedReason(consoleState.connection, consoleState.status)} variant="banner" />}
            >
              Kill switch on{consoleState.status.killSwitchSince ? ` since ${formatClock(consoleState.status.killSwitchSince)}` : ''}. Kairo is detecting but not acting.
            </Banner>
          )}
          <Routes>
            <Route path="/" element={<Overview />}>
              <Route path="incidents/:id" element={<IncidentDrawer />} />
            </Route>
            <Route path="/blocks" element={<Blocklist />} />
            <Route path="/pipeline/:runId?" element={<Pipeline />} />
            <Route path="/rules" element={<Rules />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
      <ToastHost />
    </>
  );
}

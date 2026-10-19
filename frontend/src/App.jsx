// App shell (BRIEF §6): top bar, left nav, main area. One /console socket for
// the whole page, shared through useConsole().

import { Route, Routes } from 'react-router';

import TopBar from './components/TopBar.jsx';
import SideNav from './components/SideNav.jsx';
import EmptyState from './components/EmptyState.jsx';
import ToastHost from './components/ToastHost.jsx';
import Overview from './screens/Overview/Overview.jsx';
import IncidentDrawer from './screens/Overview/IncidentDrawer.jsx';
import Blocklist from './screens/Blocklist/Blocklist.jsx';
import Pipeline from './screens/Pipeline/Pipeline.jsx';
import Privacy from './screens/Privacy/Privacy.jsx';
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
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <div className="shell">
        <TopBar console={consoleState} />
        <SideNav />
        <main id="main" className="shell__main" tabIndex={-1}>
          <Routes>
            <Route path="/" element={<Overview />}>
              <Route path="incidents/:id" element={<IncidentDrawer />} />
            </Route>
            <Route path="/blocks" element={<Blocklist />} />
            <Route path="/pipeline" element={<Pipeline />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
      <ToastHost />
    </>
  );
}

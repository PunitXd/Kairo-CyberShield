// Left nav, 200 px (BRIEF §6). Labels per decision D12. Incidents and Rules &
// safety joined on Oct 21, Deployments on Oct 22 (PHASES §3).

import { NavLink } from 'react-router';

export const NAV_ITEMS = [
  { to: '/', label: 'Overview', end: true },
  { to: '/incidents', label: 'Incidents', end: true },
  { to: '/blocks', label: 'Blocklist' },
  { to: '/pipeline', label: 'Pipeline' },
  { to: '/deployments', label: 'Deployments' },
  { to: '/rules', label: 'Rules' },
  { to: '/privacy', label: 'Privacy' },
];

export default function SideNav() {
  return (
    <nav className="sidenav" aria-label="Main">
      <ul className="sidenav__list">
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink to={item.to} end={item.end} className="sidenav__link">
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

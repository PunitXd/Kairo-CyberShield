// An active block or throttle on the rail (BRIEF §6 S1, §7). The feed
// explains; the rail is where you reverse. Unblock is wired on Oct 21 (with a
// 10 s Undo toast); until then the button is present but disabled.

import ActionPill from './ActionPill.jsx';
import Countdown from './Countdown.jsx';
import HashValue from './HashValue.jsx';

export default function BlockCard({ block, now }) {
  return (
    <li className="block-card">
      <div className="block-card__top">
        <HashValue kind="ip" value={block.subject} />
        <span className="block-card__rule mono">{block.rule ?? '—'}</span>
      </div>
      <div className="block-card__bottom">
        <ActionPill state={block.level === 'block' ? 'blocked' : 'throttled'} scope={block.scope} />
        <Countdown expiresAt={block.expiresAt} now={now} />
        <button type="button" className="btn btn--secondary" disabled title="Unblock with a 10-second Undo lands on Oct 21">
          Unblock
        </button>
      </div>
    </li>
  );
}

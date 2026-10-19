// One-click unblock with an Undo toast, shared by the block cards and the
// incident drawer. Unblocking reduces enforcement, so there is no confirm
// (BRIEF principle 1). Nothing is removed until the Defender confirms; a
// failure keeps everything in place and returns the reason for an inline error.

import { useCallback, useState } from 'react';

import { deleteBlock, undoUnblock } from '../services/api.service.js';
import { showToast } from '../services/toast.service.js';
import { formatHash } from '../utils/formatHash.js';
import { SCOPE_LABEL } from '../utils/incidentState.js';

export const useUnblock = ({ scope, subject, onUnblocked }) => {
  const [state, setState] = useState('idle'); // idle | unblocking | failed
  const [error, setError] = useState(null);
  const label = `${formatHash('ip', subject)} · ${SCOPE_LABEL[scope] ?? scope}`;

  const undo = useCallback(
    async (undoToken) => {
      try {
        const { restored } = await undoUnblock(undoToken);
        showToast({ message: restored ? `Restored ${label}` : `Nothing to restore for ${label}: it would have expired`, durationMs: 4000 });
      } catch (err) {
        showToast({
          message: err.code === 'UNDO_EXPIRED' ? 'Undo window passed: the block stays lifted' : `Undo failed: ${err.message}`,
          tone: 'error',
          durationMs: 6000,
        });
      }
    },
    [label]
  );

  const unblock = useCallback(async () => {
    setState('unblocking');
    setError(null);
    try {
      const { undoToken } = await deleteBlock(scope, subject);
      setState('idle');
      onUnblocked?.({ scope, subject });
      showToast({ message: `Unblocked ${label}`, action: { label: 'Undo', onAction: () => undo(undoToken) } });
    } catch (err) {
      if (err.status === 404) {
        setState('idle');
        onUnblocked?.({ scope, subject }); // already lifted (expired or unblocked elsewhere)
        return;
      }
      setState('failed');
      setError(err.message);
    }
  }, [scope, subject, label, onUnblocked, undo]);

  return { state, error, unblock, label };
};

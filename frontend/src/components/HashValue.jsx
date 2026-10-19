// A hashed identifier, never a raw one (BRIEF principle 3): "ip:3e9a…c1" in
// mono, the full 16-hex hash in the tooltip, and a copy button. Values that
// aren't 16-hex hashes render as "ip:invalid" and can't be copied.

import { useState } from 'react';

import { formatHash, isHash } from '../utils/formatHash.js';

export default function HashValue({ kind = 'ip', value }) {
  const [copied, setCopied] = useState(false);
  const valid = isHash(value);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${kind}:${value}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable; nothing to do */
    }
  };

  return (
    <span className="hash">
      <span className="hash__value mono" title={valid ? `${kind}:${value}` : undefined}>
        {formatHash(kind, value)}
      </span>
      {valid && (
        <button type="button" className="hash__copy" onClick={copy} aria-label={`Copy full ${kind} hash`}>
          {copied ? 'copied' : 'copy'}
        </button>
      )}
    </span>
  );
}

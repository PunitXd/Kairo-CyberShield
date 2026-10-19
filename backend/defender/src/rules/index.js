// Rule registry (ARCH §6.5). Order matters: R1a runs before R1b on the same
// event, so R1b sees R1a's firing when deciding on "fired twice in 15 min".
// R2a (Oct 20) joins here; its config block already exists in rules.json.

import r1a from './r1a-auth-soft.js';
import r1b from './r1b-credential-stuffing.js';

export const rules = [r1a, r1b];

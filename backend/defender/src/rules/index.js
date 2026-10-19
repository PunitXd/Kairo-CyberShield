// Rule registry (ARCH §6.5). Order matters: R1a runs before R1b on the same
// event, so R1b sees R1a's firing when deciding on "fired twice in 15 min".
// R2a (Oct 20) joins here; its config block already exists in rules.json.

import { r1aAuthSoft } from './r1aAuthSoft.rule.js';
import { r1bCredentialStuffing } from './r1bCredentialStuffing.rule.js';

export const rules = [r1aAuthSoft, r1bCredentialStuffing];

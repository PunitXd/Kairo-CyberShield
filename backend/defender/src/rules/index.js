// Rule registry (ARCH §6.5). Order matters: a soft rule runs before its hard
// step on the same event (R1a before R1b, R3a before R3b), so the hard step
// sees the soft firing when counting "fired N times".

import { r1aAuthSoft } from './r1aAuthSoft.rule.js';
import { r1bCredentialStuffing } from './r1bCredentialStuffing.rule.js';
import { r1cAppThrottle } from './r1cAppThrottle.rule.js';
import { r2aRoomGuess } from './r2aRoomGuess.rule.js';
import { r3aFloodSoft } from './r3aFloodSoft.rule.js';
import { r3bFloodHard } from './r3bFloodHard.rule.js';
import { r3cConnFlood } from './r3cConnFlood.rule.js';
import { r3dBadPayload } from './r3dBadPayload.rule.js';

export const rules = [r1aAuthSoft, r1bCredentialStuffing, r1cAppThrottle, r2aRoomGuess, r3aFloodSoft, r3dBadPayload, r3bFloodHard, r3cConnFlood];

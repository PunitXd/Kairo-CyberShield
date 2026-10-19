// Body for POST /api/killswitch (ARCH §9.2).

import { z } from 'zod';

export const killSwitchBodySchema = z.strictObject({
  on: z.boolean(),
});

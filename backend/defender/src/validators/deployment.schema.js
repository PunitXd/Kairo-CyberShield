// /api/deployments and /api/rollback (ARCH §9.2). Tags are git SHAs only, so
// nothing else can ever reach `docker compose` through the deployer.

import { z } from 'zod';

import { DEPLOY_TAG_RE } from '../defender.constant.js';

const zUlid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);

export const deploymentParamsSchema = z.strictObject({ id: zUlid });
export const createDeploymentSchema = z.strictObject({ tag: z.string().regex(DEPLOY_TAG_RE, 'tag must be a git SHA (7–40 hex)') });
export const deploymentStatusSchema = z.strictObject({
  op: z.enum(['deploy', 'rollback']),
  state: z.enum(['accepted', 'started', 'failed']),
  actionId: zUlid.nullable().optional(),
  error: z.string().max(200).optional(),
});
export const deploymentQuerySchema = z.strictObject({ limit: z.coerce.number().int().min(1).max(50).default(20) });

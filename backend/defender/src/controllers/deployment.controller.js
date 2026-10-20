// /api/deployments and /api/rollback/unfreeze (ARCH §9.2, R4).

import { asyncHandler } from '../utils/asyncHandler.js';
import { withRedis } from '../utils/withRedis.js';
import { DeployError } from '../services/deploy.service.js';
import { createDeploymentSchema, deploymentParamsSchema, deploymentQuerySchema, deploymentStatusSchema } from '../validators/deployment.schema.js';

const deployErrors = (fn) =>
  asyncHandler(async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      if (err instanceof DeployError) {
        res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
        return;
      }
      throw err;
    }
  });

const service = (req) => {
  const s = req.app.locals.kairo.deploys;
  if (!s) throw new DeployError(503, 'DEPLOYS_OFF', 'Deployments are not tracked (CYPHERFY_HEALTH_URL is not set)');
  return s;
};

// GET /api/deployments → { items, current, rollback, health }
export const listDeployments = deployErrors(async (req, res) => {
  const { limit } = deploymentQuerySchema.parse(req.query);
  res.json(await withRedis(req.app.locals.kairo.redis, () => service(req).list({ limit })));
});

// POST /api/deployments { tag } (deploy token) → 201 { id, tag, prevTag }
export const createDeployment = deployErrors(async (req, res) => {
  const { tag } = createDeploymentSchema.parse(req.body ?? {});
  const doc = await withRedis(req.app.locals.kairo.redis, () => service(req).create({ tag }));
  res.status(201).json({ id: doc._id, tag: doc.tag, prevTag: doc.prevTag });
});

// POST /api/deployments/:id/status { op, state, actionId?, error? } (deploy token) → 200
export const reportDeployment = deployErrors(async (req, res) => {
  const { id } = deploymentParamsSchema.parse(req.params);
  const body = deploymentStatusSchema.parse(req.body ?? {});
  const doc = await service(req).report(id, body);
  res.json({ id, status: doc?.status ?? null });
});

// POST /api/deployments/:id/rollback (operator) → 202 { requested, toTag }
export const rollbackDeployment = deployErrors(async (req, res) => {
  const { id } = deploymentParamsSchema.parse(req.params);
  res.status(202).json(await withRedis(req.app.locals.kairo.redis, () => service(req).manualRollback(id, { actorIp: req.ip })));
});

// POST /api/rollback/unfreeze (operator) → 200 { changed }
export const unfreezeRollback = deployErrors(async (req, res) => {
  res.json(await withRedis(req.app.locals.kairo.redis, () => service(req).unfreeze({ actorIp: req.ip })));
});

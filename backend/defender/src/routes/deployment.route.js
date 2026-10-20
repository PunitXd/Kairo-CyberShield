// /api/deployments (ARCH §9.2). POST / and /:id/status are for deploy.sh and
// the host deployer (X-Kairo-Deploy-Token); the rest are console routes.

import { Router } from 'express';

import { createDeployment, listDeployments, reportDeployment, rollbackDeployment } from '../controllers/deployment.controller.js';
import { requireDeployToken } from '../middlewares/deployToken.middleware.js';

const router = Router();

router.get('/', listDeployments);
router.post('/', requireDeployToken, createDeployment);
router.post('/:id/status', requireDeployToken, reportDeployment);
router.post('/:id/rollback', rollbackDeployment);

export default router;

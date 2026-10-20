// /api/rollback (ARCH §9.2)

import { Router } from 'express';

import { unfreezeRollback } from '../controllers/deployment.controller.js';

const router = Router();

router.post('/unfreeze', unfreezeRollback);

export default router;

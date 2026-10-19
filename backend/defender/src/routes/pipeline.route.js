// /api/pipeline (ARCH §9.2)

import { Router } from 'express';

import { getRun, listRuns } from '../controllers/pipeline.controller.js';

const router = Router();

router.get('/runs', listRuns);
router.get('/runs/:id', getRun);

export default router;

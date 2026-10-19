// /api/overview (ARCH §9.2)

import { Router } from 'express';

import { getOverview } from '../controllers/overview.controller.js';

const router = Router();

router.get('/', getOverview);

export default router;

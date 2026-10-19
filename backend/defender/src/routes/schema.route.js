// /api/schema (ARCH §9.2)

import { Router } from 'express';

import { getSchema } from '../controllers/event.controller.js';

const router = Router();

router.get('/', getSchema);

export default router;

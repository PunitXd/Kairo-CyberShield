// /api/rates (ARCH §9.3)

import { Router } from 'express';

import { getRates } from '../controllers/rates.controller.js';

const router = Router();

router.get('/', getRates);

export default router;

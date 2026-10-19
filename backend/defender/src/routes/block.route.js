// /api/blocks (ARCH §9.2)

import { Router } from 'express';

import { getBlocks } from '../controllers/block.controller.js';

const router = Router();

router.get('/', getBlocks);

export default router;

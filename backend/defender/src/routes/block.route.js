// /api/blocks (ARCH §9.2)

import { Router } from 'express';

import { deleteBlock, getBlocks, undoUnblock } from '../controllers/block.controller.js';

const router = Router();

router.get('/', getBlocks);
router.post('/undo', undoUnblock);
router.delete('/:scope/:subject', deleteBlock);

export default router;

// /api/allowlist (ARCH §9.2)

import { Router } from 'express';

import { addAllowlist, listAllowlist, removeAllowlist } from '../controllers/allowlist.controller.js';

const router = Router();

router.get('/', listAllowlist);
router.post('/', addAllowlist);
router.delete('/:subject', removeAllowlist);

export default router;

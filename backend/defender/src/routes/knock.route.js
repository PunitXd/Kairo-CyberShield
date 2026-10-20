// /api/knock (ARCH §9.2)

import { Router } from 'express';

import { deleteKnock } from '../controllers/knock.controller.js';

const router = Router();

router.delete('/:codeHash', deleteKnock);

export default router;

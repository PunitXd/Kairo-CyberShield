// /api/killswitch (ARCH §9.2)

import { Router } from 'express';

import { setKillSwitch } from '../controllers/killswitch.controller.js';

const router = Router();

router.post('/', setKillSwitch);

export default router;

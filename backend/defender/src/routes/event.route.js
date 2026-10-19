// /api/events (ARCH §9.2)

import { Router } from 'express';

import { getEventSample } from '../controllers/event.controller.js';

const router = Router();

router.get('/sample', getEventSample);

export default router;

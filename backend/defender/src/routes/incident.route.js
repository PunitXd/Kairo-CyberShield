// /api/incidents (ARCH §9.2)

import { Router } from 'express';

import { listIncidents } from '../controllers/incident.controller.js';

const router = Router();

router.get('/', listIncidents);

export default router;

// /api/incidents (ARCH §9.2)

import { Router } from 'express';

import { getIncident, listIncidents } from '../controllers/incident.controller.js';

const router = Router();

router.get('/', listIncidents);
router.get('/:id', getIncident);

export default router;

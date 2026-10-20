// /api/incidents (ARCH §9.2)

import { Router } from 'express';

import { getIncident, getIncidentSeries, listIncidents, markFalsePositive } from '../controllers/incident.controller.js';

const router = Router();

router.get('/', listIncidents);
router.get('/:id', getIncident);
router.get('/:id/series', getIncidentSeries);
router.post('/:id/false-positive', markFalsePositive);

export default router;

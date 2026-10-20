// /api/rules (ARCH §9.2)

import { Router } from 'express';

import { listRules, setRuleMode } from '../controllers/rule.controller.js';

const router = Router();

router.get('/', listRules);
router.patch('/:id', setRuleMode);

export default router;

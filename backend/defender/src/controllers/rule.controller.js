// /api/rules (ARCH §9.2): the rules with config and 7-day counts, and mode changes.

import { ZodError } from 'zod';

import { asyncHandler } from '../utils/asyncHandler.js';
import { ruleModeBodySchema, ruleParamsSchema } from '../validators/ruleMode.schema.js';
import { RuleNotFoundError } from '../services/rule.service.js';

// GET /api/rules → { configVersion, configPath, safety, items }
export const listRules = asyncHandler(async (req, res) => {
  res.json(await req.app.locals.kairo.ruleService.list());
});

// PATCH /api/rules/:id { mode } → 200 { configVersion, rule, changed }
export const setRuleMode = asyncHandler(async (req, res) => {
  const { id } = ruleParamsSchema.parse(req.params);
  const { mode } = ruleModeBodySchema.parse(req.body ?? {});
  try {
    res.json(await req.app.locals.kairo.ruleService.setMode(id, mode, { actorIp: req.ip }));
  } catch (err) {
    if (err instanceof RuleNotFoundError) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: `No rule ${id}` } });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({ error: { code: 'MODE_NOT_ALLOWED', message: `${id} cannot be set to ${mode}` } });
      return;
    }
    throw err;
  }
});

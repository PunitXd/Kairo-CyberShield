// X-Kairo-Deploy-Token for the script-only routes (ARCH §9.1): deploy.sh and
// the host deployer. Compared in constant time; without KAIRO_DEPLOY_TOKEN
// (≥ 32 characters) the routes are off, never open.

import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (s) => createHash('sha256').update(String(s)).digest();

export const requireDeployToken = (req, res, next) => {
  const expected = req.app.locals.kairo.deployToken;
  if (!expected || expected.length < 32) {
    return res.status(503).json({ error: { code: 'DEPLOY_DISABLED', message: 'KAIRO_DEPLOY_TOKEN is not set for the Defender' } });
  }
  const given = req.get('x-kairo-deploy-token') ?? '';
  if (!timingSafeEqual(digest(given), digest(expected))) {
    return res.status(401).json({ error: { code: 'BAD_DEPLOY_TOKEN', message: 'Missing or wrong X-Kairo-Deploy-Token' } });
  }
  return next();
};

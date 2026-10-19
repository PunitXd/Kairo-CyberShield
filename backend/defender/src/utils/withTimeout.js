/** Reject if `promise` hasn't settled within `ms` (used for health probes). */
export const withTimeout = (promise, ms, what = 'operation') => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

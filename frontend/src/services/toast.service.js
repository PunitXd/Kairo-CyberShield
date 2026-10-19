// Tiny toast store (BRIEF §7 Toast): bottom-left, auto-dismiss after 10 s,
// paused while hovered or focused, at most 3 on screen. Components read it
// with useToasts(); anything can call showToast().

const MAX_TOASTS = 3;
export const TOAST_MS = 10_000;

let nextId = 1;
let toasts = [];
const listeners = new Set();

const emit = () => {
  for (const listener of listeners) listener();
};

/**
 * @param {{ message: string, action?: { label: string, onAction: () => void }, tone?: 'info'|'error', durationMs?: number }} toast
 * @returns {number} toast id
 */
export const showToast = ({ message, action, tone = 'info', durationMs = TOAST_MS }) => {
  const id = nextId++;
  toasts = [...toasts, { id, message, action, tone, durationMs }].slice(-MAX_TOASTS);
  emit();
  return id;
};

export const dismissToast = (id) => {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
};

export const subscribeToasts = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getToasts = () => toasts;

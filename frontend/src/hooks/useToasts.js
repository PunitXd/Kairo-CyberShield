import { useSyncExternalStore } from 'react';

import { getToasts, subscribeToasts } from '../services/toast.service.js';

export const useToasts = () => useSyncExternalStore(subscribeToasts, getToasts);

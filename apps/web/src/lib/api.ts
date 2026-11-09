//apps/web/src/lib/api.ts
import { createApiClient } from './api-client';
import { emitSessionExpired } from './session-events';

export const api = createApiClient({ baseUrl: '/api', onUnauthenticated: emitSessionExpired });

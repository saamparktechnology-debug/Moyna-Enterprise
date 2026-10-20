const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export const IDLE_TIMEOUT_MS = 30 * MINUTE_MS;
export const ABSOLUTE_TIMEOUT_MS = 12 * HOUR_MS;
export const LAST_SEEN_REFRESH_MS = MINUTE_MS;
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * MINUTE_MS;
export const IP_FAILURE_LIMIT = 20;
export const IP_WINDOW_MS = 15 * MINUTE_MS;
export const CSRF_HEADER = 'x-csrf-token';
export const GENERIC_LOGIN_ERROR = 'Invalid username or password';

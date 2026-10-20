# Authentication (Stage 3, module 3.1)

## How a request is checked

Three global guards run on every request, in this order, then an interceptor:

1. **Sign-in guard.** Looks up the session cookie. No valid session means `401`. A user whose account says "must change password" gets `403 PASSWORD_CHANGE_REQUIRED` everywhere except the session, change-password and logout endpoints.
2. **CSRF guard.** Every `POST`, `PUT`, `PATCH` and `DELETE` must come from the application origin (`WEB_ORIGIN`) and, once signed in, carry the user's token in the `X-CSRF-Token` header. The token is returned by `POST /auth/login`, `GET /auth/session` and `POST /auth/change-password`.
3. **Permission guard.** The endpoint must declare one of `@Public()`, `@Authenticated()` or `@RequirePermission('x.y')`. An endpoint with none of them is refused, so forgetting a rule can never leave an endpoint open. A test fails the build if a real endpoint has no rule.
4. **Branch context.** After the guards, the request runs inside the user's branch context, so every database query is limited to their branches (see `docs/DATABASE.md`).

## Sessions

- The cookie holds a random 256-bit token. Only its SHA-256 is stored, so a database leak does not reveal live sessions.
- Every login creates a new session. Idle timeout 30 minutes, absolute limit 12 hours. A session also ends when the user is deactivated, or after logout or a password change.
- Cookie: `HttpOnly`, `SameSite=Lax`, path `/`. In production it is also `Secure` and named `__Host-erp_session`.
- The CSRF token is an HMAC of the session id with `SESSION_SECRET`, so it needs no storage.
- Permissions and branches are read on every request, so a change to a role applies at once.

## Passwords

Argon2id. 12 to 128 characters; not on the common-password list, not a simple sequence or repetition, and not containing the username or email name. There are no "needs a symbol" rules.

Five failed sign-ins lock the account for 15 minutes. Twenty failed sign-ins from one address in 15 minutes block that address. A wrong password and an unknown user get the same message; a locked account says so (a deliberate trade-off so people know to wait). Behind Nginx, the client address is the first forwarded hop (`trust proxy` is set in production only).

## Endpoints

| Endpoint                              | Who                     | What                                                                                       |
| ------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------ |
| `POST /auth/login`                    | public (origin checked) | sign in, sets the cookie                                                                   |
| `POST /auth/logout`                   | public (origin checked) | ends the session, clears the cookie                                                        |
| `GET /auth/session`                   | signed in               | current user, permissions, branches, CSRF token                                            |
| `POST /auth/change-password`          | signed in               | changes the password, ends every other session, starts a fresh one                         |
| `POST /auth/users/:id/reset-password` | `users.reset_password`  | server-generated temporary password, shown once; the person must change it at next sign-in |

Who may reset whom follows the level rules in `docs/USERS_AND_ROLES.md`: a Super Admin can reset Admins and Staff (not other Super Admins), an Admin can reset Staff who share a branch with them, nobody can reset themselves.

## Audit

`LOGIN`, `LOGIN_FAILED` (with a reason, never what was typed), `LOGOUT`, `PASSWORD_CHANGED` and `PASSWORD_RESET` are written with the user, address, browser and request id. Passwords and tokens never appear in logs or audit rows.

## Configuration

`SESSION_SECRET` (at least 32 random characters, different in every environment) is required. Rotating it signs nobody out but invalidates every CSRF token until the page is reloaded.

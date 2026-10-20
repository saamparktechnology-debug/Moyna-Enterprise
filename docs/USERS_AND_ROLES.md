# Users, roles and permissions (Stage 3, module 3.3)

## The three levels

Every role has a **level** (its tier), fixed when the role is created: **Super Admin**, **Admin** or **Staff**. A person may manage someone only when their own level is strictly higher.

| Who         | May manage                                     | Branches they can hand out |
| ----------- | ---------------------------------------------- | -------------------------- |
| Super Admin | Admins and Staff, in any branch                | any active branch          |
| Admin       | Staff who share at least one of their branches | only their own             |
| Staff       | nobody, whatever permissions their role holds  | none                       |

"Manage" means create, edit, reset the password of, deactivate and reactivate. The same rule applies to password resets (`POST /auth/users/:id/reset-password`).

Other rules:

- **No Super Admins through the screens.** They are created only by the seed. Nobody can change their own role, branches or status, and nobody can deactivate themselves, so the company cannot be locked out.
- **One role per user.** The screens and the API assign a single role.
- **Staff who work in several branches.** An Admin changes only the memberships in their own branches; the rest stay as they are. An Admin can deactivate such a person only when all of that person's branches are the Admin's own; otherwise a Super Admin must do it.
- **Visibility.** A Super Admin sees every user. Others see themselves and people who share a branch with them; anyone else is "not found", not "forbidden".
- **Never deleted.** Users are deactivated. Deactivating ends all the person's sessions at once and stops sign-in; reactivating restores access with the same password and clears any lockout.
- **New accounts.** The server makes a temporary password, shows it once to the creator, and the person must change it at first sign-in. It is never stored in plain text, logged or written to the audit trail.
- **The username is permanent.** Name, email, role and branches can be edited; every edit carries the `rowVersion` it was loaded at, and a stale edit gets `409`.

## Roles

Only a Super Admin (`roles.manage`) creates or edits roles. A custom role is either Admin level or Staff level (never Super Admin), and its level cannot change later.

- The **Super Admin** role holds every permission and cannot be edited.
- The **Admin** and **Staff** presets can be tuned (permissions, description) but not renamed. Re-running the seed only adds missing preset permissions; it never takes away a change.
- `roles.manage` and `branches.manage` can belong only to the Super Admin role.
- A change to a role applies to everyone holding it on their next request. Roles are never deleted.
- Admins and Staff see only the roles they are allowed to hand out (Admins see Staff-level roles).

## The branch switcher

A person who works in several branches can choose one to work in, or "All branches" (the default). The browser sends the choice as `X-Branch-Id`. The server accepts it only for one of the person's own active branches (otherwise `403`; a malformed value is `400`) and narrows that request to the branch. The choice is remembered for the browser tab and forgotten at sign-out. It changes what data the person sees, never what they may do.

## Endpoints

| Endpoint                                                                                      | Permission                                 |
| --------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `GET /users`, `GET /users/:id`                                                                | `users.view`                               |
| `POST /users`, `PATCH /users/:id`, `POST /users/:id/deactivate`, `POST /users/:id/reactivate` | `users.manage` (and the level rules above) |
| `GET /roles`, `GET /roles/:id`, `GET /permissions`                                            | `roles.view`                               |
| `POST /roles`, `PATCH /roles/:id`                                                             | `roles.manage`                             |

Audit rows: `USER_CREATED`, `USER_UPDATED` (old and new values), `USER_DEACTIVATED`, `USER_REACTIVATED`, `ROLE_CREATED`, `ROLE_UPDATED` (permissions added and removed).

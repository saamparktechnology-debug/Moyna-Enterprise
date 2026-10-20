-- Stage 3, module 3.1 (authentication): lockout, password and session columns.
-- Sessions are short-lived and none can exist before login is built, so they are cleared before the
-- required token_hash column is added.
DELETE FROM "sessions";

ALTER TABLE "users"
  ADD COLUMN "failed_login_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "locked_until" TIMESTAMP(3),
  ADD COLUMN "password_changed_at" TIMESTAMP(3),
  ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "sessions"
  ADD COLUMN "token_hash" TEXT NOT NULL,
  ADD COLUMN "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "user_agent" TEXT,
  ADD COLUMN "revoked_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

ALTER TABLE "users" ADD CONSTRAINT "chk_users_failed_login_count_non_negative" CHECK (failed_login_count >= 0);

-- Per-IP login throttling reads recent failed logins (a partial index Prisma cannot model).
CREATE INDEX "audit_log_failed_login_idx" ON "audit_log" ("ip_address", "created_at") WHERE "action" = 'LOGIN_FAILED';

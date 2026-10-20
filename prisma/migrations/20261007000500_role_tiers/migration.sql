-- Stage 3, module 3.3 (users, roles and permissions): every role has a tier, so "who may manage whom"
-- works for custom roles as well as the three system roles. The tier is fixed when a role is created.
CREATE TYPE "RoleTier" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'STAFF');

ALTER TABLE "roles" ADD COLUMN "tier" "RoleTier" NOT NULL DEFAULT 'STAFF';
UPDATE "roles" SET "tier" = 'SUPER_ADMIN' WHERE "name" = 'SUPER_ADMIN';
UPDATE "roles" SET "tier" = 'ADMIN' WHERE "name" = 'ADMIN';
ALTER TABLE "roles" ALTER COLUMN "tier" DROP DEFAULT;

-- Only the system SUPER_ADMIN role has that tier; the other system roles keep theirs.
ALTER TABLE "roles" ADD CONSTRAINT "chk_roles_super_admin_tier" CHECK ((name = 'SUPER_ADMIN') = (tier = 'SUPER_ADMIN'));
ALTER TABLE "roles" ADD CONSTRAINT "chk_roles_system_tiers" CHECK ((name <> 'ADMIN' OR tier = 'ADMIN') AND (name <> 'STAFF' OR tier = 'STAFF'));

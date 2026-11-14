# Chunk 8 - HR: punch in/out many times a day, editable punch times, pay by hours worked

Unzip over the project root (paths are relative to it), after chunks 1 to 7.

    pnpm install
    pnpm db:migrate          # applies 20261007003000_hr_punches
    pnpm exec prisma generate
    pnpm build:packages
    pnpm db:seed             # gives the Admin and Super Admin roles the new permission attendance.edit_punches

Then open Settings > Company and check "Full duty, in hours" (8) and "Pay basis" (HOURS).

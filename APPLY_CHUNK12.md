# Chunk 12 - HR: two kinds of salary (fixed monthly, and no-work-no-pay by the day in 30-minute blocks)

Unzip over the project root (paths are relative to it), after chunk 11 (and chunks 1 to 9).

    pnpm install
    pnpm db:migrate          # applies 20261007003300_salary_types
    pnpm exec prisma generate
    pnpm build:packages

Existing staff stay on a fixed monthly salary. Edit a person (Staff tab) to pay them by the day.

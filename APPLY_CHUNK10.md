# Chunk 10 - HR: employee agreements (editable terms, printed for signing, signed copy uploaded as the acceptance)

Unzip over the project root (paths are relative to it), after chunks 1 to 9, 11 and 12.

    pnpm install
    pnpm db:migrate          # applies 20261007003400_agreements
    pnpm exec prisma generate
    pnpm build:packages

HR > Agreements: Templates, New agreement, Print, Upload signed copy. Employees see their own signed agreement on their page.

# Chunk 5 - lead Age field

Unzip over the project root (paths are relative to it), after chunks 1 to 4.

    pnpm install
    pnpm db:migrate          # applies 20261007002900_lead_age
    pnpm exec prisma generate
    pnpm build:packages

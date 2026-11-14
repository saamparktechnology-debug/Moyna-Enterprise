# Chunk 11 - assembly extras, barcode creation, HSN list screen, sales by category and broker

Unzip over the project root (paths are relative to it), after chunks 1 to 9.

    pnpm install
    pnpm db:migrate          # applies 20261007003200_assembly_extras
    pnpm exec prisma generate
    pnpm build:packages

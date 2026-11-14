# Chunk 1 - purchase price / profit, Declaration form, document preview

Unzip over the project root (paths are relative to it), then:

    pnpm install
    pnpm db:migrate          # applies 20261007002700_purchase_price_declaration
    pnpm exec prisma generate
    pnpm build:packages

Seed is idempotent; the migration itself adds the DECLARATION KYC type to existing databases.

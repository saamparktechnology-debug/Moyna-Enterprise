# Chunk 2 - broker address/photo/documents and commission agreed on the invoice

Unzip over the project root (paths are relative to it), then:

    pnpm install
    pnpm db:migrate          # applies 20261007002800_broker_details_negotiated_commission
    pnpm exec prisma generate
    pnpm build:packages

Apply chunk 1 first if you have not. This chunk changes 34 files and adds nothing else.

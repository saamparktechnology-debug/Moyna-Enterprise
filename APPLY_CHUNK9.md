# Chunk 9 - Assembly (manufacturing): make a product from our own stock and set its selling price

Unzip over the project root (paths are relative to it), after chunks 1 to 8.

    pnpm install
    pnpm db:migrate          # applies 20261007003100_assembly
    pnpm exec prisma generate
    pnpm build:packages
    pnpm db:seed             # gives the Super Admin role the new permission manufacturing.manage

An Admin can assemble only after a role is given "Assemble products from stock and set their selling price" (Users and roles).

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { runSeed } from './seed/run-seed.js';
import { loadSeedConfig } from './seed/seed-env.js';

async function main(): Promise<void> {
  const config = loadSeedConfig();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: config.databaseUrl }),
  });
  try {
    const summary = await runSeed(prisma, config);
    process.stdout.write(`Seed complete: ${JSON.stringify(summary)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

// ============================================================
// WORLD SEED — adds characters without wiping existing ones
// Run: npm run db:seed-world (from packages/backend)
// Optional: npm run db:seed-world -- --count=1000 --archetype=soldier
// ============================================================

import { PrismaClient } from '@prisma/client';
import { DEFAULT_GLOBAL_TRAITS } from '@civ-sim/shared';
import { generateCharacter, ARCHETYPE_LABELS } from '../src/services/character-gen.service';

const prisma = new PrismaClient();

async function main() {
  // Parse CLI args
  const args   = process.argv.slice(2);
  const getArg = (key: string) => args.find(a => a.startsWith(`--${key}=`))?.split('=')[1];

  const count     = Math.min(1000, Math.max(1, parseInt(getArg('count') ?? '100')));
  const archetype = getArg('archetype');

  if (archetype && !ARCHETYPE_LABELS.includes(archetype)) {
    console.error(`Unknown archetype "${archetype}". Valid: ${ARCHETYPE_LABELS.join(', ')}`);
    process.exit(1);
  }

  console.log(`Seeding ${count} inhabitants${archetype ? ` (${archetype})` : ' (random archetypes)'}…`);

  const people = Array.from({ length: count }, () => generateCharacter(archetype));

  await prisma.person.createMany({
    data: people.map(p => ({
      ...p,
      criminal_record: p.criminal_record as any,
      traits:          p.traits          as any,
    })),
  });

  // Init WorldState with active categories (upsert — safe to re-run)
  await prisma.worldState.upsert({
    where:  { id: 1 },
    update: { active_trait_categories: [], global_traits: DEFAULT_GLOBAL_TRAITS },
    create: { current_year: 1, active_trait_categories: [], global_traits: DEFAULT_GLOBAL_TRAITS },
  });

  console.log(`Done. ${count} souls now inhabit the realm.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

// ============================================================
// DATABASE SEED — creates two sample characters
// Run: npm run db:seed (from packages/backend)
// ============================================================

import { PrismaClient, Sexuality } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  await prisma.person.deleteMany();

  const marcus = await prisma.person.create({
    data: {
      name:                'Marcus Veil',
      sexuality:           Sexuality.HETEROSEXUAL,
      gender:              'Male',
      race:                'Human',
      occupation:          'merchant',
      age:                 34,
      death_age:           78,
      relationship_status: 'Married',
      religion:            'The Old Faith',
      criminal_record:     [
        {
          offense:  'Tax evasion',
          date:     '2019-03-15',
          severity: 'moderate',
          status:   'convicted',
        },
      ],
      health:              72,
      traits:              { charisma: 68, cunning: 72, persuasion: 65, ambition: 70, honesty: 30, leadership: 55, wealth_sense: 60 },
      global_scores:       {},
      physical_appearance: 'Tall, lean build. Sharp grey eyes, close-cropped dark hair with silver temples. Small scar above left eyebrow.',
      wealth:              142500.0,
      memory_bank: {
        create: [
          {
            event_summary:    'Marcus was found guilty of tax evasion and paid a substantial fine.',
            emotional_impact: 'negative',
            delta_applied:    { traits: { charisma: -5 }, wealth: -30000 },
          },
        ],
      },
    },
  });

  const lyra = await prisma.person.create({
    data: {
      name:                'Lyra Ashwood',
      sexuality:           Sexuality.BISEXUAL,
      gender:              'Female',
      race:                'Elven-Human',
      occupation:          'scholar',
      age:                 27,
      death_age:           80,
      relationship_status: 'Single',
      religion:            'Nature Covenant',
      criminal_record:     [],
      health:              95,
      traits:              { intelligence: 91, curiosity: 85, memory: 80, creativity: 76, empathy: 72, honesty: 82, charisma: 65 },
      global_scores:       {},
      physical_appearance: 'Slender with pointed ears. Copper hair to mid-back, violet eyes. Light dusting of freckles across her nose.',
      wealth:              8200.0,
      memory_bank: {
        create: [
          {
            event_summary:    'Lyra received a scholarship to the Royal Academy of Arcane Studies.',
            emotional_impact: 'positive',
            delta_applied:    { traits: { intelligence: 5, charisma: 3 } },
          },
        ],
      },
    },
  });

  console.log(`Created ${marcus.name} (${marcus.id})`);
  console.log(`Created ${lyra.name}  (${lyra.id})`);
  console.log('Seed complete.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

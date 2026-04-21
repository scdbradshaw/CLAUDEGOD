// ============================================================
// HEADLINES SERVICE
// Generates AI-written narrative headlines for each year / decade
// One Claude call per year → all categories returned as structured JSON
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import prisma from '../db/client';
import { HeadlineCategory, HeadlineType } from '@prisma/client';

const anthropic = new Anthropic();

// Emotional impact scores for sorting
const IMPACT_SCORE: Record<string, number> = {
  traumatic: -2,
  negative:  -1,
  neutral:    0,
  positive:   1,
  euphoric:   2,
};

// ── Candidate queries ──────────────────────────────────────────────────────

async function buildWorldContext(year: number) {
  // Characters with the most memories this year
  const activeThisYear = await prisma.memoryBank.groupBy({
    by: ['person_id'],
    where: { world_year: year },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 30,
  });

  const activeIds = activeThisYear.map(r => r.person_id);

  // Grab full data for active characters
  const active = activeIds.length > 0
    ? await prisma.person.findMany({
        where: { id: { in: activeIds } },
        include: {
          memory_bank: {
            where: { world_year: year },
            orderBy: { timestamp: 'desc' },
            take: 5,
          },
        },
      })
    : [];

  // Also grab extremes by stat (even if no memories this year)
  const [lowestMorality, highestInfluence, lowestHealth, highestWealth, lowestWealth, oldest] =
    await Promise.all([
      prisma.person.findFirst({ orderBy: { morality: 'asc' },    take: 1 }),
      prisma.person.findFirst({ orderBy: { influence: 'desc' },  take: 1 }),
      prisma.person.findFirst({ orderBy: { health: 'asc' },      where: { health: { gt: 0 } }, take: 1 }),
      prisma.person.findFirst({ orderBy: { wealth: 'desc' },     take: 1 }),
      prisma.person.findFirst({ orderBy: { wealth: 'asc' },      take: 1 }),
      prisma.person.findFirst({ orderBy: { age: 'desc' },        take: 1 }),
    ]);

  // Recent deaths this year
  const deaths = await prisma.memoryBank.findMany({
    where: {
      world_year: year,
      event_summary: { contains: 'passed away' },
    },
    include: { person: true },
    take: 5,
  });

  return { active, lowestMorality, highestInfluence, lowestHealth, highestWealth, lowestWealth, oldest, deaths };
}

// ── Claude call ────────────────────────────────────────────────────────────

interface HeadlineResult {
  category: HeadlineCategory;
  headline: string;
  story: string;
  person_name: string | null;
  person_id: string | null;
}

async function callClaude(year: number, context: Awaited<ReturnType<typeof buildWorldContext>>): Promise<HeadlineResult[]> {
  const categories: HeadlineCategory[] = [
    'MOST_DRAMATIC_FALL',
    'MOST_INSPIRING_RISE',
    'GREATEST_VILLAIN',
    'MOST_TRAGIC',
    'BEST_LOVE_STORY',
    'MOST_CRIMINAL',
    'RAGS_TO_RICHES',
    'RICHES_TO_RAGS',
    'MOST_INFLUENTIAL',
    'LONGEST_SURVIVING',
  ];

  const contextStr = JSON.stringify({
    year,
    active_characters: context.active.map(p => ({
      id: p.id,
      name: p.name,
      race: p.race,
      age: p.age,
      health: p.health,
      morality: p.morality,
      happiness: p.happiness,
      reputation: p.reputation,
      influence: p.influence,
      wealth: p.wealth,
      relationship_status: p.relationship_status,
      criminal_record: p.criminal_record,
      recent_memories: p.memory_bank.map(m => ({
        summary: m.event_summary,
        impact: m.emotional_impact,
        delta: m.delta_applied,
      })),
    })),
    notable: {
      lowest_morality:  context.lowestMorality  ? { id: context.lowestMorality.id,  name: context.lowestMorality.name,  morality: context.lowestMorality.morality }   : null,
      highest_influence:context.highestInfluence ? { id: context.highestInfluence.id, name: context.highestInfluence.name, influence: context.highestInfluence.influence } : null,
      lowest_health:    context.lowestHealth     ? { id: context.lowestHealth.id,     name: context.lowestHealth.name,     health: context.lowestHealth.health }           : null,
      highest_wealth:   context.highestWealth    ? { id: context.highestWealth.id,    name: context.highestWealth.name,    wealth: context.highestWealth.wealth }           : null,
      lowest_wealth:    context.lowestWealth     ? { id: context.lowestWealth.id,     name: context.lowestWealth.name,    wealth: context.lowestWealth.wealth }            : null,
      oldest:           context.oldest           ? { id: context.oldest.id,           name: context.oldest.name,           age: context.oldest.age }                       : null,
    },
    deaths_this_year: context.deaths.map(d => ({ name: d.person?.name, summary: d.event_summary })),
  }, null, 2);

  const prompt = `You are the Grand Chronicler of this world. Year ${year} has just ended.

Based on the world data below, write compelling, dramatic headlines for each of the following categories. Be creative and vivid — these are the stories that will be remembered.

Categories to cover:
${categories.map(c => `- ${c}`).join('\n')}

World Data for Year ${year}:
${contextStr}

Return a JSON array (no markdown, raw JSON only) with exactly ${categories.length} objects, one per category:
[
  {
    "category": "MOST_DRAMATIC_FALL",
    "headline": "Short punchy headline (max 12 words)",
    "story": "2-3 sentence dramatic narrative about this character or event",
    "person_name": "Name of the featured character or null if world event",
    "person_id": "UUID of the featured character or null"
  },
  ...
]

If there is not enough data for a specific category, write a world-event headline instead (no specific character). Make every headline feel like it belongs in a fantasy chronicle.`;

  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = msg.content[0].type === 'text' ? msg.content[0].text : '';

  // Strip any markdown fences if present
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleaned) as HeadlineResult[];
}

// ── Decade summary ─────────────────────────────────────────────────────────

async function buildDecadeSummary(
  decadeStart: number,
  category: HeadlineCategory,
  annuals: { year: number; headline: string; story: string; person_name: string | null }[],
): Promise<{ headline: string; story: string; person_name: string | null; person_id: string | null }> {
  const prompt = `You are the Grand Chronicler. Summarize the following decade (${decadeStart}–${decadeStart + 9}) for the category "${category}" into a single powerful headline and summary.

Annual headlines for this category:
${annuals.map(a => `Year ${a.year} — ${a.headline}: ${a.story}`).join('\n\n')}

Return raw JSON only (no markdown):
{
  "headline": "Decade summary headline (max 12 words)",
  "story": "3-4 sentence summary of the defining arc across this decade",
  "person_name": "Most prominent person across this decade, or null"
}`;

  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = msg.content[0].type === 'text' ? msg.content[0].text : '{}';
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const parsed = JSON.parse(cleaned);
  return { ...parsed, person_id: null };
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function generateHeadlinesForYear(year: number): Promise<HeadlineResult[]> {
  const context = await buildWorldContext(year);
  const results = await callClaude(year, context);

  // Upsert all headlines
  for (const r of results) {
    await prisma.yearlyHeadline.upsert({
      where: { year_type_category: { year, type: HeadlineType.ANNUAL, category: r.category } },
      create: {
        year,
        type:        HeadlineType.ANNUAL,
        category:    r.category,
        headline:    r.headline,
        story:       r.story,
        person_name: r.person_name,
        person_id:   r.person_id,
      },
      update: {
        headline:    r.headline,
        story:       r.story,
        person_name: r.person_name,
        person_id:   r.person_id,
      },
    });
  }

  return results;
}

export async function compressOldDecades(currentYear: number): Promise<void> {
  const cutoff = currentYear - 10;

  const oldAnnuals = await prisma.yearlyHeadline.findMany({
    where: { year: { lt: cutoff }, type: HeadlineType.ANNUAL },
    orderBy: { year: 'asc' },
  });

  if (oldAnnuals.length === 0) return;

  // Group by decade
  const byDecade = new Map<number, typeof oldAnnuals>();
  for (const h of oldAnnuals) {
    const ds = Math.floor(h.year / 10) * 10;
    if (!byDecade.has(ds)) byDecade.set(ds, []);
    byDecade.get(ds)!.push(h);
  }

  for (const [decadeStart, annuals] of byDecade) {
    // Group by category within this decade
    const byCategory = new Map<HeadlineCategory, typeof annuals>();
    for (const h of annuals) {
      if (!byCategory.has(h.category)) byCategory.set(h.category, []);
      byCategory.get(h.category)!.push(h);
    }

    for (const [category, catAnnuals] of byCategory) {
      // Check if decade summary already exists
      const existing = await prisma.yearlyHeadline.findUnique({
        where: { year_type_category: { year: decadeStart, type: HeadlineType.DECADE, category } },
      });
      if (existing) continue;

      const summary = await buildDecadeSummary(decadeStart, category, catAnnuals);

      await prisma.yearlyHeadline.upsert({
        where: { year_type_category: { year: decadeStart, type: HeadlineType.DECADE, category } },
        create: { year: decadeStart, type: HeadlineType.DECADE, category, ...summary },
        update: summary,
      });
    }

    // Delete the annual entries for this decade
    await prisma.yearlyHeadline.deleteMany({
      where: {
        year: { gte: decadeStart, lt: decadeStart + 10 },
        type: HeadlineType.ANNUAL,
      },
    });
  }
}

// ============================================================
// HEADLINES SERVICE
// Generates AI-written narrative headlines for each year / decade
// One Claude call per year → all categories returned as structured JSON
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import prisma from '../db/client';
import { HeadlineCategory, HeadlineType, Tone } from '@prisma/client';
import {
  getVoicePrompt,
  toneForHeadlineCategory,
  toneForDecadeSummary,
} from './tone.service';

const anthropic = new Anthropic();

// ── Candidate queries ──────────────────────────────────────────────────────

async function buildWorldContext(year: number, worldId: string) {
  // Characters with the most memories this year (scoped to this world via person FK)
  const activeThisYear = await prisma.memoryBank.groupBy({
    by: ['person_id'],
    where: { world_year: year, person: { world_id: worldId } },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 30,
  });

  const activeIds = activeThisYear.map(r => r.person_id);

  const active = activeIds.length > 0
    ? await prisma.person.findMany({
        where: { id: { in: activeIds }, world_id: worldId },
        include: {
          memory_bank: {
            where: { world_year: year },
            orderBy: { timestamp: 'desc' },
            take: 5,
          },
        },
      })
    : [];

  const w = { world_id: worldId };

  const [lowestHealth, highestMoney, lowestMoney, oldest] =
    await Promise.all([
      prisma.person.findFirst({ where: { ...w, current_health: { gt: 0 } }, orderBy: { current_health: 'asc' }, take: 1 }),
      prisma.person.findFirst({ where: w, orderBy: { money: 'desc' }, take: 1 }),
      prisma.person.findFirst({ where: w, orderBy: { money: 'asc' },  take: 1 }),
      prisma.person.findFirst({ where: w, orderBy: { age: 'desc' },    take: 1 }),
    ]);

  const deaths = await prisma.memoryBank.findMany({
    where: {
      world_year: year,
      event_summary: { contains: 'passed away' },
      person: { world_id: worldId },
    },
    include: { person: true },
    take: 5,
  });

  return { active, lowestHealth, highestMoney, lowestMoney, oldest, deaths };
}

// ── Claude call ────────────────────────────────────────────────────────────

interface HeadlineResult {
  category: HeadlineCategory;
  headline: string;
  story: string;
  person_name: string | null;
  person_id: string | null;
  tone: Tone;
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

  // Per-category tone table — Claude is told which voice to use for each slot.
  // The server stamps the same tone server-side after the response lands, so
  // Claude's voice and the persisted `tone` column stay in sync.
  const categoryTones = categories.map(c => ({ category: c, tone: toneForHeadlineCategory(c) }));

  const voiceGuide = categoryTones
    .map(({ category, tone }) => `- ${category} → write in "${tone}" voice`)
    .join('\n');

  // Voice reference block — every tone the prompt might invoke.
  const distinctTones = Array.from(new Set(categoryTones.map(c => c.tone)));
  const voiceReference = distinctTones
    .map(t => `### ${t}\n${getVoicePrompt(t)}`)
    .join('\n\n');

  const contextStr = JSON.stringify({
    year,
    active_characters: context.active.map(p => ({
      id: p.id, name: p.name, race: p.race, age: p.age,
      current_health: p.current_health, money: p.money,
      relationship_status: p.relationship_status, criminal_record: p.criminal_record,
      traits: p.traits,
      recent_memories: p.memory_bank.map(m => ({
        summary: m.event_summary, impact: m.emotional_impact, delta: m.delta_applied,
      })),
    })),
    notable: {
      lowest_health:  context.lowestHealth  ? { id: context.lowestHealth.id,  name: context.lowestHealth.name,  current_health: context.lowestHealth.current_health }   : null,
      highest_money:  context.highestMoney  ? { id: context.highestMoney.id,  name: context.highestMoney.name,  money: context.highestMoney.money }   : null,
      lowest_money:   context.lowestMoney   ? { id: context.lowestMoney.id,   name: context.lowestMoney.name,   money: context.lowestMoney.money }    : null,
      oldest:         context.oldest        ? { id: context.oldest.id,        name: context.oldest.name,        age: context.oldest.age }                : null,
    },
    deaths_this_year: context.deaths.map(d => ({ name: d.person?.name, summary: d.event_summary })),
  }, null, 2);

  const prompt = `You are the Chronicler of this world, writing the year-end headlines for Year ${year}.

Each category must be written in a specific voice. Voice references:

${voiceReference}

Voice assignments for this chronicle:
${voiceGuide}

Match the voice precisely per category — a tabloid category should feel nothing like a literary one.

World Data for Year ${year}:
${contextStr}

Return a JSON array (no markdown, raw JSON only) with exactly ${categories.length} objects, one per category in the order listed above:
[
  {
    "category": "MOST_DRAMATIC_FALL",
    "headline": "Short punchy headline (max 12 words)",
    "story": "2-3 sentence narrative in the assigned voice",
    "person_name": "Name of the featured character or null if world event",
    "person_id": "UUID of the featured character or null"
  },
  ...
]

If there is not enough data for a specific category, write a world-event headline in that slot's assigned voice (no specific character). Content ceiling: unflinching — render scandal, violence, and death directly when the voice calls for it.`;

  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = msg.content[0].type === 'text' ? msg.content[0].text : '';
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const parsed = JSON.parse(cleaned) as Omit<HeadlineResult, 'tone'>[];

  // Stamp tone server-side from the category map — this is authoritative, so
  // we never drift if Claude returns a voice that doesn't match its assignment.
  return parsed.map(r => ({
    ...r,
    tone: toneForHeadlineCategory(r.category),
  }));
}

// ── Decade summary ─────────────────────────────────────────────────────────

async function buildDecadeSummary(
  decadeStart: number,
  category: HeadlineCategory,
  annuals: { year: number; headline: string; story: string; person_name: string | null }[],
): Promise<{ headline: string; story: string; person_name: string | null; person_id: string | null; tone: Tone }> {
  const tone = toneForDecadeSummary();

  const prompt = `${getVoicePrompt(tone)}

Summarize the following decade (${decadeStart}–${decadeStart + 9}) for the category "${category}" into a single powerful headline and summary. Write in the epic voice described above.

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
  return { ...parsed, person_id: null, tone };
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function generateHeadlinesForYear(year: number, worldId: string): Promise<HeadlineResult[]> {
  const context = await buildWorldContext(year, worldId);
  const results = await callClaude(year, context);

  for (const r of results) {
    await prisma.yearlyHeadline.upsert({
      where: { world_id_year_type_category: { world_id: worldId, year, type: HeadlineType.ANNUAL, category: r.category } },
      create: {
        world_id:    worldId,
        year,
        type:        HeadlineType.ANNUAL,
        category:    r.category,
        headline:    r.headline,
        story:       r.story,
        person_name: r.person_name,
        person_id:   r.person_id,
        tone:        r.tone,
      },
      update: {
        headline:    r.headline,
        story:       r.story,
        person_name: r.person_name,
        person_id:   r.person_id,
        tone:        r.tone,
      },
    });
  }

  return results;
}

/**
 * Decade-boundary generation (Step 21).
 *
 * At the end of every year-pipeline run, walk every fully-elapsed decade and
 * generate its DECADE summary row if one doesn't already exist for each
 * category. Annual rows are preserved — no deletion, no compression.
 *
 * Carry-forward: a world that crossed multiple decade boundaries in a single
 * advance (or one whose earlier advances predated this feature) still gets
 * summaries for every historic decade the next time the clock ticks.
 *
 * Cost control: we pre-fetch the existing (decade, category) pairs and skip
 * decades that already have all 10 category rows, so the only repeated cost
 * for a long-running world is a single `findMany` on the DECADE rows.
 */
export async function ensureDecadeSummaries(
  lastFullYear: number,
  worldId: string,
): Promise<void> {
  if (lastFullYear < 9) return; // no decade has fully elapsed yet

  const existing = await prisma.yearlyHeadline.findMany({
    where: { world_id: worldId, type: HeadlineType.DECADE },
    select: { year: true, category: true },
  });

  const summarized = new Set(existing.map(d => `${d.year}:${d.category}`));
  const byYearCount = new Map<number, number>();
  for (const d of existing) {
    byYearCount.set(d.year, (byYearCount.get(d.year) ?? 0) + 1);
  }

  // Ten headline categories — if a decade already has all ten, skip entirely.
  const CATEGORY_COUNT = 10;

  for (let ds = 0; ds + 9 <= lastFullYear; ds += 10) {
    if ((byYearCount.get(ds) ?? 0) >= CATEGORY_COUNT) continue;

    const annuals = await prisma.yearlyHeadline.findMany({
      where: { world_id: worldId, year: { gte: ds, lt: ds + 10 }, type: HeadlineType.ANNUAL },
      orderBy: { year: 'asc' },
    });
    if (annuals.length === 0) continue;

    const byCategory = new Map<HeadlineCategory, typeof annuals>();
    for (const h of annuals) {
      if (!byCategory.has(h.category)) byCategory.set(h.category, []);
      byCategory.get(h.category)!.push(h);
    }

    for (const [category, catAnnuals] of byCategory) {
      const key = `${ds}:${category}`;
      if (summarized.has(key)) continue;

      const summary = await buildDecadeSummary(ds, category, catAnnuals);

      await prisma.yearlyHeadline.upsert({
        where: { world_id_year_type_category: { world_id: worldId, year: ds, type: HeadlineType.DECADE, category } },
        create: { world_id: worldId, year: ds, type: HeadlineType.DECADE, category, ...summary },
        update: summary,
      });

      summarized.add(key);
      byYearCount.set(ds, (byYearCount.get(ds) ?? 0) + 1);
    }
  }
}

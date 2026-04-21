// ============================================================
// TONE SERVICE
// Single source of truth for Claude voice routing. Every narrative
// site imports from here — do not duplicate prompt text elsewhere.
// ============================================================

import { HeadlineCategory } from '@prisma/client';
import type { Tone, OutcomeBand, InteractionTypeDef } from '@civ-sim/shared';

export type { Tone };

// ── Voice prefixes ────────────────────────────────────────────
// Injected at the top of every Claude prompt that writes narrative.
// Keep these short (2-4 sentences) — they stack with the caller's
// actual task prompt.

const VOICE_PROMPTS: Record<Tone, string> = {
  tabloid: `You are a lurid tabloid chronicler with a sharp eye for scandal.
Your voice is punchy, gossipy, and unflinching. Lean into drama, moral weakness,
and the juicy specifics — affairs, betrayals, falls from grace, sudden wealth,
dirty deeds. Short sentences. Vivid verbs. Never euphemize ugliness.`,

  literary: `You are a literary chronicler writing with restraint and weight.
Your voice is quiet, observational, attentive to small true details — a hand
on a doorframe, the specific quality of light, what is unsaid. Render death,
birth, and private passage without sentimentality. Let moments breathe.`,

  epic: `You are a grand chronicler in the high register. Your voice is
mythic, sweeping, concerned with lineages, faiths, wars, and the arc of ages.
Name the forces at work. Invoke consequence. Every sentence should feel like
it could appear carved into stone a hundred years from now.`,

  reportage: `You are a war correspondent filing dispatches from catastrophe.
Your voice is terse, factual, time-stamped. Lead with numbers and names.
No flourish. The horror comes through the restraint of the prose, not from
commentary. Tell what happened and to whom.`,

  neutral: `You are a plain-spoken record keeper. State what happened in a
short, clear sentence. No flourish, no judgment, no voice. This is a log entry,
not a story.`,
};

/** Returns the voice prefix to prepend to a Claude prompt. */
export function getVoicePrompt(tone: Tone): string {
  return VOICE_PROMPTS[tone];
}

// ── Per-HeadlineCategory tone mapping ─────────────────────────
// Approved mapping from Phase 5 plan. A decade summary overrides this
// and is always `epic`.

const CATEGORY_TONE: Record<HeadlineCategory, Tone> = {
  MOST_DRAMATIC_FALL:  'tabloid',
  MOST_CRIMINAL:       'tabloid',
  RICHES_TO_RAGS:      'tabloid',
  BEST_LOVE_STORY:     'tabloid',
  MOST_TRAGIC:         'literary',
  LONGEST_SURVIVING:   'literary',
  GREATEST_VILLAIN:    'epic',
  MOST_INSPIRING_RISE: 'epic',
  MOST_INFLUENTIAL:    'epic',
  RAGS_TO_RICHES:      'epic',
};

export function toneForHeadlineCategory(category: HeadlineCategory): Tone {
  return CATEGORY_TONE[category] ?? 'neutral';
}

// ── Outcome-band / interaction tone ───────────────────────────

/**
 * Tone derived from a specific outcome band in an interaction.
 * Priority:
 *   1. Explicit `band.tone` on the ruleset (author's override).
 *   2. High-magnitude bands lean tabloid (the big dramatic moments).
 *   3. Death-capable bands lean literary (quiet weight).
 *   4. Low-magnitude routine outcomes → neutral.
 *
 * The `iType` param is accepted for future per-interaction-category routing
 * (e.g. labels containing "conception" / "assassination" / etc.) but kept
 * lightweight for now — ruleset authors can always set `band.tone` directly.
 */
export function toneForOutcomeBand(
  band: OutcomeBand,
  _iType?: InteractionTypeDef,
): Tone {
  if (band.tone) return band.tone;
  if (band.can_die) return 'literary';
  if ((band.magnitude ?? 0) >= 0.7) return 'tabloid';
  return 'neutral';
}

// ── Group events ──────────────────────────────────────────────

export type GroupEventKind =
  | 'religion_founded'
  | 'religion_dissolved'
  | 'faction_founded'
  | 'faction_split'
  | 'faction_leader_void';

export function toneForGroupEvent(_kind: GroupEventKind): Tone {
  // All group-level events are mythic by design.
  return 'epic';
}

// ── Deaths ────────────────────────────────────────────────────

export type DeathCause = 'old_age' | 'interaction' | 'health';

export function toneForDeath(cause: DeathCause): Tone {
  // Old age and health are quiet; interaction deaths can be dramatic but the
  // interaction band itself already tags tone, so here we default to literary.
  void cause;
  return 'literary';
}

// ── God Mode ──────────────────────────────────────────────────

/**
 * God Mode single-target edits are scandal material by default.
 * Callers can override when appropriate (e.g. a divine-healing edit
 * could be passed `literary`).
 */
export function toneForGodModeSingle(): Tone {
  return 'tabloid';
}

/**
 * Bulk filter actions (plague, tax, mass blessing) read as dispatches.
 */
export function toneForGodModeBulk(): Tone {
  return 'reportage';
}

// ── Decade summaries ──────────────────────────────────────────

export function toneForDecadeSummary(): Tone {
  return 'epic';
}

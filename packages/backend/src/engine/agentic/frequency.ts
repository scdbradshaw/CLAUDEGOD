// Phase 9 — per-year action chance for one real person (DESIGN.md §11.3).
//
// Tags / age / state-tags scale a base chance, clamped to [floor, ceiling].
// Floor = 0.05, ceiling = 0.50 per the spec.

import {
  AGENTIC_BASE_CHANCE,
  AGENTIC_CHANCE_CEILING,
  AGENTIC_CHANCE_FLOOR,
  type PersonalityTag,
  type StateTag,
} from '@claude-god/shared';

export interface FrequencyInput {
  age: number;
  personality_tags: PersonalityTag[];
  state_tags: StateTag[];
}

/** Returns an act-chance in [AGENTIC_CHANCE_FLOOR, AGENTIC_CHANCE_CEILING]. */
export function actChance(p: FrequencyInput): number {
  let c = AGENTIC_BASE_CHANCE;

  // Personality tag modifiers (per DESIGN.md §11.3).
  if (p.personality_tags.includes('ambitious')) c += 0.15;
  if (p.personality_tags.includes('vengeful')) c += 0.10;
  if (p.personality_tags.includes('cruel')) c += 0.05;
  if (p.personality_tags.includes('charismatic')) c += 0.05;
  if (p.personality_tags.includes('cunning')) c += 0.05;
  if (p.personality_tags.includes('reckless')) c += 0.10;
  if (p.personality_tags.includes('brave')) c += 0.05;
  if (p.personality_tags.includes('proud')) c += 0.05;
  if (p.personality_tags.includes('diligent')) c += 0.05;
  if (p.personality_tags.includes('lazy')) c -= 0.10;
  if (p.personality_tags.includes('stoic')) c -= 0.05;
  if (p.personality_tags.includes('paranoid')) c -= 0.05;

  // Age band modifier.
  if (p.age < 18) c -= 0.05;
  else if (p.age <= 40) c += 0.05;
  else if (p.age <= 65) c += 0;
  else c -= 0.10;

  // State tag modifiers (boolean carriers; presence = active).
  if (p.state_tags.includes('grieving')) c -= 0.20;
  if (p.state_tags.includes('traumatized')) c -= 0.10;
  if (p.state_tags.includes('windfall')) c += 0.10;
  if (p.state_tags.includes('ruined')) c += 0.05;

  if (c < AGENTIC_CHANCE_FLOOR) return AGENTIC_CHANCE_FLOOR;
  if (c > AGENTIC_CHANCE_CEILING) return AGENTIC_CHANCE_CEILING;
  return c;
}

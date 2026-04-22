// ============================================================
// CHARACTER GENERATION SERVICE
// Shared logic for seeder + bulk API endpoint
// ============================================================

import { Sexuality } from '@prisma/client';
import { IDENTITY_ATTRIBUTES, GLOBAL_TRAITS } from '@civ-sim/shared';

// ── Helpers ───────────────────────────────────────────────────

export function rnd(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function clamp(n: number) {
  return Math.max(0, Math.min(100, n));
}

// ── Name data ─────────────────────────────────────────────────

const HUMAN_MALE_NAMES = [
  'Aldric','Brennan','Caspian','Dorian','Edwyn','Faelen','Garrett','Hugo',
  'Ivar','Jasper','Kiran','Leander','Maddox','Nolan','Oswin','Pierce',
  'Quillan','Rowan','Stellan','Theron','Ulric','Vance','Weston','Xander','York',
];
const HUMAN_FEMALE_NAMES = [
  'Aelindra','Brynn','Caelith','Dara','Elara','Fenna','Gwen','Hilde',
  'Isolde','Jessa','Kira','Lena','Maren','Niamh','Owyn','Petra',
  'Quinn','Reva','Sable','Tess','Una','Vesper','Wren','Xara','Ysolde',
];
const ELF_MALE_NAMES   = ['Aelthar','Caladwen','Erevan','Faelindor','Galadon','Ilmyrth','Liriel','Mirendel'];
const ELF_FEMALE_NAMES = ['Aelindra','Caladria','Elaera','Faelwen','Gilraen','Ioreth','Luthien','Mirial'];
const DWARF_NAMES      = ['Baldrek','Dolgrin','Forgrim','Gundrak','Haldrik','Korgath','Morgrul','Thordak','Agna','Bofri','Gudla','Helka','Ingra','Kilda','Morda','Thorda'];
const ORC_NAMES        = ['Grak','Urzog','Thrak','Morg','Krag','Varg','Skorn','Drak','Grasha','Urka','Vorka','Skara','Marka','Nasha'];
const HALFLING_NAMES   = ['Barlo','Cob','Finwick','Merry','Pip','Rolo','Tob','Wendel','Bree','Calla','Dessa','Fern','Lily','Mira','Nessa','Tam'];
const TIEFLING_NAMES   = ['Ash','Cinder','Dusk','Ember','Hex','Morrow','Ruin','Sable','Torment','Vex'];
const SURNAMES         = ['Ashveil','Blackthorn','Coldwater','Duskmantle','Emberholt','Frostwick','Greystone','Hawkmere','Ironwood','Jadepeak','Kessler','Lightbane','Merrow','Nighthollow','Oakhaven','Pinecroft','Redmane','Stormgate','Thornbury','Underhill','Valdris','Whitlock','Yarwick','Zephyrcross'];

export const RACES = ['Human','Human','Human','Human','Human','Human','Elf','Elf','Dwarf','Halfling','Half-Orc','Orc','Tiefling','Gnome'];

export const RELIGIONS = ['The Old Faith','The Flame Church','Nature Covenant','Order of the Pale Star','Temple of Coin','Brotherhood of Iron','The Unnamed Path','Church of the Wanderer','Cult of the Deep','Sunwalkers','Agnostic','None'];

export const RELATIONSHIPS = ['Single','Single','Single','Married','Married','Married','Widowed','Divorced','Betrothed','Estranged','In a relationship','Complicated'];

export const GENDERS = ['Male','Male','Male','Female','Female','Female','Non-binary','Agender'];

export const SEXUALITIES: Sexuality[] = [
  Sexuality.HETEROSEXUAL, Sexuality.HETEROSEXUAL, Sexuality.HETEROSEXUAL,
  Sexuality.HETEROSEXUAL, Sexuality.HETEROSEXUAL, Sexuality.HETEROSEXUAL,
  Sexuality.HOMOSEXUAL,   Sexuality.BISEXUAL,     Sexuality.BISEXUAL,
  Sexuality.ASEXUAL,      Sexuality.PANSEXUAL,
];

// ── Archetypes ────────────────────────────────────────────────

export interface Archetype {
  label:     string;
  statBias:  Partial<Record<string, number>>;
  wealthMin: number;
  wealthMax: number;
  ageMin:    number;
  ageMax:    number;
}

export const ARCHETYPES: Archetype[] = [
  { label: 'noble',    statBias: {},  wealthMin: 80_000,  wealthMax: 600_000, ageMin: 20, ageMax: 65 },
  { label: 'merchant', statBias: {},  wealthMin: 10_000,  wealthMax: 200_000, ageMin: 25, ageMax: 60 },
  { label: 'soldier',  statBias: {},  wealthMin: 500,     wealthMax: 5_000,   ageMin: 18, ageMax: 45 },
  { label: 'criminal', statBias: {},  wealthMin: 200,     wealthMax: 15_000,  ageMin: 16, ageMax: 50 },
  { label: 'scholar',  statBias: {},  wealthMin: 1_000,   wealthMax: 8_000,   ageMin: 22, ageMax: 70 },
  { label: 'priest',   statBias: {},  wealthMin: 300,     wealthMax: 4_000,   ageMin: 25, ageMax: 75 },
  { label: 'farmer',   statBias: {},  wealthMin: 50,      wealthMax: 2_000,   ageMin: 16, ageMax: 70 },
  { label: 'wanderer', statBias: {},  wealthMin: 0,       wealthMax: 500,     ageMin: 16, ageMax: 60 },
  { label: 'artisan',  statBias: {},  wealthMin: 1_000,   wealthMax: 12_000,  ageMin: 20, ageMax: 65 },
  { label: 'elder',    statBias: {},  wealthMin: 2_000,   wealthMax: 30_000,  ageMin: 60, ageMax: 90 },
];

export const ARCHETYPE_LABELS = ARCHETYPES.map(a => a.label);

// ── Trait biases ──────────────────────────────────────────────

const TRAIT_BIASES: Record<string, Partial<Record<string, number>>> = {
  noble:    { leadership: 25, charisma: 20, ambition: 20, beauty: 15, persuasion: 15 },
  merchant: { cunning: 25, persuasion: 25, ambition: 20, intelligence: 10 },
  soldier:  { combat: 25, strength: 20, endurance: 20, courage: 15, discipline: 10, health: 15 },
  criminal: { cunning: 25, street_smarts: 20, honesty: -30, resilience: 15 },
  scholar:  { intelligence: 25, curiosity: 25, memory: 20, creativity: 15 },
  priest:   { empathy: 20, discipline: 25, charisma: 15, resilience: 15, honesty: 10 },
  farmer:   { endurance: 20, strength: 15, resilience: 20, discipline: 10, health: 10 },
  wanderer: { survival: 25, street_smarts: 20, resilience: 15, agility: 10 },
  artisan:  { craftsmanship: 25, artistry: 20, creativity: 15, discipline: 10 },
  elder:    { intelligence: 10, empathy: 20, resilience: 20, memory: 15, health: -15 },
};

// ── Generation functions ──────────────────────────────────────

export function getName(race: string, gender: string): string {
  const isFemale = gender === 'Female';
  const first = (() => {
    switch (race) {
      case 'Elf':      return pick(isFemale ? ELF_FEMALE_NAMES : ELF_MALE_NAMES);
      case 'Dwarf':    return pick(DWARF_NAMES);
      case 'Orc':
      case 'Half-Orc': return pick(ORC_NAMES);
      case 'Halfling': return pick(HALFLING_NAMES);
      case 'Tiefling': return pick(TIEFLING_NAMES);
      default:         return pick(isFemale ? HUMAN_FEMALE_NAMES : HUMAN_MALE_NAMES);
    }
  })();
  if (race === 'Orc' || race === 'Tiefling') return first;
  return `${first} ${pick(SURNAMES)}`;
}

export function getLifespan(_race: string): number {
  // v1 design: all characters use the same 60-95 year lifespan.
  return rnd(60, 95);
}

export function getAppearance(race: string, gender: string, age: number): string {
  const builds     = ['lean','stocky','wiry','broad-shouldered','slight','muscular','heavyset','lanky'];
  const eyeColors  = ['grey','brown','green','blue','amber','violet','silver','gold'];
  const hairColors = ['black','dark brown','auburn','chestnut','golden','silver','white','ash-blonde','copper','raven'];
  const skinTones: Record<string, string[]> = {
    Human:     ['fair','olive','tawny','dark brown','pale','sun-bronzed'],
    Elf:       ['porcelain','pale silver','sun-kissed ivory','moonlit white'],
    Dwarf:     ['ruddy','weather-beaten','tanned','ruddy brown'],
    Halfling:  ['rosy','tanned','freckled bronze'],
    Gnome:     ['earthy tan','pale lavender','rosy brown'],
    Orc:       ['grey-green','dark olive','mossy green','deep grey'],
    'Half-Orc':['grey-olive','weathered green','dusky olive'],
    Tiefling:  ['deep crimson','ash grey','pale lavender','midnight blue'],
  };
  const skin  = pick(skinTones[race] ?? skinTones.Human);
  const build = pick(builds);
  const eyes  = pick(eyeColors);
  const hair  = pick(hairColors);
  const agedNote = age > 60 ? ' Deep lines mark a life well-lived.' : age < 20 ? ' Still bearing the softness of youth.' : '';
  return `${build.charAt(0).toUpperCase() + build.slice(1)} build with ${skin} skin and ${eyes} eyes. ${hair.charAt(0).toUpperCase() + hair.slice(1)} hair worn ${pick(['loose','braided','cropped short','tied back','wild','in a topknot'])}.${agedNote}`;
}

/** Generate personal global force scores from world baseline ±25 random variance */
export function generateGlobalScores(worldTraits: Record<string, number>): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const [force, def] of Object.entries(GLOBAL_TRAITS)) {
    for (const [child, childDef] of Object.entries(def.children)) {
      const key = `${force}.${child}`;
      const worldVal = worldTraits[key] ?? 0;
      const variance = rnd(-25, 25);
      scores[key] = Math.max(childDef.min, Math.min(childDef.max, worldVal + variance));
    }
  }
  return scores;
}

export function generateTraits(archetypeLabel: string): Record<string, number> {
  const bias = TRAIT_BIASES[archetypeLabel] ?? {};
  const traits: Record<string, number> = {};
  for (const attrKeys of Object.values(IDENTITY_ATTRIBUTES)) {
    for (const key of attrKeys) {
      traits[key] = clamp(rnd(20, 70) + (bias[key] ?? 0));
    }
  }
  return traits;
}

// ── Main export ───────────────────────────────────────────────

export interface GeneratedCharacter {
  name:                string;
  sexuality:           Sexuality;
  gender:              string;
  race:                string;
  occupation:          string;
  age:                 number;
  death_age:           number;
  relationship_status: string;
  religion:            string;
  criminal_record:     object[];
  /** Life/death column — synced from traits.health at generation time. */
  health:              number;
  physical_appearance: string;
  wealth:              number;
  /** All 25 identity attributes (0-100), including health. */
  traits:              Record<string, number>;
  global_scores:       Record<string, number>;
}

export function generateCharacter(archetypeLabel?: string, worldGlobalTraits: Record<string, number> = {}): GeneratedCharacter {
  const archetype = archetypeLabel
    ? (ARCHETYPES.find(a => a.label === archetypeLabel) ?? pick(ARCHETYPES))
    : pick(ARCHETYPES);

  const race      = pick(RACES);
  const gender    = pick(GENDERS);
  const death_age = getLifespan(race);
  const age       = Math.min(rnd(archetype.ageMin, archetype.ageMax), death_age - 1);
  const sexuality = pick(SEXUALITIES);

  const traits   = generateTraits(archetype.label);
  // Health column synced from traits.health so they start in agreement.
  const health   = traits['health'] ?? 100;

  const criminalRecord = archetype.label === 'criminal' && Math.random() > 0.3
    ? [{ offense: pick(['Theft','Assault','Smuggling','Fraud','Arson','Murder','Extortion','Trespassing']), date: `Year ${rnd(1,50)}`, severity: pick(['minor','moderate','severe']), status: pick(['convicted','pending','acquitted']) }]
    : [];

  return {
    name:                getName(race, gender),
    sexuality,
    gender,
    race,
    occupation:          archetype.label,
    age,
    death_age,
    relationship_status: pick(RELATIONSHIPS),
    religion:            pick(RELIGIONS),
    criminal_record:     criminalRecord,
    health,
    physical_appearance: getAppearance(race, gender, age),
    wealth:              parseFloat((Math.random() * (archetype.wealthMax - archetype.wealthMin) + archetype.wealthMin).toFixed(2)),
    traits,
    global_scores:       generateGlobalScores(worldGlobalTraits),
  };
}

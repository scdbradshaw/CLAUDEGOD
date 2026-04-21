// ============================================================
// CHARACTER GENERATION SERVICE
// Shared logic for seeder + bulk API endpoint
// ============================================================

import { Sexuality } from '@prisma/client';
import { TRAIT_CATEGORIES, GLOBAL_TRAITS } from '@civ-sim/shared';

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
  { label: 'noble',    statBias: { reputation: 20, influence: 25 },              wealthMin: 80_000,  wealthMax: 600_000, ageMin: 20, ageMax: 65 },
  { label: 'merchant', statBias: { intelligence: 15, influence: 10 },            wealthMin: 10_000,  wealthMax: 200_000, ageMin: 25, ageMax: 60 },
  { label: 'soldier',  statBias: { health: 20, reputation: 5 },                  wealthMin: 500,     wealthMax: 5_000,   ageMin: 18, ageMax: 45 },
  { label: 'criminal', statBias: { morality: -30, influence: 10, happiness: -10 }, wealthMin: 200,   wealthMax: 15_000,  ageMin: 16, ageMax: 50 },
  { label: 'scholar',  statBias: { intelligence: 25, influence: 5 },             wealthMin: 1_000,   wealthMax: 8_000,   ageMin: 22, ageMax: 70 },
  { label: 'priest',   statBias: { morality: 20, reputation: 10, happiness: 10 }, wealthMin: 300,    wealthMax: 4_000,   ageMin: 25, ageMax: 75 },
  { label: 'farmer',   statBias: { health: 10, happiness: 5, morality: 5 },      wealthMin: 50,      wealthMax: 2_000,   ageMin: 16, ageMax: 70 },
  { label: 'wanderer', statBias: { happiness: -5, intelligence: 5 },             wealthMin: 0,       wealthMax: 500,     ageMin: 16, ageMax: 60 },
  { label: 'artisan',  statBias: { reputation: 10, happiness: 10 },              wealthMin: 1_000,   wealthMax: 12_000,  ageMin: 20, ageMax: 65 },
  { label: 'elder',    statBias: { intelligence: 10, reputation: 15, health: -15 }, wealthMin: 2_000, wealthMax: 30_000, ageMin: 60, ageMax: 90 },
];

export const ARCHETYPE_LABELS = ARCHETYPES.map(a => a.label);

// ── Trait biases ──────────────────────────────────────────────

const TRAIT_BIASES: Record<string, Partial<Record<string, number>>> = {
  noble:    { dominance_drive: 25, status_reading: 20, command_presence: 20, bloodline_pride: 25, dignity_retention: 20 },
  merchant: { negotiation: 25, barter_skill: 25, accumulation_drive: 20, debt_tolerance: 15, risk_tolerance: 15 },
  soldier:  { combat_skill: 25, weapon_affinity: 20, endurance: 20, fear_management: 15, killing_threshold: -20, tactical_mind: 20 },
  criminal: { lying_ability: 25, concealment: 20, misdirection: 20, killing_threshold: -25, vengefulness: 20, risk_tolerance: 20 },
  scholar:  { pattern_recognition: 25, medical_knowledge: 20, map_memory: 20, myth_making: 15, justice_belief: 15 },
  priest:   { death_acceptance: 25, ritual_importance: 25, destiny_belief: 20, mercy: 20, oral_tradition: 15 },
  farmer:   { foraging: 20, weather_reading: 20, stockpiling: 20, waste_aversion: 15 },
  wanderer: { wayfinding: 25, environmental_flexibility: 25, escape_instinct: 20, isolation_tolerance: 20, diet_flexibility: 20 },
  artisan:  { tool_making: 25, music: 15, myth_making: 15, skill_acquisition_speed: 15 },
  elder:    { oral_tradition: 25, death_acceptance: 20, gut_accuracy: 20, group_cohesion: 15 },
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

export function getLifespan(race: string): number {
  switch (race) {
    case 'Elf':      return rnd(250, 700);
    case 'Dwarf':    return rnd(150, 300);
    case 'Halfling': return rnd(80, 130);
    case 'Gnome':    return rnd(100, 200);
    case 'Orc':      return rnd(40, 70);
    case 'Half-Orc': return rnd(60, 90);
    case 'Tiefling': return rnd(90, 120);
    default:         return rnd(65, 90);
  }
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
  for (const traitKeys of Object.values(TRAIT_CATEGORIES)) {
    for (const key of traitKeys) {
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
  age:                 number;
  lifespan:            number;
  relationship_status: string;
  religion:            string;
  criminal_record:     object[];
  health:              number;
  morality:            number;
  happiness:           number;
  reputation:          number;
  influence:           number;
  intelligence:        number;
  physical_appearance: string;
  wealth:              number;
  traits:              Record<string, number>;
  global_scores:       Record<string, number>;
}

export function generateCharacter(archetypeLabel?: string, worldGlobalTraits: Record<string, number> = {}): GeneratedCharacter {
  const archetype = archetypeLabel
    ? (ARCHETYPES.find(a => a.label === archetypeLabel) ?? pick(ARCHETYPES))
    : pick(ARCHETYPES);

  const race       = pick(RACES);
  const gender     = pick(GENDERS);
  const lifespan   = getLifespan(race);
  const age        = Math.min(rnd(archetype.ageMin, archetype.ageMax), lifespan - 1);
  const sexuality  = pick(SEXUALITIES);

  const base = () => rnd(30, 70);
  const stat = (key: string, b: number) => clamp(b + (archetype.statBias[key] ?? 0));

  const criminalRecord = archetype.label === 'criminal' && Math.random() > 0.3
    ? [{ offense: pick(['Theft','Assault','Smuggling','Fraud','Arson','Murder','Extortion','Trespassing']), date: `${rnd(2010,2023)}-${String(rnd(1,12)).padStart(2,'0')}-${String(rnd(1,28)).padStart(2,'0')}`, severity: pick(['minor','moderate','severe']), status: pick(['convicted','pending','acquitted']) }]
    : [];

  return {
    name:                getName(race, gender),
    sexuality,
    gender,
    race,
    age,
    lifespan,
    relationship_status: pick(RELATIONSHIPS),
    religion:            pick(RELIGIONS),
    criminal_record:     criminalRecord,
    health:              stat('health',       base()),
    morality:            stat('morality',     base()),
    happiness:           stat('happiness',    base()),
    reputation:          stat('reputation',   base()),
    influence:           stat('influence',    base()),
    intelligence:        stat('intelligence', base()),
    physical_appearance: getAppearance(race, gender, age),
    wealth:              parseFloat((Math.random() * (archetype.wealthMax - archetype.wealthMin) + archetype.wealthMin).toFixed(2)),
    traits:              generateTraits(archetype.label),
    global_scores:       generateGlobalScores(worldGlobalTraits),
  };
}

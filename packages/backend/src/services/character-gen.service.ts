// ============================================================
// CHARACTER GENERATION SERVICE
// Shared logic for seeder + bulk API endpoint
// ============================================================

import { Sexuality } from '@prisma/client';
import {
  IDENTITY_ATTRIBUTES,
  GLOBAL_TRAITS,
  BIRTH_TRAIT_VARIANCE,
  MIXED_RACE_LABEL,
} from '@civ-sim/shared';

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
// Each pool is 50% modern US realistic, 25% culturally authentic, 25% anglicised/mixed.

// Caucasian (White / European descent)
const CAUCASIAN_MALE   = ['Noah','Liam','Ethan','James','Benjamin','Oliver','Henry','William','Mason','Lucas','Edmund','Cornelius','Reginald','Alistair','Hartley','Spencer','Quinn','Dylan','Morgan','Brennan'];
const CAUCASIAN_FEMALE = ['Emma','Olivia','Sophia','Ava','Isabella','Mia','Charlotte','Harper','Amelia','Evelyn','Harriet','Vivienne','Constance','Beatrice','Millicent','Kelsey','Blair','Sloane','Paige','Riley'];
const CAUCASIAN_SURNAMES = ['Thompson','Miller','Davis','Wilson','Anderson','Taylor','Harris','Clark','Lewis','Hall','Allen','Walker','Young','Baker','Campbell'];

// African American (Black / African descent)
const AFRICAN_AMERICAN_MALE   = ['Jaylen','Marcus','Darius','Jordan','Malik','Andre','Tyrese','Cameron','Isaiah','Deonte','Kofi','Kwame','Adebayo','Jomo','Amiri','DeShawn','Deandre','Quentin','Tariq','Rakim'];
const AFRICAN_AMERICAN_FEMALE = ['Aaliyah','Destiny','Jasmine','Brianna','Diamond','Keisha','Monique','Shanice','Tiffany','Tasha','Amara','Nia','Adaeze','Zuri','Fatou','Imani','Tiara','Essence','Chanelle','Shanell'];
const AFRICAN_AMERICAN_SURNAMES = ['Washington','Jefferson','Jackson','Williams','Davis','Robinson','Thompson','Moore','Brown','Harris','Taylor','Thomas','White','Walker','Carter'];

// East Asian (Chinese, Japanese, Korean)
const EAST_ASIAN_MALE   = ['Kevin','Jason','David','Michael','Brian','Ryan','Daniel','Chris','Eric','James','Hiroshi','Kenji','Jin','Wei','Mingyu','Justin','Derek','Raymond','Nelson','Roland'];
const EAST_ASIAN_FEMALE = ['Linda','Jenny','Michelle','Lisa','Amy','Christine','Sharon','Grace','Kelly','Karen','Mei','Yuki','Sakura','Xiao','Jiyeon','Vivian','Celine','Angela','Helen','Stella'];
const EAST_ASIAN_SURNAMES = ['Kim','Lee','Park','Zhang','Liu','Chen','Wang','Yang','Wu','Huang','Zhou','Li','Wong','Tanaka','Yamamoto'];

// South Asian (Indian, Pakistani, Bengali)
const SOUTH_ASIAN_MALE   = ['Raj','Arjun','Vivek','Rahul','Nikhil','Vikram','Rohan','Kiran','Neil','Arun','Subramaniam','Raghavendra','Jaishankar','Muralidharan','Venkatesh','Dev','Ravi','Jai','Anand','Jay'];
const SOUTH_ASIAN_FEMALE = ['Priya','Ananya','Neha','Pooja','Divya','Asha','Nisha','Maya','Rina','Preeti','Savitri','Padmavathi','Lakshmi','Kamakshi','Meenakshi','Mia','Leena','Tara','Raina','Kira'];
const SOUTH_ASIAN_SURNAMES = ['Sharma','Patel','Singh','Kumar','Gupta','Mehta','Rao','Nair','Reddy','Iyer','Pillai','Shah','Joshi','Agarwal','Desai'];

// Southeast Asian (Vietnamese, Filipino, Thai)
const SOUTHEAST_ASIAN_MALE   = ['Jason','Kevin','Ryan','Michael','Patrick','Mark','Joshua','Nathan','Anthony','Eric','Thanh','Duy','Niran','Bunthan','Viroj','Alex','Ricky','Leo','Christian','Ramon'];
const SOUTHEAST_ASIAN_FEMALE = ['Jessica','Christine','Michelle','Maria','Lisa','Jennifer','Angela','Karen','Grace','Nicole','Thuy','Lan','Nong','Siriporn','Marisol','Angel','Lovely','Cherry','Joy','Crystal'];
const SOUTHEAST_ASIAN_SURNAMES = ['Nguyen','Tran','Pham','Santos','Reyes','Cruz','Villanueva','Bautista','Manalo','Thongchai','Srisai','Rattana','Suphan','Nakornthap','Lopez'];

// Hispanic / Latino
const HISPANIC_MALE   = ['Carlos','Miguel','Eduardo','Roberto','Fernando','Ricardo','Diego','Luis','Jorge','Alejandro','Rigoberto','Baldomero','Celestino','Porfirio','Absalon','Alex','Tony','Jesse','Freddy','Marco'];
const HISPANIC_FEMALE = ['Sofia','Isabella','Valentina','Camila','Lucia','Gabriela','Andrea','Fernanda','Daniela','Mariana','Guadalupe','Concepcion','Socorro','Inmaculada','Dolores','Bianca','Crystal','Iris','Roxana','Destiny'];
const HISPANIC_SURNAMES = ['Martinez','Garcia','Rodriguez','Hernandez','Lopez','Gonzalez','Perez','Ramirez','Torres','Flores','Rivera','Morales','Cruz','Jimenez','Romero'];

// Native American
const NATIVE_AMERICAN_MALE   = ['James','Robert','Michael','John','Thomas','David','William','Charles','Christopher','Joseph','Chayton','Ahanu','Takoda','Nashoba','Waya','Dakota','Hunter','River','Blaze','Timber'];
const NATIVE_AMERICAN_FEMALE = ['Mary','Linda','Patricia','Barbara','Susan','Karen','Donna','Carol','Ruth','Sharon','Aiyana','Winona','Kaya','Chenoa','Sapana','Sierra','Sequoia','Savannah','Willow','Sage'];
const NATIVE_AMERICAN_SURNAMES = ['Runningwater','Lightfoot','Strongbow','Littlefeather','Bearcloud','Whitehorse','Redcloud','Swiftwind','Nightwalker','Greywolf','Blackfeather','Morningstar','Eagleheart','Silverwind','Thunderbird'];

// Middle Eastern
const MIDDLE_EASTERN_MALE   = ['Omar','Hassan','Karim','Tariq','Faris','Rami','Sami','Nabil','Yousef','Ziad','Abdulrahman','Muhammad','Sulayman','Ibraheem','Abdulaziz','Amir','Sam','Elias','Gabriel','Dario'];
const MIDDLE_EASTERN_FEMALE = ['Leila','Yasmin','Sara','Nadia','Dana','Rania','Hana','Dina','Maya','Rana','Fatimah','Khadijah','Zainab','Maryam','Aisha','Layla','Zara','Lara','Nora','Jenna'];
const MIDDLE_EASTERN_SURNAMES = ['Hassan','Ibrahim','Khalil','Mansour','Qadri','Rahman','Saleh','Younis','Aziz','Karimi','Rashid','Nasser','Jabri','Khoury','Alfarsi'];

// Indigenous Australian (Aboriginal and Torres Strait Islander)
const INDIGENOUS_AUSTRALIAN_MALE   = ['Jack','Thomas','Billy','Charlie','Liam','Noah','Oliver','James','Harry','Fred','Jarrah','Mundara','Wirri','Binda','Ngarri','Kodi','Jed','Bryce','Taj','Zane'];
const INDIGENOUS_AUSTRALIAN_FEMALE = ['Emma','Sarah','Jessica','Amy','Lily','Grace','Ruby','Chloe','Hannah','Lucy','Mirri','Kiah','Marri','Yindi','Bindi','Taylah','Sharnee','Kylie','Tamika','Shantel'];
const INDIGENOUS_AUSTRALIAN_SURNAMES = ['Williams','Thompson','Johnson','Walker','Anderson','Murphy','Ryan','King','Martin','Lee','Wilson','Taylor','Davis','Cooper','Evans'];

// Polynesian (Hawaiian, Samoan, Maori)
const POLYNESIAN_MALE   = ['Keanu','Mana','Kai','Levi','Jason','Michael','David','Jacob','Samuel','Nathan','Tane','Hemi','Wiremu','Rangi','Maui','Koa','Makoa','Kalani','Keoni','Kale'];
const POLYNESIAN_FEMALE = ['Malia','Lani','Hana','Jasmine','Grace','Emma','Lily','Amy','Hannah','Jessica','Moana','Hina','Aroha','Mere','Hinemoa','Keilani','Leilani','Talia','Nalani','Kalea'];
const POLYNESIAN_SURNAMES = ['Taufa','Faleolo','Kealoha','Paoa','Makoa','Ngata','Nainoa','Kahananui','Maea','Fono','Alatini','Havili','Tupou','Mauga','Toomalatai'];

// Race → name lookup map
type RaceNames = { male: string[]; female: string[]; surnames: string[] };
const RACE_NAMES: Record<string, RaceNames> = {
  'Caucasian':               { male: CAUCASIAN_MALE,              female: CAUCASIAN_FEMALE,              surnames: CAUCASIAN_SURNAMES },
  'African American':        { male: AFRICAN_AMERICAN_MALE,       female: AFRICAN_AMERICAN_FEMALE,       surnames: AFRICAN_AMERICAN_SURNAMES },
  'East Asian':              { male: EAST_ASIAN_MALE,             female: EAST_ASIAN_FEMALE,             surnames: EAST_ASIAN_SURNAMES },
  'South Asian':             { male: SOUTH_ASIAN_MALE,            female: SOUTH_ASIAN_FEMALE,            surnames: SOUTH_ASIAN_SURNAMES },
  'Southeast Asian':         { male: SOUTHEAST_ASIAN_MALE,        female: SOUTHEAST_ASIAN_FEMALE,        surnames: SOUTHEAST_ASIAN_SURNAMES },
  'Hispanic/Latino':         { male: HISPANIC_MALE,               female: HISPANIC_FEMALE,               surnames: HISPANIC_SURNAMES },
  'Native American':         { male: NATIVE_AMERICAN_MALE,        female: NATIVE_AMERICAN_FEMALE,        surnames: NATIVE_AMERICAN_SURNAMES },
  'Middle Eastern':          { male: MIDDLE_EASTERN_MALE,         female: MIDDLE_EASTERN_FEMALE,         surnames: MIDDLE_EASTERN_SURNAMES },
  'Indigenous Australian':   { male: INDIGENOUS_AUSTRALIAN_MALE,  female: INDIGENOUS_AUSTRALIAN_FEMALE,  surnames: INDIGENOUS_AUSTRALIAN_SURNAMES },
  'Polynesian':              { male: POLYNESIAN_MALE,             female: POLYNESIAN_FEMALE,             surnames: POLYNESIAN_SURNAMES },
};
// Fallback for any unlisted / mixed race
const FALLBACK_NAMES: RaceNames = { male: CAUCASIAN_MALE, female: CAUCASIAN_FEMALE, surnames: CAUCASIAN_SURNAMES };

export const RACES = [
  'Caucasian',
  'African American',
  'East Asian',
  'South Asian',
  'Southeast Asian',
  'Hispanic/Latino',
  'Native American',
  'Middle Eastern',
  'Indigenous Australian',
  'Polynesian',
];

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
  const pool = RACE_NAMES[race] ?? FALLBACK_NAMES;
  const first = pick(isFemale ? pool.female : pool.male);
  return `${first} ${pick(pool.surnames)}`;
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
    'Caucasian':              ['fair','porcelain','pale ivory','light beige','rosy'],
    'African American':       ['deep brown','ebony','mahogany','warm chocolate','espresso'],
    'East Asian':             ['light ivory','porcelain','warm beige','peachy','fair'],
    'South Asian':            ['warm brown','olive','tawny','golden brown','copper'],
    'Southeast Asian':        ['warm tan','golden','caramel','medium brown','bronze'],
    'Hispanic/Latino':        ['golden olive','warm tan','caramel','medium brown','bronze'],
    'Native American':        ['warm copper','golden brown','deep bronze','tawny','earthen'],
    'Middle Eastern':         ['warm olive','honey','golden tan','medium brown','amber'],
    'Indigenous Australian':  ['warm brown','deep brown','copper-brown','dark tan','chocolate'],
    'Polynesian':             ['warm golden','caramel','deep brown','bronze','copper'],
  };
  const skin  = pick(skinTones[race] ?? ['tawny','fair','olive','medium brown','bronze']);
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

// ── Child generation (Round 2 — Births) ──────────────────────────

export interface ParentSnapshot {
  id:       string;
  race:     string;
  religion: string;
  traits:   Record<string, number>;
}

/**
 * Generate a newborn from two parents per §9.3:
 *   - Traits: mean(A, B) per key + random(-BIRTH_TRAIT_VARIANCE, +N), clamped.
 *   - Race: if parents match → same; else MIXED_RACE_LABEL.
 *   - Religion: chosen by caller (see `pickChildReligion`) and passed in.
 *   - Age 0, death_age 60-95, wealth 0, relationship_status 'Single'.
 *   - Gender/sexuality rolled normally.
 *   - Appearance rolled from child's own race + gender.
 */
export function generateChildCharacter(
  parentA:      ParentSnapshot,
  parentB:      ParentSnapshot,
  religion:     string,
  worldGlobalTraits: Record<string, number> = {},
): GeneratedCharacter {
  const gender    = pick(GENDERS);
  const sexuality = pick(SEXUALITIES);

  const race = parentA.race === parentB.race ? parentA.race : MIXED_RACE_LABEL;
  const death_age = getLifespan(race);

  // Inherit traits: mean of parents + variance, clamped.
  const traits: Record<string, number> = {};
  for (const attrKeys of Object.values(IDENTITY_ATTRIBUTES)) {
    for (const key of attrKeys) {
      const a = parentA.traits[key] ?? 50;
      const b = parentB.traits[key] ?? 50;
      const mean     = (a + b) / 2;
      const variance = rnd(-BIRTH_TRAIT_VARIANCE, BIRTH_TRAIT_VARIANCE);
      traits[key] = clamp(Math.round(mean + variance));
    }
  }
  const health = traits['health'] ?? 100;

  return {
    name:                getName(race === MIXED_RACE_LABEL ? pick([parentA.race, parentB.race]) : race, gender),
    sexuality,
    gender,
    race,
    occupation:          'commoner',
    age:                 0,
    death_age,
    relationship_status: 'Single',
    religion,
    criminal_record:     [],
    health,
    physical_appearance: `Newborn. ${getAppearance(race === MIXED_RACE_LABEL ? parentA.race : race, gender, 0)}`,
    wealth:              0,
    traits,
    global_scores:       generateGlobalScores(worldGlobalTraits),
  };
}

/**
 * Score a religion's virus_profile against a person's traits. Returns a 0-1
 * fit score — fraction of threshold rules the person satisfies (within
 * tolerance). Used to decide which parent's religion a newborn inherits when
 * the two parents differ.
 *
 * An empty or malformed virus_profile yields score = 1 (treated as "easy fit"
 * so an unconfigured religion isn't penalised).
 */
export function scoreReligionFit(
  traits:  Record<string, number>,
  profile: Record<string, { min?: number; max?: number }>,
  tolerance = 10,
): number {
  const rules = Object.entries(profile ?? {});
  if (rules.length === 0) return 1;
  let met = 0;
  for (const [key, rule] of rules) {
    const v = traits[key];
    if (v === undefined) continue; // unknown keys don't count for or against
    const lo = (rule.min ?? -Infinity) - tolerance;
    const hi = (rule.max ??  Infinity) + tolerance;
    if (v >= lo && v <= hi) met++;
  }
  return met / rules.length;
}

/**
 * Pick the religion a newborn inherits from their two parents per the
 * "whichever religion aligns with the child's statistics" rule.
 *
 * - If neither parent has a religion registered in the world, returns the
 *   first non-empty string (or 'None' as a fallback).
 * - If both parents share a religion, it's inherited unchanged.
 * - If the parents differ, each religion is scored against the child's traits
 *   and the higher fit wins. Ties break toward parent A.
 *
 * `registered` maps religion name → virus_profile + tolerance. Parent-side
 * religions not in `registered` (e.g. "Agnostic", "None") score 0 so the
 * registered side wins when available; if neither is registered, parent A's
 * string is returned.
 */
export function pickChildReligion(
  childTraits: Record<string, number>,
  parentA:     ParentSnapshot,
  parentB:     ParentSnapshot,
  registered:  Map<string, { profile: Record<string, { min?: number; max?: number }>; tolerance: number }>,
): string {
  const a = parentA.religion || 'None';
  const b = parentB.religion || 'None';
  if (a === b) return a;
  const regA = registered.get(a);
  const regB = registered.get(b);
  const scoreA = regA ? scoreReligionFit(childTraits, regA.profile, regA.tolerance) : 0;
  const scoreB = regB ? scoreReligionFit(childTraits, regB.profile, regB.tolerance) : 0;
  if (scoreA === 0 && scoreB === 0) return a; // neither registered — default parent A
  return scoreB > scoreA ? b : a;
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

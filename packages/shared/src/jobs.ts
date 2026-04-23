// ============================================================
// JOBS — 100 occupations souls can hold in the simulation.
//
// Each job defines:
//   id            — stable string key (stored in Person.job_id)
//   title         — display name
//   category      — grouping (10 categories × 10 jobs)
//   base_pay      — money earned per tick while employed
//   trait_weights — flat trait keys → weight (must sum to 1.0)
//                   Score = Σ(trait_value × weight), giving 0–100.
//   min_score     — score floor: fall below → fired
//   max_score     — score ceiling: rise above → quits for better opportunity
//
// bestFitJob() iterates ALL_JOBS sorted by base_pay DESC and returns the
// first job where score >= min_score. Unemployed souls are those who
// exceed max_score for every job they qualify for, or meet none at all.
// ============================================================

export interface JobDef {
  id:            string;
  title:         string;
  category:      'labor' | 'craft' | 'trade' | 'military' | 'academic' | 'medicine' | 'faith' | 'art' | 'governance' | 'criminal';
  base_pay:      number;
  trait_weights: Record<string, number>;
  min_score:     number;
  max_score:     number;
}

// ── Job definitions (sorted by base_pay DESC for bestFitJob()) ──────────────

export const ALL_JOBS: JobDef[] = [
  // ── GOVERNANCE (50–220/tick) ────────────────────────────────────────────
  { id: 'king',              title: 'King',              category: 'governance', base_pay: 220, trait_weights: { charisma: 0.30, ambition: 0.25, intelligence: 0.20, courage: 0.15, discipline: 0.10 }, min_score: 82, max_score: 99 },
  { id: 'queen',             title: 'Queen',             category: 'governance', base_pay: 220, trait_weights: { charisma: 0.30, intelligence: 0.25, ambition: 0.20, willpower: 0.15, intuition: 0.10 }, min_score: 82, max_score: 99 },
  { id: 'vizier',            title: 'Vizier',            category: 'governance', base_pay: 175, trait_weights: { intelligence: 0.35, charisma: 0.30, cunning: 0.20, ambition: 0.15 }, min_score: 78, max_score: 92 },
  { id: 'governor',          title: 'Governor',          category: 'governance', base_pay: 155, trait_weights: { charisma: 0.30, intelligence: 0.25, ambition: 0.20, courage: 0.15, discipline: 0.10 }, min_score: 75, max_score: 90 },
  { id: 'chancellor',        title: 'Chancellor',        category: 'governance', base_pay: 135, trait_weights: { intelligence: 0.35, charisma: 0.30, ambition: 0.20, discipline: 0.15 }, min_score: 70, max_score: 88 },
  { id: 'ambassador',        title: 'Ambassador',        category: 'governance', base_pay: 105, trait_weights: { charisma: 0.35, intelligence: 0.30, cunning: 0.20, empathy: 0.15 }, min_score: 65, max_score: 87 },
  { id: 'judge',             title: 'Judge',             category: 'governance', base_pay: 92,  trait_weights: { intelligence: 0.35, willpower: 0.30, charisma: 0.20, discipline: 0.15 }, min_score: 62, max_score: 86 },
  { id: 'steward',           title: 'Steward',           category: 'governance', base_pay: 78,  trait_weights: { intelligence: 0.35, discipline: 0.30, loyalty: 0.20, charisma: 0.15 }, min_score: 58, max_score: 83 },
  { id: 'magistrate',        title: 'Magistrate',        category: 'governance', base_pay: 72,  trait_weights: { intelligence: 0.35, charisma: 0.30, willpower: 0.20, discipline: 0.15 }, min_score: 55, max_score: 82 },
  { id: 'tax_collector',     title: 'Tax Collector',     category: 'governance', base_pay: 50,  trait_weights: { charisma: 0.40, cunning: 0.35, discipline: 0.25 }, min_score: 42, max_score: 75 },

  // ── MEDICINE (38–130/tick) ──────────────────────────────────────────────
  { id: 'hospital_director', title: 'Hospital Director', category: 'medicine',   base_pay: 130, trait_weights: { intelligence: 0.35, charisma: 0.25, ambition: 0.20, empathy: 0.20 }, min_score: 70, max_score: 90 },
  { id: 'surgeon',           title: 'Surgeon',           category: 'medicine',   base_pay: 105, trait_weights: { intelligence: 0.35, agility: 0.35, discipline: 0.20, willpower: 0.10 }, min_score: 65, max_score: 88 },
  { id: 'physician',         title: 'Physician',         category: 'medicine',   base_pay: 85,  trait_weights: { intelligence: 0.40, empathy: 0.25, discipline: 0.25, intuition: 0.10 }, min_score: 60, max_score: 85 },
  { id: 'plague_doctor',     title: 'Plague Doctor',     category: 'medicine',   base_pay: 72,  trait_weights: { courage: 0.35, intelligence: 0.35, resilience: 0.20, willpower: 0.10 }, min_score: 52, max_score: 82 },
  { id: 'apothecary',        title: 'Apothecary',        category: 'medicine',   base_pay: 62,  trait_weights: { intelligence: 0.45, creativity: 0.30, discipline: 0.25 }, min_score: 48, max_score: 80 },
  { id: 'barber_surgeon',    title: 'Barber-Surgeon',    category: 'medicine',   base_pay: 58,  trait_weights: { agility: 0.35, intelligence: 0.40, endurance: 0.25 }, min_score: 45, max_score: 78 },
  { id: 'healer',            title: 'Healer',            category: 'medicine',   base_pay: 52,  trait_weights: { empathy: 0.40, intelligence: 0.35, intuition: 0.25 }, min_score: 40, max_score: 75 },
  { id: 'bone_setter',       title: 'Bone Setter',       category: 'medicine',   base_pay: 52,  trait_weights: { agility: 0.40, intelligence: 0.35, endurance: 0.25 }, min_score: 40, max_score: 75 },
  { id: 'midwife',           title: 'Midwife',           category: 'medicine',   base_pay: 45,  trait_weights: { empathy: 0.40, intelligence: 0.35, courage: 0.25 }, min_score: 35, max_score: 70 },
  { id: 'herbalist',         title: 'Herbalist',         category: 'medicine',   base_pay: 38,  trait_weights: { intelligence: 0.40, intuition: 0.35, empathy: 0.25 }, min_score: 32, max_score: 68 },

  // ── ACADEMIC (35–125/tick) ──────────────────────────────────────────────
  { id: 'astronomer',        title: 'Astronomer',        category: 'academic',   base_pay: 125, trait_weights: { intelligence: 0.45, intuition: 0.30, discipline: 0.25 }, min_score: 65, max_score: 88 },
  { id: 'alchemist',         title: 'Alchemist',         category: 'academic',   base_pay: 88,  trait_weights: { intelligence: 0.40, creativity: 0.35, intuition: 0.25 }, min_score: 62, max_score: 87 },
  { id: 'professor',         title: 'Professor',         category: 'academic',   base_pay: 78,  trait_weights: { intelligence: 0.40, charisma: 0.35, discipline: 0.25 }, min_score: 58, max_score: 85 },
  { id: 'philosopher',       title: 'Philosopher',       category: 'academic',   base_pay: 72,  trait_weights: { intelligence: 0.35, intuition: 0.25, creativity: 0.25, willpower: 0.15 }, min_score: 55, max_score: 85 },
  { id: 'scholar',           title: 'Scholar',           category: 'academic',   base_pay: 62,  trait_weights: { intelligence: 0.45, discipline: 0.30, intuition: 0.25 }, min_score: 52, max_score: 82 },
  { id: 'historian',         title: 'Historian',         category: 'academic',   base_pay: 55,  trait_weights: { intelligence: 0.40, willpower: 0.35, intuition: 0.25 }, min_score: 48, max_score: 80 },
  { id: 'archivist',         title: 'Archivist',         category: 'academic',   base_pay: 52,  trait_weights: { intelligence: 0.45, discipline: 0.35, loyalty: 0.20 }, min_score: 45, max_score: 78 },
  { id: 'cartographer',      title: 'Cartographer',      category: 'academic',   base_pay: 48,  trait_weights: { intelligence: 0.40, creativity: 0.35, intuition: 0.25 }, min_score: 42, max_score: 75 },
  { id: 'librarian',         title: 'Librarian',         category: 'academic',   base_pay: 42,  trait_weights: { intelligence: 0.45, willpower: 0.30, discipline: 0.25 }, min_score: 38, max_score: 72 },
  { id: 'scribe',            title: 'Scribe',            category: 'academic',   base_pay: 35,  trait_weights: { intelligence: 0.55, discipline: 0.45 }, min_score: 35, max_score: 68 },

  // ── FAITH (18–95/tick) ──────────────────────────────────────────────────
  { id: 'prophet',           title: 'Prophet',           category: 'faith',      base_pay: 95,  trait_weights: { charisma: 0.35, willpower: 0.30, courage: 0.20, intuition: 0.15 }, min_score: 68, max_score: 90 },
  { id: 'high_priest',       title: 'High Priest',       category: 'faith',      base_pay: 88,  trait_weights: { charisma: 0.40, intelligence: 0.30, willpower: 0.30 }, min_score: 65, max_score: 88 },
  { id: 'bishop',            title: 'Bishop',            category: 'faith',      base_pay: 72,  trait_weights: { charisma: 0.35, intelligence: 0.25, willpower: 0.25, ambition: 0.15 }, min_score: 58, max_score: 84 },
  { id: 'oracle',            title: 'Oracle',            category: 'faith',      base_pay: 65,  trait_weights: { intuition: 0.40, charisma: 0.30, willpower: 0.20, creativity: 0.10 }, min_score: 52, max_score: 82 },
  { id: 'inquisitor',        title: 'Inquisitor',        category: 'faith',      base_pay: 58,  trait_weights: { willpower: 0.35, cunning: 0.30, courage: 0.20, discipline: 0.15 }, min_score: 48, max_score: 78 },
  { id: 'preacher',          title: 'Preacher',          category: 'faith',      base_pay: 45,  trait_weights: { charisma: 0.40, willpower: 0.35, creativity: 0.25 }, min_score: 38, max_score: 72 },
  { id: 'priest',            title: 'Priest',            category: 'faith',      base_pay: 42,  trait_weights: { charisma: 0.40, willpower: 0.35, empathy: 0.25 }, min_score: 35, max_score: 70 },
  { id: 'temple_keeper',     title: 'Temple Keeper',     category: 'faith',      base_pay: 32,  trait_weights: { willpower: 0.40, loyalty: 0.35, discipline: 0.25 }, min_score: 30, max_score: 65 },
  { id: 'monk',              title: 'Monk',              category: 'faith',      base_pay: 26,  trait_weights: { willpower: 0.40, discipline: 0.40, loyalty: 0.20 }, min_score: 25, max_score: 60 },
  { id: 'acolyte',           title: 'Acolyte',           category: 'faith',      base_pay: 18,  trait_weights: { willpower: 0.55, loyalty: 0.45 }, min_score: 20, max_score: 52 },

  // ── CRIMINAL (18–105/tick) ──────────────────────────────────────────────
  { id: 'crime_lord',        title: 'Crime Lord',        category: 'criminal',   base_pay: 105, trait_weights: { intelligence: 0.30, charisma: 0.30, cunning: 0.25, ambition: 0.15 }, min_score: 68, max_score: 90 },
  { id: 'gang_leader',       title: 'Gang Leader',       category: 'criminal',   base_pay: 82,  trait_weights: { charisma: 0.35, cunning: 0.30, strength: 0.20, courage: 0.15 }, min_score: 62, max_score: 86 },
  { id: 'assassin',          title: 'Assassin',          category: 'criminal',   base_pay: 72,  trait_weights: { agility: 0.35, cunning: 0.35, discipline: 0.20, willpower: 0.10 }, min_score: 55, max_score: 83 },
  { id: 'forger',            title: 'Forger',            category: 'criminal',   base_pay: 52,  trait_weights: { creativity: 0.35, intelligence: 0.35, agility: 0.20, cunning: 0.10 }, min_score: 42, max_score: 78 },
  { id: 'con_artist',        title: 'Con Artist',        category: 'criminal',   base_pay: 48,  trait_weights: { charisma: 0.40, cunning: 0.35, creativity: 0.25 }, min_score: 40, max_score: 75 },
  { id: 'fence',             title: 'Fence',             category: 'criminal',   base_pay: 42,  trait_weights: { cunning: 0.40, charisma: 0.35, intelligence: 0.25 }, min_score: 35, max_score: 72 },
  { id: 'smuggler',          title: 'Smuggler',          category: 'criminal',   base_pay: 38,  trait_weights: { cunning: 0.40, agility: 0.35, courage: 0.25 }, min_score: 32, max_score: 68 },
  { id: 'thief',             title: 'Thief',             category: 'criminal',   base_pay: 28,  trait_weights: { agility: 0.45, cunning: 0.35, discipline: 0.20 }, min_score: 25, max_score: 62 },
  { id: 'bandit',            title: 'Bandit',            category: 'criminal',   base_pay: 25,  trait_weights: { strength: 0.40, courage: 0.35, cunning: 0.25 }, min_score: 22, max_score: 58 },
  { id: 'street_urchin',     title: 'Street Urchin',     category: 'criminal',   base_pay: 18,  trait_weights: { agility: 0.45, cunning: 0.55 }, min_score: 18, max_score: 50 },

  // ── MILITARY (22–95/tick) ───────────────────────────────────────────────
  { id: 'general',           title: 'General',           category: 'military',   base_pay: 95,  trait_weights: { intelligence: 0.30, charisma: 0.25, ambition: 0.20, discipline: 0.15, courage: 0.10 }, min_score: 68, max_score: 90 },
  { id: 'battle_mage',       title: 'Battle Mage',       category: 'military',   base_pay: 85,  trait_weights: { intelligence: 0.40, willpower: 0.35, courage: 0.25 }, min_score: 62, max_score: 86 },
  { id: 'guard_captain',     title: 'Guard Captain',     category: 'military',   base_pay: 78,  trait_weights: { charisma: 0.30, discipline: 0.30, strength: 0.20, courage: 0.20 }, min_score: 58, max_score: 84 },
  { id: 'knight',            title: 'Knight',            category: 'military',   base_pay: 72,  trait_weights: { strength: 0.30, endurance: 0.25, courage: 0.25, discipline: 0.20 }, min_score: 55, max_score: 82 },
  { id: 'spy',               title: 'Spy',               category: 'military',   base_pay: 65,  trait_weights: { cunning: 0.35, agility: 0.25, charisma: 0.25, willpower: 0.15 }, min_score: 50, max_score: 80 },
  { id: 'sergeant',          title: 'Sergeant',          category: 'military',   base_pay: 55,  trait_weights: { strength: 0.30, discipline: 0.30, charisma: 0.20, courage: 0.20 }, min_score: 45, max_score: 78 },
  { id: 'cavalry',           title: 'Cavalry',           category: 'military',   base_pay: 45,  trait_weights: { agility: 0.40, strength: 0.35, courage: 0.25 }, min_score: 38, max_score: 72 },
  { id: 'archer',            title: 'Archer',            category: 'military',   base_pay: 38,  trait_weights: { agility: 0.40, discipline: 0.35, willpower: 0.25 }, min_score: 32, max_score: 68 },
  { id: 'soldier',           title: 'Soldier',           category: 'military',   base_pay: 35,  trait_weights: { strength: 0.35, endurance: 0.30, courage: 0.20, discipline: 0.15 }, min_score: 30, max_score: 65 },
  { id: 'conscript',         title: 'Conscript',         category: 'military',   base_pay: 22,  trait_weights: { strength: 0.50, courage: 0.50 }, min_score: 22, max_score: 55 },

  // ── TRADE (28–85/tick) ──────────────────────────────────────────────────
  { id: 'guild_master',      title: 'Guild Master',      category: 'trade',      base_pay: 85,  trait_weights: { charisma: 0.30, intelligence: 0.30, ambition: 0.20, discipline: 0.20 }, min_score: 58, max_score: 85 },
  { id: 'ship_merchant',     title: 'Ship Merchant',     category: 'trade',      base_pay: 75,  trait_weights: { intelligence: 0.35, charisma: 0.35, courage: 0.30 }, min_score: 55, max_score: 83 },
  { id: 'money_lender',      title: 'Money Lender',      category: 'trade',      base_pay: 68,  trait_weights: { intelligence: 0.40, cunning: 0.35, ambition: 0.25 }, min_score: 50, max_score: 82 },
  { id: 'spice_trader',      title: 'Spice Trader',      category: 'trade',      base_pay: 62,  trait_weights: { charisma: 0.35, cunning: 0.35, intelligence: 0.30 }, min_score: 48, max_score: 80 },
  { id: 'merchant',          title: 'Merchant',          category: 'trade',      base_pay: 58,  trait_weights: { intelligence: 0.35, charisma: 0.35, cunning: 0.30 }, min_score: 45, max_score: 78 },
  { id: 'appraiser',         title: 'Appraiser',         category: 'trade',      base_pay: 52,  trait_weights: { intelligence: 0.40, intuition: 0.35, discipline: 0.25 }, min_score: 42, max_score: 75 },
  { id: 'auctioneer',        title: 'Auctioneer',        category: 'trade',      base_pay: 50,  trait_weights: { charisma: 0.40, intelligence: 0.35, cunning: 0.25 }, min_score: 40, max_score: 75 },
  { id: 'innkeeper',         title: 'Innkeeper',         category: 'trade',      base_pay: 42,  trait_weights: { charisma: 0.40, empathy: 0.35, discipline: 0.25 }, min_score: 35, max_score: 70 },
  { id: 'market_keeper',     title: 'Market Keeper',     category: 'trade',      base_pay: 35,  trait_weights: { charisma: 0.50, intelligence: 0.50 }, min_score: 32, max_score: 65 },
  { id: 'peddler',           title: 'Peddler',           category: 'trade',      base_pay: 28,  trait_weights: { charisma: 0.50, cunning: 0.50 }, min_score: 28, max_score: 60 },

  // ── ART (10–75/tick) ────────────────────────────────────────────────────
  { id: 'master_artist',     title: 'Master Artist',     category: 'art',        base_pay: 75,  trait_weights: { creativity: 0.40, intelligence: 0.25, discipline: 0.25, intuition: 0.10 }, min_score: 60, max_score: 85 },
  { id: 'court_entertainer', title: 'Court Entertainer', category: 'art',        base_pay: 65,  trait_weights: { charisma: 0.40, creativity: 0.30, agility: 0.20, cunning: 0.10 }, min_score: 52, max_score: 82 },
  { id: 'playwright',        title: 'Playwright',        category: 'art',        base_pay: 52,  trait_weights: { creativity: 0.40, intelligence: 0.35, intuition: 0.25 }, min_score: 45, max_score: 78 },
  { id: 'actor',             title: 'Actor',             category: 'art',        base_pay: 42,  trait_weights: { charisma: 0.45, creativity: 0.30, agility: 0.25 }, min_score: 38, max_score: 72 },
  { id: 'sculptor',          title: 'Sculptor',          category: 'art',        base_pay: 42,  trait_weights: { creativity: 0.40, strength: 0.35, discipline: 0.25 }, min_score: 38, max_score: 72 },
  { id: 'musician',          title: 'Musician',          category: 'art',        base_pay: 40,  trait_weights: { creativity: 0.45, charisma: 0.30, discipline: 0.25 }, min_score: 35, max_score: 72 },
  { id: 'poet',              title: 'Poet',              category: 'art',        base_pay: 38,  trait_weights: { creativity: 0.45, intelligence: 0.30, intuition: 0.25 }, min_score: 35, max_score: 70 },
  { id: 'painter',           title: 'Painter',           category: 'art',        base_pay: 35,  trait_weights: { creativity: 0.50, discipline: 0.30, intuition: 0.20 }, min_score: 32, max_score: 68 },
  { id: 'bard',              title: 'Bard',              category: 'art',        base_pay: 25,  trait_weights: { charisma: 0.40, creativity: 0.35, intuition: 0.25 }, min_score: 28, max_score: 62 },
  { id: 'street_performer',  title: 'Street Performer',  category: 'art',        base_pay: 10,  trait_weights: { charisma: 0.40, creativity: 0.35, agility: 0.25 }, min_score: 15, max_score: 48 },

  // ── CRAFT (22–55/tick) ──────────────────────────────────────────────────
  { id: 'jeweler',           title: 'Jeweler',           category: 'craft',      base_pay: 55,  trait_weights: { agility: 0.35, creativity: 0.35, intelligence: 0.30 }, min_score: 45, max_score: 78 },
  { id: 'armorer',           title: 'Armorer',           category: 'craft',      base_pay: 48,  trait_weights: { strength: 0.35, intelligence: 0.35, discipline: 0.30 }, min_score: 42, max_score: 75 },
  { id: 'glassblower',       title: 'Glassblower',       category: 'craft',      base_pay: 42,  trait_weights: { agility: 0.40, creativity: 0.35, discipline: 0.25 }, min_score: 38, max_score: 72 },
  { id: 'blacksmith',        title: 'Blacksmith',        category: 'craft',      base_pay: 40,  trait_weights: { strength: 0.40, endurance: 0.35, discipline: 0.25 }, min_score: 38, max_score: 72 },
  { id: 'mason',             title: 'Mason',             category: 'craft',      base_pay: 36,  trait_weights: { strength: 0.40, endurance: 0.30, intelligence: 0.30 }, min_score: 35, max_score: 68 },
  { id: 'carpenter',         title: 'Carpenter',         category: 'craft',      base_pay: 32,  trait_weights: { strength: 0.35, intelligence: 0.35, creativity: 0.30 }, min_score: 32, max_score: 65 },
  { id: 'weaver',            title: 'Weaver',            category: 'craft',      base_pay: 30,  trait_weights: { agility: 0.40, creativity: 0.30, discipline: 0.30 }, min_score: 30, max_score: 65 },
  { id: 'brewer',            title: 'Brewer',            category: 'craft',      base_pay: 28,  trait_weights: { endurance: 0.40, creativity: 0.30, intuition: 0.30 }, min_score: 28, max_score: 62 },
  { id: 'tanner',            title: 'Tanner',            category: 'craft',      base_pay: 25,  trait_weights: { endurance: 0.50, discipline: 0.50 }, min_score: 28, max_score: 60 },
  { id: 'baker',             title: 'Baker',             category: 'craft',      base_pay: 22,  trait_weights: { endurance: 0.40, discipline: 0.30, creativity: 0.30 }, min_score: 25, max_score: 58 },

  // ── LABOR (5–22/tick) ───────────────────────────────────────────────────
  { id: 'lumberjack',        title: 'Lumberjack',        category: 'labor',      base_pay: 22,  trait_weights: { strength: 0.50, agility: 0.50 }, min_score: 30, max_score: 60 },
  { id: 'miner',             title: 'Miner',             category: 'labor',      base_pay: 20,  trait_weights: { strength: 0.50, endurance: 0.50 }, min_score: 28, max_score: 58 },
  { id: 'fisherman',         title: 'Fisherman',         category: 'labor',      base_pay: 18,  trait_weights: { agility: 0.40, endurance: 0.40, resilience: 0.20 }, min_score: 22, max_score: 55 },
  { id: 'dockworker',        title: 'Dockworker',        category: 'labor',      base_pay: 18,  trait_weights: { strength: 0.50, endurance: 0.50 }, min_score: 25, max_score: 55 },
  { id: 'stable_hand',       title: 'Stable Hand',       category: 'labor',      base_pay: 14,  trait_weights: { agility: 0.40, empathy: 0.30, resilience: 0.30 }, min_score: 20, max_score: 48 },
  { id: 'porter',            title: 'Porter',            category: 'labor',      base_pay: 14,  trait_weights: { strength: 0.50, endurance: 0.50 }, min_score: 15, max_score: 48 },
  { id: 'gravedigger',       title: 'Gravedigger',       category: 'labor',      base_pay: 15,  trait_weights: { endurance: 0.40, willpower: 0.30, resilience: 0.30 }, min_score: 20, max_score: 48 },
  { id: 'farm_hand',         title: 'Farm Hand',         category: 'labor',      base_pay: 12,  trait_weights: { strength: 0.40, endurance: 0.40, resilience: 0.20 }, min_score: 18, max_score: 45 },
  { id: 'street_sweeper',    title: 'Street Sweeper',    category: 'labor',      base_pay: 8,   trait_weights: { endurance: 0.50, resilience: 0.50 }, min_score: 10, max_score: 38 },
  { id: 'beggar',            title: 'Beggar',            category: 'labor',      base_pay: 5,   trait_weights: { endurance: 0.50, resilience: 0.50 }, min_score: 0,  max_score: 30 },
];

// ── Quick lookup map ──────────────────────────────────────────────────────────

export const JOB_BY_ID: Map<string, JobDef> = new Map(
  ALL_JOBS.map(j => [j.id, j])
);

// ── Score computation ─────────────────────────────────────────────────────────

/**
 * Compute a soul's competency score (0–100) for a given job.
 * Uses flat trait keys (e.g. "strength", "intelligence").
 * Traits not present in the person default to 50 (neutral).
 */
export function computeJobScore(traits: Record<string, number>, job: JobDef): number {
  let score = 0;
  for (const [key, weight] of Object.entries(job.trait_weights)) {
    score += (traits[key] ?? 50) * weight;
  }
  return Math.round(score);
}

// ── Job state transitions ─────────────────────────────────────────────────────

/** Soul's score fell below min_score — they get fired. */
export function shouldBeFired(traits: Record<string, number>, job: JobDef): boolean {
  return computeJobScore(traits, job) < job.min_score;
}

/** Soul's score exceeded max_score — too good, they quit for better work. */
export function shouldQuit(traits: Record<string, number>, job: JobDef): boolean {
  return computeJobScore(traits, job) > job.max_score;
}

/**
 * Find the best-fitting job for a soul.
 * Returns the highest-paying job where score >= min_score AND score <= max_score.
 * Returns null if no job qualifies (soul remains unemployed).
 * ALL_JOBS is already sorted by base_pay DESC so the first match wins.
 */
export function bestFitJob(traits: Record<string, number>): JobDef | null {
  for (const job of ALL_JOBS) {
    const score = computeJobScore(traits, job);
    if (score >= job.min_score && score <= job.max_score) return job;
  }
  return null;
}

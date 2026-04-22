// ============================================================
// NewCharacter — summon a single soul into the realm
// ============================================================

import { useNavigate, Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Sexuality } from '@civ-sim/shared';
import { useReducer, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────

interface FormState {
  name:                string;
  gender:              string;
  race:                string;
  occupation:          string;
  sexuality:           Sexuality;
  age:                 number;
  death_age:           number;
  religion:            string;
  relationship_status: string;
  physical_appearance: string;
  wealth:              number;
  health:              number;
}

type FormAction =
  | { type: 'SET'; field: keyof FormState; value: string | number | Sexuality }
  | { type: 'RANDOMIZE'; preset?: string };

// ── Generation data (mirrors backend, runs in browser) ────────

const GENDERS      = ['Male','Male','Male','Female','Female','Female','Non-binary','Agender'];
const RACES        = ['Human','Human','Human','Human','Human','Human','Elf','Elf','Dwarf','Halfling','Half-Orc','Orc','Tiefling','Gnome'];
const RELIGIONS    = ['The Old Faith','The Flame Church','Nature Covenant','Order of the Pale Star','Temple of Coin','Brotherhood of Iron','The Unnamed Path','Church of the Wanderer','Cult of the Deep','Sunwalkers','Agnostic','None'];
const RELATIONSHIPS= ['Single','Single','Single','Married','Married','Married','Widowed','Divorced','Betrothed','Estranged','In a relationship','Complicated'];
const SEXUALITIES  = [Sexuality.HETEROSEXUAL,Sexuality.HETEROSEXUAL,Sexuality.HETEROSEXUAL,Sexuality.HETEROSEXUAL,Sexuality.HETEROSEXUAL,Sexuality.HETEROSEXUAL,Sexuality.HOMOSEXUAL,Sexuality.BISEXUAL,Sexuality.BISEXUAL,Sexuality.ASEXUAL,Sexuality.PANSEXUAL];

const HUMAN_MALE   = ['Aldric','Brennan','Caspian','Dorian','Edwyn','Faelen','Garrett','Hugo','Ivar','Jasper','Kiran','Leander','Maddox','Nolan','Oswin','Pierce','Quillan','Rowan','Stellan','Theron','Ulric','Vance','Weston','Xander','York'];
const HUMAN_FEMALE = ['Aelindra','Brynn','Caelith','Dara','Elara','Fenna','Gwen','Hilde','Isolde','Jessa','Kira','Lena','Maren','Niamh','Owyn','Petra','Quinn','Reva','Sable','Tess','Una','Vesper','Wren','Xara','Ysolde'];
const ELF_M        = ['Aelthar','Caladwen','Erevan','Faelindor','Galadon','Ilmyrth','Liriel','Mirendel'];
const ELF_F        = ['Aelindra','Caladria','Elaera','Faelwen','Gilraen','Ioreth','Luthien','Mirial'];
const DWARF        = ['Baldrek','Dolgrin','Forgrim','Gundrak','Haldrik','Korgath','Morgrul','Thordak','Agna','Bofri','Gudla','Helka','Ingra','Kilda','Morda','Thorda'];
const ORC          = ['Grak','Urzog','Thrak','Morg','Krag','Varg','Skorn','Drak','Grasha','Urka','Vorka','Skara','Marka','Nasha'];
const HALFLING     = ['Barlo','Cob','Finwick','Merry','Pip','Rolo','Tob','Wendel','Bree','Calla','Dessa','Fern','Lily','Mira','Nessa','Tam'];
const TIEFLING     = ['Ash','Cinder','Dusk','Ember','Hex','Morrow','Ruin','Sable','Torment','Vex'];
const SURNAMES     = ['Ashveil','Blackthorn','Coldwater','Duskmantle','Emberholt','Frostwick','Greystone','Hawkmere','Ironwood','Jadepeak','Kessler','Lightbane','Merrow','Nighthollow','Oakhaven','Pinecroft','Redmane','Stormgate','Thornbury','Underhill','Valdris','Whitlock','Yarwick','Zephyrcross'];

const ARCHETYPES: Record<string, { healthBias: number; wealthMin: number; wealthMax: number; ageMin: number; ageMax: number }> = {
  noble:    { healthBias:  0, wealthMin: 80_000,  wealthMax: 600_000, ageMin: 20, ageMax: 65 },
  merchant: { healthBias:  0, wealthMin: 10_000,  wealthMax: 200_000, ageMin: 25, ageMax: 60 },
  soldier:  { healthBias: 15, wealthMin: 500,     wealthMax: 5_000,   ageMin: 18, ageMax: 45 },
  criminal: { healthBias:  0, wealthMin: 200,     wealthMax: 15_000,  ageMin: 16, ageMax: 50 },
  scholar:  { healthBias:  0, wealthMin: 1_000,   wealthMax: 8_000,   ageMin: 22, ageMax: 70 },
  priest:   { healthBias:  0, wealthMin: 300,     wealthMax: 4_000,   ageMin: 25, ageMax: 75 },
  farmer:   { healthBias: 10, wealthMin: 50,      wealthMax: 2_000,   ageMin: 16, ageMax: 70 },
  wanderer: { healthBias:  0, wealthMin: 0,       wealthMax: 500,     ageMin: 16, ageMax: 60 },
  artisan:  { healthBias:  0, wealthMin: 1_000,   wealthMax: 12_000,  ageMin: 20, ageMax: 65 },
  elder:    { healthBias:-15, wealthMin: 2_000,   wealthMax: 30_000,  ageMin: 60, ageMax: 90 },
};

function rnd(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(n: number) { return Math.max(0, Math.min(100, n)); }

// v1 design: all races use the same 60-95 year lifespan
function getLifespan(_race: string) { return rnd(60, 95); }

function getName(race: string, gender: string) {
  const isFemale = gender === 'Female';
  const first = (() => {
    switch (race) {
      case 'Elf': return pick(isFemale ? ELF_F : ELF_M);
      case 'Dwarf': return pick(DWARF);
      case 'Orc': case 'Half-Orc': return pick(ORC);
      case 'Halfling': return pick(HALFLING);
      case 'Tiefling': return pick(TIEFLING);
      default: return pick(isFemale ? HUMAN_FEMALE : HUMAN_MALE);
    }
  })();
  return (race === 'Orc' || race === 'Tiefling') ? first : `${first} ${pick(SURNAMES)}`;
}

function getAppearance(race: string, gender: string, age: number) {
  const skinTones: Record<string,string[]> = {
    Human: ['fair','olive','tawny','dark brown','pale','sun-bronzed'],
    Elf: ['porcelain','pale silver','sun-kissed ivory','moonlit white'],
    Dwarf: ['ruddy','weather-beaten','tanned','ruddy brown'],
    Halfling: ['rosy','tanned','freckled bronze'],
    Gnome: ['earthy tan','pale lavender','rosy brown'],
    Orc: ['grey-green','dark olive','mossy green','deep grey'],
    'Half-Orc': ['grey-olive','weathered green','dusky olive'],
    Tiefling: ['deep crimson','ash grey','pale lavender','midnight blue'],
  };
  const build = pick(['lean','stocky','wiry','broad-shouldered','slight','muscular','heavyset','lanky']);
  const eyes  = pick(['grey','brown','green','blue','amber','violet','silver','gold']);
  const hair  = pick(['black','dark brown','auburn','chestnut','golden','silver','white','ash-blonde','copper','raven']);
  const skin  = pick(skinTones[race] ?? skinTones.Human);
  const aged  = age > 60 ? ' Deep lines mark a life well-lived.' : age < 20 ? ' Still bearing the softness of youth.' : '';
  void gender;
  return `${build.charAt(0).toUpperCase() + build.slice(1)} build with ${skin} skin and ${eyes} eyes. ${hair.charAt(0).toUpperCase() + hair.slice(1)} hair worn ${pick(['loose','braided','cropped short','tied back','wild','in a topknot'])}.${aged}`;
}

function buildRandom(preset?: string): FormState {
  const arch      = preset ? ARCHETYPES[preset] : pick(Object.values(ARCHETYPES));
  const archlabel = preset ?? pick(Object.keys(ARCHETYPES));
  const race      = pick(RACES);
  const gender    = pick(GENDERS);
  const death_age = getLifespan(race);
  const age       = Math.min(rnd(arch.ageMin, arch.ageMax), death_age - 1);

  return {
    name:                getName(race, gender),
    gender,
    race,
    occupation:          archlabel,
    sexuality:           pick(SEXUALITIES),
    age,
    death_age,
    religion:            pick(RELIGIONS),
    relationship_status: pick(RELATIONSHIPS),
    physical_appearance: getAppearance(race, gender, age),
    wealth:              parseFloat((Math.random() * (arch.wealthMax - arch.wealthMin) + arch.wealthMin).toFixed(2)),
    health:              clamp(rnd(30, 70) + arch.healthBias),
  };
}

const BLANK: FormState = {
  name: '', gender: '', race: '', occupation: 'commoner', sexuality: Sexuality.HETEROSEXUAL,
  age: 25, death_age: 80, religion: '', relationship_status: '',
  physical_appearance: '', wealth: 0, health: 100,
};

function reducer(state: FormState, action: FormAction): FormState {
  if (action.type === 'SET') return { ...state, [action.field]: action.value };
  if (action.type === 'RANDOMIZE') return buildRandom(action.preset);
  return state;
}

// ── Sub-components ────────────────────────────────────────────

function StatSlider({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  const color     = value >= 67 ? 'bg-emerald-500' : value >= 34 ? 'bg-amber-400' : 'bg-red-500';
  const textColor = value >= 67 ? 'text-emerald-400' : value >= 34 ? 'text-amber-300' : 'text-red-400';
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <label className="text-[10px] text-muted uppercase tracking-widest">{label}</label>
        <span className={`text-xs font-medium tabular-nums w-7 text-right ${textColor}`}>{value}</span>
      </div>
      <div className="relative h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-150 ${color}`} style={{ width: `${value}%` }} />
      </div>
      <input type="range" min={0} max={100} value={value} onChange={e => onChange(Number(e.target.value))}
        className="w-full appearance-none bg-transparent h-2 -mt-2 relative cursor-pointer" style={{ outline: 'none' }} />
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] text-muted uppercase tracking-widest block">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputClass = 'w-full bg-surface border border-border rounded px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-gray-500 placeholder-muted';

const ARCHETYPE_LABELS = ['noble','merchant','soldier','criminal','scholar','priest','farmer','wanderer','artisan','elder'];

// ── Page ──────────────────────────────────────────────────────

export default function NewCharacter() {
  const navigate = useNavigate();
  const qc       = useQueryClient();
  const [form, dispatch] = useReducer(reducer, BLANK);

  const set = useCallback((field: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      dispatch({ type: 'SET', field, value: e.target.value }),
  []);

  const setNum = useCallback((field: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      dispatch({ type: 'SET', field, value: Number(e.target.value) }),
  []);

  const mutation = useMutation({
    mutationFn: () => api.characters.create({
      ...form,
      criminal_record: [],
      traits:          {},
      global_scores:   {},
    }),
    onSuccess: (person) => {
      qc.invalidateQueries({ queryKey: ['characters'] });
      navigate(`/characters/${person.id}`);
    },
  });

  const canSubmit = form.name.trim() && form.gender.trim() && form.race.trim() &&
    form.religion.trim() && form.relationship_status.trim() && form.physical_appearance.trim();

  return (
    <div className="min-h-screen p-6 max-w-3xl mx-auto">

      <nav className="text-[10px] text-muted mb-6">
        <Link to="/" className="hover:text-gold transition-colors">The Realm</Link>
        {' / '}
        <span className="text-gray-300">Summon Soul</span>
      </nav>

      <div className="flex items-center justify-between mb-8">
        <h1 className="font-display text-2xl font-bold text-gold tracking-widest uppercase">
          Summon a Soul
        </h1>
        <button
          onClick={() => dispatch({ type: 'RANDOMIZE' })}
          className="btn-ghost text-xs px-3 py-1.5"
        >
          ⚄ Randomize All
        </button>
      </div>

      {/* Archetype presets */}
      <div className="flex flex-wrap gap-1.5 mb-6">
        {ARCHETYPE_LABELS.map(label => (
          <button
            key={label}
            onClick={() => dispatch({ type: 'RANDOMIZE', preset: label })}
            className="px-2.5 py-1 text-[10px] uppercase tracking-widest rounded border border-border text-muted hover:border-amber-600 hover:text-amber-400 transition-colors"
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-6">

        {/* Identity */}
        <div className="panel p-5 space-y-4">
          <h2 className="font-display text-[10px] text-gold/80 uppercase tracking-widest">Identity</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Name" required>
              <input className={inputClass} placeholder="e.g. Aldric Thornbury" value={form.name} onChange={set('name')} />
            </Field>
            <Field label="Gender" required>
              <input className={inputClass} placeholder="e.g. Male, Female, Non-binary" value={form.gender} onChange={set('gender')} />
            </Field>
            <Field label="Race" required>
              <input className={inputClass} placeholder="e.g. Human, Elf, Dwarf" value={form.race} onChange={set('race')} />
            </Field>
            <Field label="Sexuality">
              <select className={inputClass} value={form.sexuality} onChange={set('sexuality')}>
                {Object.values(Sexuality).map(s => (
                  <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>
                ))}
              </select>
            </Field>
            <Field label="Occupation" required>
              <input className={inputClass} placeholder="e.g. merchant, soldier, farmer" value={form.occupation} onChange={set('occupation')} />
            </Field>
            <Field label="Religion" required>
              <input className={inputClass} placeholder="e.g. The Old Faith, Agnostic" value={form.religion} onChange={set('religion')} />
            </Field>
            <Field label="Relationship Status" required>
              <input className={inputClass} placeholder="e.g. Single, Married, Widowed" value={form.relationship_status} onChange={set('relationship_status')} />
            </Field>
          </div>
          <Field label="Physical Appearance" required>
            <textarea className={`${inputClass} resize-none`} rows={2} placeholder="Describe their appearance…"
              value={form.physical_appearance} onChange={set('physical_appearance')} />
          </Field>
        </div>

        {/* Life & Fortune */}
        <div className="panel p-5 space-y-4">
          <h2 className="font-display text-[10px] text-gold/80 uppercase tracking-widest">Life & Fortune</h2>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Age">
              <input type="number" className={inputClass} min={0} max={999} value={form.age} onChange={setNum('age')} />
            </Field>
            <Field label="Death Age">
              <input type="number" className={inputClass} min={1} max={999} value={form.death_age} onChange={setNum('death_age')} />
            </Field>
            <Field label="Wealth ($)">
              <input type="number" className={inputClass} min={0} value={form.wealth} onChange={setNum('wealth')} />
            </Field>
          </div>
        </div>

        {/* Core Stats */}
        <div className="panel p-5 space-y-4">
          <h2 className="font-display text-[10px] text-gold/80 uppercase tracking-widest">Vital</h2>
          <StatSlider label="Health" value={form.health} onChange={v => dispatch({ type: 'SET', field: 'health', value: v })} />
          <p className="text-[10px] text-zinc-600">
            Identity traits (25 attributes) are generated from archetype when this character is summoned.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-4">
          <Link to="/" className="btn-ghost">Cancel</Link>
          <div className="flex items-center gap-3">
            {mutation.isError && (
              <span className="text-red-400 text-xs">{(mutation.error as Error).message}</span>
            )}
            <button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending} className="btn-sim px-6">
              {mutation.isPending ? 'Summoning…' : 'Summon Soul'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

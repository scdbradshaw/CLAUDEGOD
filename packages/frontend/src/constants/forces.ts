// ============================================================
// Shared FORCE_CONFIG — single source for all force metadata.
// Previously copy-pasted across CharacterCard, CharacterDetail,
// World, and Economy. Import from here instead.
// ============================================================

export interface ForceEntry {
  key:         string;
  label:       string;
  textColor:   string;
  borderColor: string;
  bgColor:     string;
}

export const FORCE_CONFIG: ForceEntry[] = [
  { key: 'scarcity',  label: 'Scarcity',  textColor: 'text-amber-400',  borderColor: 'border-amber-700/60',  bgColor: 'bg-amber-900/20'  },
  { key: 'war',       label: 'War',        textColor: 'text-red-400',    borderColor: 'border-red-700/60',    bgColor: 'bg-red-900/20'    },
  { key: 'faith',     label: 'Faith',      textColor: 'text-violet-400', borderColor: 'border-violet-700/60', bgColor: 'bg-violet-900/20' },
  { key: 'plague',    label: 'Plague',     textColor: 'text-green-400',  borderColor: 'border-green-700/60',  bgColor: 'bg-green-900/20'  },
  { key: 'tyranny',   label: 'Tyranny',    textColor: 'text-orange-400', borderColor: 'border-orange-700/60', bgColor: 'bg-orange-900/20' },
  { key: 'discovery', label: 'Discovery',  textColor: 'text-sky-400',    borderColor: 'border-sky-700/60',    bgColor: 'bg-sky-900/20'    },
];

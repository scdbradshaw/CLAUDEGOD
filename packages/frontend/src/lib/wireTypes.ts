// Minimal client-side types for backend response payloads.
// Fields mirror backend serializers (e.g. random_seed_root is a decimal string).

import type { RegionResource } from '@claude-god/shared';
export type { MarketSignalsEntry } from '@claude-god/shared';
import type { MarketSignalsEntry } from '@claude-god/shared';

export interface WorldSummary {
  id: string;
  name: string;
  current_year: number;
  market_index: number;
  created_at: string;
}

export interface WorldDetail {
  world: {
    id: string;
    name: string;
    current_year: number;
    market_index: number;
    market_trend: number;
    random_seed_root: string;
    prejudice_against_same_sex: boolean;
    state_history: unknown;
    market_index_history: Array<{ year: number; index: number }>;
    market_signals_history: MarketSignalsEntry[];
    created_at: string;
  };
  city: CityRow | null;
  buckets: BucketRow[];
}

export interface CityRow {
  id: string;
  world_id: string;
  name: string;
  x: number;
  y: number;
  founded_year: number;
  is_ruined: boolean;
  population_total: number;
  avg_wealth: number;
  mood_score: number;
  dominant_faction_id: string | null;
  dominant_religion_id: string | null;
  region_resource: RegionResource;
  defense_rating: number;
  treasury: number;
  mayor_id: string | null;
  tax_rate: number;
  garrison_size: number;
  prejudice_level: number;
}

export interface BucketRow {
  city_id: string;
  type: string;
  count: number;
  avg_age: number;
  avg_wealth: number;
  avg_intelligence: number;
  avg_happiness: number;
  avg_health: number;
  avg_combat: number;
  avg_sexuality: number;
  birth_rate: number;
  death_rate: number;
}

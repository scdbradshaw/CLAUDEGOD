// ============================================================
// BACKEND-SIDE TYPE LAYER
// Re-exports shared types and adds Zod validation schemas.
// ============================================================

export {
  Sexuality,
  type Person,
  type MemoryEntry,
  type CriminalRecord,
  type PersonDelta,
  type DeltaRequest,
  type MutationResult,
  type EmotionalImpact,
  type CriminalRecordEntry,
  type CharacterListItem,
  type PaginatedResponse,
  type FilterClause,
  type FilterQuery,
  type BulkDeltaField,
  type BulkActionRequest,
  type BulkActionResult,
  type Tone,
} from '@civ-sim/shared';

import { z } from 'zod';
import { Sexuality, TONES } from '@civ-sim/shared';

// --------------- Shared validators ---------------

const statSchema = z.number().int().min(0).max(100);

// --------------- Criminal Record ---------------

export const CriminalRecordSchema = z.object({
  offense:  z.string().min(1),
  date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  severity: z.enum(['minor', 'moderate', 'severe']),
  status:   z.enum(['pending', 'convicted', 'acquitted']),
  notes:    z.string().optional(),
});

// --------------- Create Person ---------------

export const CreatePersonSchema = z.object({
  name:                z.string().min(1).max(100),
  sexuality:           z.nativeEnum(Sexuality),
  gender:              z.string().min(1).max(50),
  race:                z.string().min(1).max(50),
  occupation:          z.string().min(1).max(100).default('commoner'),
  age:                 z.number().int().min(0).max(999),
  death_age:           z.number().int().min(1).max(999).default(80),
  relationship_status: z.string().min(1).max(100),
  religion:            z.string().min(1).max(100),
  criminal_record:     z.array(CriminalRecordSchema).default([]),
  current_health:      statSchema.default(100),
  physical_appearance: z.string().min(1),
  money:               z.number().int().min(0).default(0),
});

export type CreatePersonInput = z.infer<typeof CreatePersonSchema>;

// --------------- Delta (partial update) ---------------

export const PersonDeltaSchema = z.object({
  name:                z.string().min(1).max(100).optional(),
  sexuality:           z.nativeEnum(Sexuality).optional(),
  gender:              z.string().min(1).max(50).optional(),
  race:                z.string().min(1).max(50).optional(),
  occupation:          z.string().min(1).max(100).optional(),
  age:                 z.number().int().min(0).max(999).optional(),
  death_age:           z.number().int().min(1).max(999).optional(),
  relationship_status: z.string().min(1).max(100).optional(),
  religion:            z.string().min(1).max(100).optional(),
  current_health:      statSchema.optional(),
  physical_appearance: z.string().min(1).optional(),
  money:               z.number().int().optional(),
});

// --------------- Delta Request ---------------

const ToneSchema = z.enum(TONES as unknown as [string, ...string[]]);

export const DeltaRequestSchema = z.object({
  delta:            PersonDeltaSchema.refine(
    (d) => Object.keys(d).length > 0,
    { message: 'Delta must contain at least one field' },
  ),
  event_summary:    z.string().min(1).max(500),
  emotional_impact: z.enum(['traumatic', 'negative', 'neutral', 'positive', 'euphoric']),
  force:            z.boolean().default(false),
  tone:             ToneSchema.optional(),
  trait_overrides:  z.record(z.string(), z.number().min(0).max(100)).optional(),
});

// --------------- Criminal Record Request ---------------

export const CriminalRecordRequestSchema = z.object({
  record:        CriminalRecordSchema,
  event_summary: z.string().min(1).max(500),
  tone:          ToneSchema.optional(),
});

// --------------- Bulk Create ---------------

export const BulkCreateSchema = z.object({
  count:     z.number().int().min(1).max(1000),
  archetype: z.string().optional(), // if omitted, random per character
});

// --------------- Bulk Filter Action ---------------

const SCALAR_NUMERIC_FIELDS = ['age', 'current_health', 'money'] as const;

const SCALAR_STRING_FIELDS = ['race', 'occupation', 'religion', 'gender'] as const;

const numericOp  = z.enum(['lt', 'lte', 'gt', 'gte']);
const dotPathRe  = /^(trait|global_score)\..+$/;

// z.discriminatedUnion requires unique discriminator values across all members,
// but 'lt'/'lte'/'gt'/'gte'/'between' appear in both scalar and dot-path branches.
// z.union has no such constraint and is otherwise equivalent for validation.
const FilterClauseSchema = z.union([
  // numeric scalar — single threshold
  z.object({
    field: z.enum(SCALAR_NUMERIC_FIELDS),
    op:    numericOp,
    value: z.number(),
  }),
  // numeric scalar — range
  z.object({
    field: z.enum(SCALAR_NUMERIC_FIELDS),
    op:    z.literal('between'),
    min:   z.number(),
    max:   z.number(),
  }),
  // string scalar — exact match
  z.object({
    field: z.enum(SCALAR_STRING_FIELDS),
    op:    z.literal('eq'),
    value: z.string().min(1),
  }),
  // string scalar — set membership
  z.object({
    field:  z.enum(SCALAR_STRING_FIELDS),
    op:     z.literal('in'),
    values: z.array(z.string().min(1)).min(1),
  }),
  // JSONB dot-path (trait.* or global_score.*) — single threshold
  z.object({
    field: z.string().regex(dotPathRe, 'Must be trait.<key> or global_score.<key>'),
    op:    numericOp,
    value: z.number(),
  }),
  // JSONB dot-path — range
  z.object({
    field: z.string().regex(dotPathRe, 'Must be trait.<key> or global_score.<key>'),
    op:    z.literal('between'),
    min:   z.number(),
    max:   z.number(),
  }),
]);

const BulkDeltaFieldSchema = z.object({
  mode:  z.enum(['set', 'nudge']),
  value: z.number(),
});

export const BulkActionSchema = z.object({
  filters: z.array(FilterClauseSchema).min(1, 'At least one filter is required'),
  delta:   z
    .record(z.string(), BulkDeltaFieldSchema)
    .refine((d) => Object.keys(d).length > 0, { message: 'Delta must contain at least one field' }),
  event_summary:    z.string().min(1).max(500),
  emotional_impact: z.enum(['traumatic', 'negative', 'neutral', 'positive', 'euphoric']),
  tone:             ToneSchema.optional(),
});

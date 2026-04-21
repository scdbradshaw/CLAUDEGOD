// ============================================================
// /api/god-mode — Force-set any attribute, bypass all rules
// ============================================================

import { Router, Request, Response } from 'express';
import { applyDelta, applyBulkFilter } from '../services/simulation.service';
import { validate } from '../middleware/validate';
import { DeltaRequestSchema, BulkActionSchema } from '../types/person';

const router = Router();

/**
 * POST /api/god-mode/:id
 *
 * Body shape (same as /delta but `force` is always true):
 * {
 *   delta:            { happiness: 100, wealth: 9999999 },
 *   event_summary:    "Divine intervention — granted eternal joy",
 *   emotional_impact: "euphoric"
 * }
 *
 * Simulation rules are completely bypassed.
 * The memory bank entry records the event with the applied delta.
 */
/**
 * POST /api/god-mode/bulk
 *
 * Apply a delta to all persons matching the filter query.
 * Each matched person gets a MemoryBank entry.
 *
 * Body shape:
 * {
 *   filters:          [{ field: "age", op: "lt", value: 10 }],
 *   delta:            { "wealth": { mode: "nudge", value: 100000 } },
 *   event_summary:    "Divine boon — children blessed with fortune",
 *   emotional_impact: "euphoric"
 * }
 */
router.post('/bulk', validate(BulkActionSchema), async (req: Request, res: Response) => {
  const result = await applyBulkFilter(req.body);
  res.json(result);
});

router.post('/:id', validate(DeltaRequestSchema), async (req: Request, res: Response) => {
  const { delta, event_summary, emotional_impact } = req.body;

  const result = await applyDelta({
    personId:        req.params.id,
    delta,
    event_summary,
    emotional_impact,
    force: true,            // God Mode always forces
  });

  res.json(result);
});

export default router;

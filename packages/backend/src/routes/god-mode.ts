// ============================================================
// /api/god-mode — Force-set any attribute, bypass all rules
// ============================================================

import { Router, Request, Response } from 'express';
import { applyDelta } from '../services/simulation.service';
import { validate } from '../middleware/validate';
import { DeltaRequestSchema } from '../types/person';

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

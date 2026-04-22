-- Round 3 — Trauma modifier
--
-- Adds a `trauma_score` float column to `persons`. Accumulated at memory
-- write time from negative emotional impacts, decayed annually on the
-- year-boundary tick, and subtracted from interaction scores so a
-- traumatized character's world darkens.

ALTER TABLE "persons"
  ADD COLUMN "trauma_score" DOUBLE PRECISION NOT NULL DEFAULT 0;

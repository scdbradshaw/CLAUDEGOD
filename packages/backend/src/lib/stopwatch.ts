// Lightweight step timer for the year pipeline.
// Call tick(label) after each step — it records time since the last tick.

export interface StepTiming {
  step: string;
  ms: number;
}

export class Stopwatch {
  private readonly steps: StepTiming[] = [];
  private last = Date.now();

  tick(step: string): void {
    const now = Date.now();
    this.steps.push({ step, ms: now - this.last });
    this.last = now;
  }

  result(): StepTiming[] {
    return [...this.steps];
  }

  totalMs(): number {
    return this.steps.reduce((s, t) => s + t.ms, 0);
  }
}

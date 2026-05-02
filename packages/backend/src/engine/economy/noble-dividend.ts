// Noble tax dividend (role-power: nobility lives off the realm's taxes).
//
// Each year, NOBLE_DIVIDEND_PCT of the city's tax_collected is split among
// every Noble in the city. The dividend is debited from city.treasury (the
// taxes have already been deposited there by `applyIncomeAndTax`) and split
// per-capita across:
//   • all alive real Noble persons in the city, and
//   • the Noble bucket aggregate (averaged into avg_wealth).
//
// Per-capita amount = floor(dividend / total_nobles). Any rounding remainder
// stays in the treasury (cleaner than splitting fractional gold).
//
// If there are no Nobles at all the dividend is skipped (treasury keeps it).

export const NOBLE_DIVIDEND_PCT = 0.20;

export interface NobleDividendInput {
  /** Total tax revenue collected from buckets THIS YEAR (before dividend). */
  tax_collected: number;
  /** City treasury balance after taxes were deposited. Source of dividend. */
  treasury: number;
  /** Count of alive real-person Nobles in the city. */
  real_noble_count: number;
  /** Count of bucket-aggregate Nobles in the city. */
  bucket_noble_count: number;
}

export interface NobleDividendResult {
  /** Total amount removed from treasury and paid out as dividends. */
  total_paid: number;
  /** New treasury balance after the dividend payout. */
  new_treasury: number;
  /** Per-capita gold amount each Noble receives (floor-divided). */
  per_noble: number;
  /** Total credited to real-person Nobles (= per_noble × real_noble_count). */
  to_real_nobles: number;
  /** Total credited to the bucket aggregate (= per_noble × bucket_noble_count). */
  to_bucket: number;
}

export function computeNobleDividend(
  input: NobleDividendInput,
): NobleDividendResult {
  const totalNobles = input.real_noble_count + input.bucket_noble_count;
  const noop: NobleDividendResult = {
    total_paid: 0,
    new_treasury: input.treasury,
    per_noble: 0,
    to_real_nobles: 0,
    to_bucket: 0,
  };
  if (totalNobles <= 0) return noop;
  if (input.tax_collected <= 0) return noop;

  const target = Math.floor(input.tax_collected * NOBLE_DIVIDEND_PCT);
  const available = Math.max(0, Math.min(target, input.treasury));
  if (available <= 0) return noop;

  const perNoble = Math.floor(available / totalNobles);
  if (perNoble <= 0) return noop;

  const totalPaid = perNoble * totalNobles;
  return {
    total_paid: totalPaid,
    new_treasury: input.treasury - totalPaid,
    per_noble: perNoble,
    to_real_nobles: perNoble * input.real_noble_count,
    to_bucket: perNoble * input.bucket_noble_count,
  };
}

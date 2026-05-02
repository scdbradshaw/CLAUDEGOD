// Phase 10 — economy engine barrel.

export { applyDues } from './dues';
export { applyTheft } from './theft';
export { applyTrade } from './trade';
export { applyRealPersonIncome, incomeMultiplierFor } from './real-income';
export { applyRealPersonInvestment } from './real-investment';
export { computeClassSignals } from './class-signals';
export type { ClassSignalsInput, ClassSignalsResult } from './class-signals';
export {
  computeNobleDividend,
  NOBLE_DIVIDEND_PCT,
} from './noble-dividend';
export type {
  NobleDividendInput,
  NobleDividendResult,
} from './noble-dividend';
export type {
  ActiveEventTags,
  GroupForDues,
  RealPersonForEconomy,
  DuesInput,
  DuesResult,
  DuesGroupOutcome,
  RealMemberDuesOutcome,
} from './types';
export type { TheftStepResult } from './theft';
export type { TradeStepResult, CityForTrade } from './trade';
export type { RealIncomeResult } from './real-income';
export type { RealInvestmentResult } from './real-investment';

// ============================================================
// ThreeMarketCard — compact world-panel card showing all three
// market indices (trusUS / dreamBIG / riskAwin) on one line.
// ============================================================

interface Quote { index: number; trend: number; }
interface Props {
  trusUS:   Quote;
  dreamBIG: Quote;
  riskAwin: Quote;
}

const COLORS = {
  trusUS:   '#60a5fa',
  dreamBIG: '#fbbf24',
  riskAwin: '#f87171',
};

function Leg({ name, q, color }: { name: string; q: Quote; color: string }) {
  const up = q.trend >= 0;
  return (
    <div className="flex flex-col items-center min-w-0">
      <span className="text-[9px] font-medium truncate" style={{ color }}>{name}</span>
      <span className={`text-sm font-bold font-display tabular-nums ${up ? 'text-emerald-400' : 'text-red-400'}`}>
        {q.index.toFixed(2)}
      </span>
    </div>
  );
}

export default function ThreeMarketCard({ trusUS, dreamBIG, riskAwin }: Props) {
  return (
    <div className="panel p-3 text-center">
      <div className="label mb-1">Markets</div>
      <div className="flex items-center justify-around gap-1">
        <Leg name="trusUS"   q={trusUS}   color={COLORS.trusUS}   />
        <Leg name="dreamBIG" q={dreamBIG} color={COLORS.dreamBIG} />
        <Leg name="riskAwin" q={riskAwin} color={COLORS.riskAwin} />
      </div>
    </div>
  );
}

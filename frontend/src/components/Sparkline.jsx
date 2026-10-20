// A small 5-minute sparkline for a KPI tile (PHASES Oct 21 #2). Decorative
// shape, with its meaning and latest value in the aria-label.

const W = 120;
const H = 24;

export default function Sparkline({ values, label }) {
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? W / (values.length - 1) : W;
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(H - 1 - (v / max) * (H - 2)).toFixed(1)}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <polyline points={points} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

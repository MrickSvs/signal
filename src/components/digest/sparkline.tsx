import { formatNumber } from "@/lib/format";

const WIDTH = 96;
const HEIGHT = 28;
const PAD = 3;

/**
 * Feedbacks per week, oldest first (insights.trend.weekly, computed in code, §8.8). The last
 * point is the last 7 days. The counts are in the label and the tooltip.
 */
export function Sparkline({ weekly }: { weekly: number[] }) {
  if (weekly.length < 2) return null;
  const max = Math.max(1, ...weekly);
  const x = (i: number) => PAD + (i * (WIDTH - 2 * PAD)) / (weekly.length - 1);
  const y = (n: number) => HEIGHT - PAD - (n / max) * (HEIGHT - 2 * PAD);
  const points = weekly.map((n, i) => `${x(i).toFixed(1)},${y(n).toFixed(1)}`).join(" ");
  const label = `Retours par semaine sur ${weekly.length} semaines : ${weekly.map((n) => formatNumber(n)).join(", ")}`;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      className="shrink-0 overflow-visible text-signal"
    >
      <title>{label}</title>
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={x(weekly.length - 1)} cy={y(weekly.at(-1)!)} r={2.5} fill="currentColor" />
    </svg>
  );
}

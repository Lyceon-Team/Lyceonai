type DayStatus = "no_plan" | "missed" | "partial" | "met" | "exceeded";

interface ProgressRingProps {
  pct: number;
  status: DayStatus;
  size?: number;
  strokeWidth?: number;
  title?: string;
}

function getStrokeColor(status: DayStatus): string {
  switch (status) {
    case "no_plan":
      return "#9ca3af";
    case "missed":
      return "#f87171";
    case "partial":
      return "#2dd4bf";
    case "met":
      return "#14b8a6";
    case "exceeded":
      return "#16a34a";
    default:
      return "#9ca3af";
  }
}

export function ProgressRing({
  pct,
  status,
  size = 16,
  strokeWidth = 2,
  title,
}: ProgressRingProps) {
  const clampedPct = Math.max(0, Math.min(100, pct));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clampedPct / 100) * circumference;
  const strokeColor = getStrokeColor(status);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ transform: "rotate(-90deg)" }}
      aria-hidden={!title}
    >
      {title && <title>{title}</title>}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#e5e7eb"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
      />
    </svg>
  );
}

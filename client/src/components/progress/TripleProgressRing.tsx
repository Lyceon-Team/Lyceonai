type DayStatus = "planned" | "missed" | "in_progress" | "complete";

interface RingData {
  pct: number;
  color: string;
}

interface TripleProgressRingProps {
  totalPct: number;
  mathPct: number;
  rwPct: number;
  status: DayStatus;
  size?: number;
  strokeWidth?: number;
}

function getStatusColor(status: DayStatus, pct: number = 100): string {
  switch (status) {
    case "planned":
      return "#9ca3af";
    case "missed":
      return "#f87171";
    case "in_progress":
      return "#2dd4bf";
    case "complete":
      return pct > 100 ? "#16a34a" : "#14b8a6";
    default:
      return "#9ca3af";
  }
}

const RING_COLORS = {
  total: "#14b8a6",
  math: "#3b82f6",
  rw: "#a855f7",
};

export function TripleProgressRing({
  totalPct,
  mathPct,
  rwPct,
  status,
  size = 40,
  strokeWidth = 3,
}: TripleProgressRingProps) {
  const gap = 2;
  const rings: RingData[] = [
    { pct: totalPct, color: status === "planned" ? "#9ca3af" : getStatusColor(status, totalPct) },
    { pct: mathPct, color: RING_COLORS.math },
    { pct: rwPct, color: RING_COLORS.rw },
  ];

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ transform: "rotate(-90deg)" }}
      aria-label={`Progress: ${totalPct}% total, ${mathPct}% math, ${rwPct}% reading & writing`}
    >
      {rings.map((ring, index) => {
        const radius = (size - strokeWidth) / 2 - index * (strokeWidth + gap);
        if (radius <= 0) return null;
        
        const circumference = 2 * Math.PI * radius;
        const clampedPct = Math.max(0, Math.min(100, ring.pct));
        const offset = circumference - (clampedPct / 100) * circumference;

        return (
          <g key={index}>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="#e5e7eb"
              strokeWidth={strokeWidth}
              opacity={0.4}
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={ring.color}
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
            />
          </g>
        );
      })}
    </svg>
  );
}

interface TripleProgressRingLegendProps {
  totalPct: number;
  mathPct: number;
  rwPct: number;
  className?: string;
}

export function TripleProgressRingLegend({
  totalPct,
  mathPct,
  rwPct,
  className = "",
}: TripleProgressRingLegendProps) {
  return (
    <div className={`flex flex-col gap-1 text-xs ${className}`}>
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-teal-500" />
        <span className="text-muted-foreground">Total: {totalPct}%</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-blue-500" />
        <span className="text-muted-foreground">Math: {mathPct}%</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-purple-500" />
        <span className="text-muted-foreground">R&W: {rwPct}%</span>
      </div>
    </div>
  );
}

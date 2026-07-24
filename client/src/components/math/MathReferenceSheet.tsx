/**
 * @spec [CodingStandards_v1, §9 Practice Engine Contracts] | @implemented [2026-07-24]
 * SAT Math Reference Sheet — all 12 official formulas rendered via KaTeX,
 * plus the two special right triangle diagrams (30-60-90, 45-45-90) as inline SVG.
 */
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { MathRenderer } from "@/components/MathRenderer";

type MathReferenceSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const geometryFormulas: { label: string; latex: string }[] = [
  { label: "Circle area", latex: "$A = \\pi r^2$" },
  { label: "Circle circumference", latex: "$C = 2\\pi r$" },
  { label: "Rectangle area", latex: "$A = lw$" },
  { label: "Triangle area", latex: "$A = \\frac{1}{2}bh$" },
  { label: "Pythagorean theorem", latex: "$a^2 + b^2 = c^2$" },
];

const volumeFormulas: { label: string; latex: string }[] = [
  { label: "Rectangular prism", latex: "$V = lwh$" },
  { label: "Cylinder", latex: "$V = \\pi r^2 h$" },
  { label: "Sphere", latex: "$V = \\frac{4}{3}\\pi r^3$" },
  { label: "Cone", latex: "$V = \\frac{1}{3}\\pi r^2 h$" },
  { label: "Pyramid", latex: "$V = \\frac{1}{3}lwh$" },
];

const reminders: string[] = [
  "A full circle has $360$ degrees.",
  "A full circle has $2\\pi$ radians.",
  "Triangle interior angles sum to $180$ degrees.",
];

function FormulaList({
  items,
}: {
  items: { label: string; latex: string }[];
}): React.ReactElement {
  return (
    <ul className="space-y-3 text-sm text-foreground">
      {items.map((item) => (
        <li key={item.label} className="flex items-baseline gap-2">
          <span className="text-muted-foreground shrink-0">{item.label}:</span>
          <MathRenderer content={item.latex} />
        </li>
      ))}
    </ul>
  );
}

function SpecialTriangle3060({
  className,
}: {
  className?: string;
}): React.ReactElement {
  return (
    <div className={className}>
      <p className="text-xs font-semibold text-muted-foreground mb-2">
        30-60-90 Triangle
      </p>
      <svg
        viewBox="0 0 200 160"
        className="w-full max-w-[220px] mx-auto"
        aria-label="30-60-90 special right triangle with sides x, x√3, 2x"
        role="img"
      >
        {/* Triangle */}
        <polygon
          points="20,140 180,140 20,20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        {/* Right angle marker */}
        <polyline
          points="20,125 35,125 35,140"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        {/* Side labels */}
        <text x="5" y="85" fontSize="14" fill="currentColor" textAnchor="end">
          x√3
        </text>
        <text
          x="100"
          y="155"
          fontSize="14"
          fill="currentColor"
          textAnchor="middle"
        >
          x
        </text>
        <text
          x="108"
          y="72"
          fontSize="14"
          fill="currentColor"
          textAnchor="start"
        >
          2x
        </text>
        {/* Angle labels */}
        <text x="35" y="18" fontSize="12" fill="currentColor">
          60°
        </text>
        <text x="155" y="137" fontSize="12" fill="currentColor">
          30°
        </text>
      </svg>
    </div>
  );
}

function SpecialTriangle4545({
  className,
}: {
  className?: string;
}): React.ReactElement {
  return (
    <div className={className}>
      <p className="text-xs font-semibold text-muted-foreground mb-2">
        45-45-90 Triangle
      </p>
      <svg
        viewBox="0 0 180 160"
        className="w-full max-w-[200px] mx-auto"
        aria-label="45-45-90 special right triangle with sides s, s, s√2"
        role="img"
      >
        {/* Triangle */}
        <polygon
          points="20,140 160,140 20,20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        {/* Right angle marker */}
        <polyline
          points="20,125 35,125 35,140"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        {/* Side labels */}
        <text x="8" y="85" fontSize="14" fill="currentColor" textAnchor="end">
          s
        </text>
        <text
          x="90"
          y="155"
          fontSize="14"
          fill="currentColor"
          textAnchor="middle"
        >
          s
        </text>
        <text
          x="98"
          y="72"
          fontSize="14"
          fill="currentColor"
          textAnchor="start"
        >
          s√2
        </text>
        {/* Angle labels */}
        <text x="30" y="25" fontSize="12" fill="currentColor">
          45°
        </text>
        <text x="130" y="137" fontSize="12" fill="currentColor">
          45°
        </text>
      </svg>
    </div>
  );
}

export default function MathReferenceSheet({
  open,
  onOpenChange,
}: MathReferenceSheetProps): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-background border-border/60">
        <DialogHeader>
          <DialogTitle className="text-2xl tracking-tight">
            Math Reference Sheet
          </DialogTitle>
          <DialogDescription>
            Standard SAT formulas provided as a quick in-session reference.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-2">
          <section className="rounded-xl bg-secondary/50 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-3">
              Geometry
            </h3>
            <FormulaList items={geometryFormulas} />
          </section>

          <section className="rounded-xl bg-secondary/50 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-3">
              Volume
            </h3>
            <FormulaList items={volumeFormulas} />
          </section>
        </div>

        <section className="rounded-xl bg-secondary/50 p-5">
          <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-3">
            Special Right Triangles
          </h3>
          <div className="grid gap-6 sm:grid-cols-2">
            <SpecialTriangle3060 />
            <SpecialTriangle4545 />
          </div>
        </section>

        <section className="rounded-xl bg-card border border-border/60 p-5">
          <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-3">
            Core Reminders
          </h3>
          <ul className="space-y-2 text-sm text-foreground">
            {reminders.map((note) => (
              <li key={note}>
                <MathRenderer content={note} />
              </li>
            ))}
          </ul>
        </section>
      </DialogContent>
    </Dialog>
  );
}

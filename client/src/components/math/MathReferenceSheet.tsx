/**
 * @spec [CodingStandards_v1, §9 Practice Engine Contracts] | @implemented [2026-07-24]
 * SAT Math Reference Sheet — all 12 official formulas rendered via KaTeX,
 * plus the two special right triangle diagrams (30-60-90, 45-45-90) as inline SVG.
 *
 * UI-53 (2026-10-03, student-UI register F-65, DESIGN.md §1): rendered in the student Modal, so
 * the portal carries the `.lyc` root and the theme lock of the shell on screen, drawn on the
 * student tokens. The practice runner follows the device theme; the timed exam module and the
 * review runner are pinned light, and the sheet takes the same lock. Wording unchanged.
 */
import { Modal } from "@/components/student-ui";
import { MathRenderer } from "@/components/MathRenderer";

type MathReferenceSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const geometryFormulas: { label: string; latex: string }[] = [
  { label: "Circle area", latex: "$A = \\pi r^2$" },
  { label: "Circle circumference", latex: "$C = 2\\pi r$" },
  { label: "Rectangle area", latex: "$A = \\ell w$" },
  { label: "Triangle area", latex: "$A = \\frac{1}{2}bh$" },
  { label: "Pythagorean theorem", latex: "$c^2 = a^2 + b^2$" },
];

const volumeFormulas: { label: string; latex: string }[] = [
  { label: "Rectangular prism", latex: "$V = \\ell wh$" },
  { label: "Cylinder", latex: "$V = \\pi r^2 h$" },
  { label: "Sphere", latex: "$V = \\frac{4}{3}\\pi r^3$" },
  { label: "Cone", latex: "$V = \\frac{1}{3}\\pi r^2 h$" },
  { label: "Pyramid", latex: "$V = \\frac{1}{3}\\ell wh$" },
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
    <ul className="space-y-3 text-lyc-body text-lyc-ink">
      {items.map((item) => (
        <li key={item.label} className="flex items-baseline gap-2">
          <span className="shrink-0 text-lyc-muted">{item.label}:</span>
          <MathRenderer content={item.latex} />
        </li>
      ))}
    </ul>
  );
}

/** A side or angle label in a figure: 14px at the figure's drawn size (DESIGN.md §1). */
function FigureText({
  x,
  y,
  anchor = "start",
  children,
}: {
  x: number;
  y: number;
  anchor?: "start" | "middle" | "end";
  children: string;
}): React.ReactElement {
  return (
    <text x={x} y={y} fontSize="14" fill="currentColor" textAnchor={anchor}>
      {children}
    </text>
  );
}

/**
 * QA 2026-10-07 item 2: drawn to its real angles and labelled as the College Board sheet labels
 * it. The right angle is at (30,140); the base runs 156 to the right and the vertical leg 90 up
 * (156 / 90 = 1.733, i.e. √3), so the angle at the right-hand vertex is 30° and the one at the
 * top 60°. The side opposite 30° (the vertical leg) is x, the side opposite 60° (the base) is
 * x√3, the hypotenuse 2x. It used to draw a 3:4:5 triangle with x and x√3 on the wrong legs.
 */
function SpecialTriangle3060({
  className,
}: {
  className?: string;
}): React.ReactElement {
  return (
    <div className={className}>
      <p className="mb-2 text-lyc-meta font-semibold text-lyc-muted">
        30-60-90 Triangle
      </p>
      <svg
        viewBox="0 0 210 165"
        className="w-full max-w-[220px] mx-auto"
        aria-label="30-60-90 special right triangle with sides x, x√3, 2x"
        role="img"
      >
        <polygon
          points="30,140 186,140 30,50"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        {/* Right angle marker */}
        <polyline
          points="30,128 42,128 42,140"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        {/* Side labels: opposite 30° is x, opposite 60° is x√3, the hypotenuse 2x. */}
        <FigureText x={22} y={100} anchor="end">
          x
        </FigureText>
        <FigureText x={108} y={158} anchor="middle">
          x√3
        </FigureText>
        <FigureText x={115} y={83}>
          2x
        </FigureText>
        {/* Angle labels */}
        <FigureText x={36} y={80}>
          60°
        </FigureText>
        <FigureText x={140} y={134}>
          30°
        </FigureText>
      </svg>
    </div>
  );
}

/**
 * QA 2026-10-07 item 2: isosceles (both legs 120; it used to draw legs of 140 and 120, so its
 * "45°" angles were 41° and 49°). s on both legs, s√2 on the hypotenuse.
 */
function SpecialTriangle4545({
  className,
}: {
  className?: string;
}): React.ReactElement {
  return (
    <div className={className}>
      <p className="mb-2 text-lyc-meta font-semibold text-lyc-muted">
        45-45-90 Triangle
      </p>
      <svg
        viewBox="0 0 180 165"
        className="w-full max-w-[200px] mx-auto"
        aria-label="45-45-90 special right triangle with sides s, s, s√2"
        role="img"
      >
        <polygon
          points="30,140 150,140 30,20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        {/* Right angle marker */}
        <polyline
          points="30,128 42,128 42,140"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        {/* Side labels */}
        <FigureText x={22} y={85} anchor="end">
          s
        </FigureText>
        <FigureText x={90} y={158} anchor="middle">
          s
        </FigureText>
        <FigureText x={100} y={70}>
          s√2
        </FigureText>
        {/* Angle labels */}
        <FigureText x={36} y={60}>
          45°
        </FigureText>
        <FigureText x={108} y={134}>
          45°
        </FigureText>
      </svg>
    </div>
  );
}

export default function MathReferenceSheet({
  open,
  onOpenChange,
}: MathReferenceSheetProps): React.ReactElement {
  const heading =
    "mb-3 text-lyc-meta font-semibold uppercase tracking-[0.2em] text-lyc-muted";
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Math Reference Sheet"
      description="Standard SAT formulas provided as a quick in-session reference."
      className="max-h-[90vh] max-w-4xl overflow-y-auto"
      data-testid="math-reference-sheet"
    >
      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-md bg-lyc-margin p-5">
          <h3 className={heading}>Geometry</h3>
          <FormulaList items={geometryFormulas} />
        </section>

        <section className="rounded-md bg-lyc-margin p-5">
          <h3 className={heading}>Volume</h3>
          <FormulaList items={volumeFormulas} />
        </section>
      </div>

      <section className="rounded-md bg-lyc-margin p-5 text-lyc-ink">
        <h3 className={heading}>Special Right Triangles</h3>
        <div className="grid gap-6 sm:grid-cols-2">
          <SpecialTriangle3060 />
          <SpecialTriangle4545 />
        </div>
      </section>

      <section className="rounded-md border border-lyc-rule bg-lyc-sheet p-5">
        <h3 className={heading}>Core Reminders</h3>
        <ul className="space-y-2 text-lyc-body text-lyc-ink">
          {reminders.map((note) => (
            <li key={note}>
              <MathRenderer content={note} />
            </li>
          ))}
        </ul>
      </section>
    </Modal>
  );
}

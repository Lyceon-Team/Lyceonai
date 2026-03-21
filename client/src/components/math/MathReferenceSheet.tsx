import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

interface MathReferenceSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const geometryFormulas = [
  "Circle area: A = pi r^2",
  "Circle circumference: C = 2 pi r",
  "Rectangle area: A = l w",
  "Triangle area: A = 1/2 b h",
  "Pythagorean theorem: c^2 = a^2 + b^2",
];

const volumeFormulas = [
  "Rectangular prism: V = l w h",
  "Cylinder: V = pi r^2 h",
  "Sphere: V = 4/3 pi r^3",
  "Cone: V = 1/3 pi r^2 h",
  "Pyramid: V = 1/3 l w h",
];

const reminders = [
  "A full circle has 360 degrees.",
  "A full circle has 2 pi radians.",
  "Triangle interior angles sum to 180 degrees.",
];

export default function MathReferenceSheet({ open, onOpenChange }: MathReferenceSheetProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-background border-border/60">
        <DialogHeader>
          <DialogTitle className="text-2xl tracking-tight">Math Reference Sheet</DialogTitle>
          <DialogDescription>
            Standard SAT formulas provided as a quick in-session reference.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-2">
          <section className="rounded-xl bg-secondary/50 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-3">
              Geometry
            </h3>
            <ul className="space-y-2 text-sm text-foreground">
              {geometryFormulas.map((formula) => (
                <li key={formula}>{formula}</li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl bg-secondary/50 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-3">
              Volume
            </h3>
            <ul className="space-y-2 text-sm text-foreground">
              {volumeFormulas.map((formula) => (
                <li key={formula}>{formula}</li>
              ))}
            </ul>
          </section>
        </div>

        <section className="rounded-xl bg-card border border-border/60 p-5">
          <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-3">
            Core Reminders
          </h3>
          <ul className="space-y-2 text-sm text-foreground">
            {reminders.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      </DialogContent>
    </Dialog>
  );
}

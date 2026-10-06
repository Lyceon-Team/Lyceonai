/**
 * The homepage's Question of the Day, loaded only when it scrolls near the viewport.
 *
 * @spec [owner request 2026-10-05 (QOTD perf follow-up): keep the widget and KaTeX out of the
 *       homepage's initial script; React.lazy, mounted when near the viewport]
 *       | @implemented [2026-10-05]
 *
 * plain English: the widget (QuestionRenderer -> MathRenderer -> KaTeX and its CSS) lives in its
 * own chunk. Until the slot comes within NEAR_VIEWPORT of the screen, this renders the shared
 * loading line only, which is also what the build-time prerender emits (effects never run there,
 * so no chunk is requested and the HTML still carries no question). Once near, the chunk is
 * imported and the widget mounts behind the same loading line.
 *
 * edge cases: without IntersectionObserver (very old browsers) the widget mounts straight away.
 */
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { QotdLoading } from "./QotdLoading";

const QotdWidget = lazy(() =>
  import("./QotdWidget").then((m) => ({ default: m.QotdWidget })),
);

/** Start loading a little before the slot is on screen, so it is usually ready on arrival. */
const NEAR_VIEWPORT = "400px 0px";

export function LazyQotdWidget({
  showArchiveLink = true,
  afterReveal = null,
}: {
  showArchiveLink?: boolean;
  afterReveal?: ReactNode;
} = {}): JSX.Element {
  const slot = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    if (near) return undefined;
    const el = slot.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: NEAR_VIEWPORT },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [near]);

  return (
    <div ref={slot} data-testid="qotd-lazy-slot">
      {near ? (
        <Suspense fallback={<QotdLoading />}>
          <QotdWidget
            showArchiveLink={showArchiveLink}
            afterReveal={afterReveal}
          />
        </Suspense>
      ) : (
        <QotdLoading />
      )}
    </div>
  );
}

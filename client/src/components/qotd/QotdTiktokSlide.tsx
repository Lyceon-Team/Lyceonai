/**
 * Yesterday's Question of the Day as a TikTok photo carousel: one 1080x1920 slide of three.
 *
 * @spec [Doc 10A §7, §11; owner brief "QOTD social: TikTok 3-slide carousel + fixed answer order
 *       + CTA-first caption + short title" (Karl, 2026-10-23): built from the existing card design
 *       (cream, navy, logo tile, Poppins/Inter, section pill, passage box, choice rows with
 *       circled letters); slide 1 the question, slide 2 the pause, slide 3 the answer; content
 *       inside TikTok's safe area] | @implemented [2026-10-23]
 *
 * plain English: rendered to static HTML by scripts/qotd-social/generate.ts and screenshotted
 * by Playwright, exactly as the social card is, and it reuses that card's classes
 * (QOTD_SOCIAL_CARD_CSS) so the two look like one family. It takes ONLY the carousel built from
 * yesterday's public archive day (qotdTiktokCarouselSchema), so today's answer is never in
 * reach. Every slide's content sits in one column inside the band TikTok leaves clear
 * (shared/qotd/tiktok.ts, QOTD_TIKTOK_SAFE), vertically centred. Text size on slides 1 and 3 is
 * set by the generator through `--fs` (largest size at which nothing overflows); slide 2 is
 * fixed. No link and no "Answer it free" on slide 1: the link is on slide 3.
 */
import type { QotdTiktokCarousel } from "../../../../packages/shared/src/qotd-schema";
import {
  QOTD_SECTION_NAME,
  QOTD_SOCIAL_URL,
  formatSocialDate,
} from "@shared/qotd/social";
import { tiktokSafePx } from "@shared/qotd/tiktok";
import { QOTD_SOCIAL_CARD_CSS } from "@/components/qotd/QotdSocialCard";
import { StaticMath } from "@/components/qotd/StaticMath";

export type QotdTiktokSlideNumber = 1 | 2 | 3;

const SAFE = tiktokSafePx();

export const QOTD_TIKTOK_CSS = `${QOTD_SOCIAL_CARD_CSS}
.tt-slide{position:absolute;inset:0;background:var(--cream)}
.tt-pause{background:var(--navy);color:var(--cream)}
.tt-col{position:absolute;top:${SAFE.top}px;bottom:${SAFE.bottom}px;left:${SAFE.left}px;right:${SAFE.right}px;display:flex;flex-direction:column;justify-content:center}
.tt-col .qs-chip{margin-top:28px}
.tt-col .qs-body{margin:28px 0 0}
.tt-swipe{align-self:flex-end;margin-top:28px;font-family:Poppins,sans-serif;font-weight:600;font-size:32px}
.tt-pause .tt-col{align-items:center;text-align:center}
.tt-pause .qs-body{flex:none;margin:0;align-items:center;gap:0}
.tt-tile{width:120px;height:120px;border-radius:24px;background:var(--cream);display:flex;align-items:center;justify-content:center}
.tt-tile img{width:104px;height:104px;border-radius:18px}
.tt-lock{font-family:Poppins,sans-serif;font-weight:700;font-size:104px;line-height:1.05;margin-top:56px}
.tt-lock span{display:block}
.tt-letters{display:flex;gap:36px;margin-top:72px}
.tt-letters span{width:132px;height:132px;border-radius:50%;border:5px solid var(--cream);display:flex;align-items:center;justify-content:center;font-family:Poppins,sans-serif;font-weight:600;font-size:60px}
.tt-box{margin-top:72px;border:5px solid var(--cream);border-radius:28px;padding:36px 72px;font-family:Poppins,sans-serif;font-weight:500;font-size:52px}
.tt-comment{font-family:Poppins,sans-serif;font-weight:600;font-size:44px;margin-top:64px}
.tt-pill{margin-top:56px;background:var(--cream);color:var(--navy);border-radius:999px;padding:24px 48px;font-family:Poppins,sans-serif;font-weight:700;font-size:40px}
.tt-answer{background:var(--navy);color:var(--cream);border-radius:.6em;padding:.7em .8em;display:flex;align-items:center;gap:.6em;font-size:1.25em;font-weight:600}
.tt-answer .qs-key{border-color:var(--cream);background:var(--cream);color:var(--navy);width:1.7em;height:1.7em;font-size:.85em}
.tt-value{font-family:Poppins,sans-serif;font-weight:700;font-size:1.4em}
.tt-why b{font-family:Poppins,sans-serif;font-weight:700}
.tt-link{margin-top:28px;background:#fff;border:2px solid var(--border);border-radius:24px;padding:24px 32px;font-family:Poppins,sans-serif}
.tt-link-a{font-weight:700;font-size:34px}
.tt-link-u{font-weight:500;font-size:30px;color:var(--muted);margin-top:4px}
.tt-follow{margin-top:24px;font-family:Poppins,sans-serif;font-weight:600;font-size:30px}
`;

function Header({
  logoSrc,
  title,
  subtitle,
}: {
  logoSrc: string;
  title: string;
  subtitle: string;
}): JSX.Element {
  return (
    <header className="qs-head">
      <img src={logoSrc} alt="Lyceon" />
      <div>
        <div className="qs-title">{title}</div>
        <div className="qs-date">{subtitle}</div>
      </div>
    </header>
  );
}

function QuestionSlide({
  carousel,
  logoSrc,
}: {
  carousel: QotdTiktokCarousel;
  logoSrc: string;
}): JSX.Element {
  const q = carousel.question;
  return (
    <div className="tt-col">
      <Header
        logoSrc={logoSrc}
        title="SAT Question of the Day"
        subtitle={formatSocialDate(q.qotd_date)}
      />
      <span className="qs-chip">
        {QOTD_SECTION_NAME[q.section_code]} · {q.domain}
      </span>
      <div className="qs-body" id="qs-body">
        {q.passage && q.passage.trim().length > 0 ? (
          <div className="qs-passage">
            <StaticMath content={q.passage} />
          </div>
        ) : null}
        <div className="qs-stem">
          <StaticMath content={q.stem} />
        </div>
        {q.item_type === "mcq" ? (
          <ol className="qs-opts">
            {q.options.map((option, index) => (
              <li key={index}>
                <span className="qs-key">{"ABCD"[index]}</span>
                <StaticMath content={option.text} className="qs-opt-text" />
              </li>
            ))}
          </ol>
        ) : (
          <div className="qs-gridin">Enter your answer</div>
        )}
      </div>
      <div className="tt-swipe">Swipe for the answer »</div>
    </div>
  );
}

function PauseSlide({
  carousel,
  logoSrc,
}: {
  carousel: QotdTiktokCarousel;
  logoSrc: string;
}): JSX.Element {
  const mcq = carousel.question.item_type === "mcq";
  return (
    <div className="tt-col">
      <div className="qs-body" id="qs-body">
        <div className="tt-tile">
          <img src={logoSrc} alt="Lyceon" />
        </div>
        <div className="tt-lock">
          <span>Lock in</span>
          <span>your answer</span>
        </div>
        {mcq ? (
          <div className="tt-letters">
            {["A", "B", "C", "D"].map((letter) => (
              <span key={letter}>{letter}</span>
            ))}
          </div>
        ) : (
          <div className="tt-box">Your answer</div>
        )}
        <div className="tt-comment">
          {mcq ? "Comment your letter first" : "Comment your answer first"}
        </div>
        <div className="tt-pill">Swipe for the answer →</div>
      </div>
    </div>
  );
}

function AnswerSlide({
  carousel,
  logoSrc,
}: {
  carousel: QotdTiktokCarousel;
  logoSrc: string;
}): JSX.Element {
  const { answer } = carousel;
  return (
    <div className="tt-col">
      <Header
        logoSrc={logoSrc}
        title="The answer"
        subtitle={`${carousel.section} · ${carousel.question.domain}`}
      />
      <div className="qs-body" id="qs-body">
        <div className="tt-answer">
          {answer.kind === "choice" ? (
            <>
              <span className="qs-key">{answer.letter}</span>
              <StaticMath content={answer.text} />
            </>
          ) : (
            <span className="tt-value">{answer.value}</span>
          )}
        </div>
        <div className="tt-why">
          <b>Why:</b> {carousel.why}
        </div>
      </div>
      <div className="tt-link">
        <div className="tt-link-a">Today's question is live</div>
        <div className="tt-link-u">{QOTD_SOCIAL_URL}</div>
      </div>
      <div className="tt-follow">Follow for a new SAT question every day</div>
    </div>
  );
}

export function QotdTiktokSlide({
  slide,
  carousel,
  logoSrc,
}: {
  slide: QotdTiktokSlideNumber;
  carousel: QotdTiktokCarousel;
  logoSrc: string;
}): JSX.Element {
  return (
    <div
      className={`tt-slide${slide === 2 ? " tt-pause" : ""}`}
      data-qotd-tiktok-slide={slide}
    >
      {slide === 1 ? (
        <QuestionSlide carousel={carousel} logoSrc={logoSrc} />
      ) : slide === 2 ? (
        <PauseSlide carousel={carousel} logoSrc={logoSrc} />
      ) : (
        <AnswerSlide carousel={carousel} logoSrc={logoSrc} />
      )}
    </div>
  );
}

/**
 * The Question of the Day social card: the image posted to social, at one of two sizes.
 *
 * @spec [Doc 10A §7, §11; owner decisions 2026-10-07 on the QOTD social assets (portrait
 *       1080x1350 + story 1080x1920; site palette, fonts and logo; the URL on the card; no
 *       answer)] | @implemented [2026-10-07]
 *
 * plain English: rendered to static HTML by scripts/qotd-social/generate.ts and screenshotted
 * by Playwright. It takes ONLY the strict no-answer input (qotdSocialInputSchema), so there is
 * nothing to leak, and it draws maths with StaticMath (KaTeX renderToString with the site's one
 * tokenizer) exactly as the archive pages do. The styles live in QOTD_SOCIAL_CARD_CSS, not
 * Tailwind, because the screenshot page loads no app stylesheet. Text size is set by the
 * generator through `--fs` (largest size at which nothing overflows).
 *
 * The story keeps its top and bottom 250px clear: Instagram and TikTok draw their own controls
 * there.
 */
import type { QotdSocialInput } from "../../../../packages/shared/src/qotd-schema";
import {
  QOTD_SECTION_NAME,
  QOTD_SOCIAL_URL,
  formatSocialDate,
  type QotdSocialFormat,
} from "@shared/qotd/social";
import { StaticMath } from "@/components/qotd/StaticMath";

export const QOTD_SOCIAL_CARD_CSS = `
:root{--cream:#FFFAEF;--card:#F9F3E7;--navy:#0F2E48;--muted:rgba(15,46,72,.7);--border:rgba(15,46,72,.14)}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--cream);color:var(--navy);font-family:Inter,sans-serif;overflow:hidden}
.qs-frame{position:absolute;inset:0;display:flex;flex-direction:column}
.qs-portrait{padding:64px 72px 0}
.qs-story{padding:250px 72px 250px}
.qs-head{display:flex;align-items:center;gap:22px}
.qs-head img{width:92px;height:92px;border-radius:18px}
.qs-title{font-family:Poppins,sans-serif;font-weight:700;font-size:40px;line-height:1.1}
.qs-date{font-family:Poppins,sans-serif;font-weight:500;font-size:24px;color:var(--muted);margin-top:6px}
.qs-chip{align-self:flex-start;margin-top:30px;font-family:Poppins,sans-serif;font-weight:600;font-size:22px;letter-spacing:.02em;border:2px solid var(--navy);border-radius:999px;padding:8px 20px}
.qs-story .qs-chip{margin-top:44px}
.qs-body{flex:1;min-height:0;margin:30px 0;display:flex;flex-direction:column;justify-content:center;gap:.6em;font-size:var(--fs,32px);line-height:1.45}
.qs-passage{background:var(--card);border:1px solid var(--border);border-radius:.6em;padding:.6em .8em;font-size:.92em}
.qs-stem{font-weight:600}
.qs-opts{list-style:none;display:grid;grid-template-columns:var(--cols,1fr);gap:.4em .5em}
.qs-opts li{display:flex;align-items:center;gap:.6em;background:#fff;border:2px solid var(--border);border-radius:.5em;padding:.35em .6em}
.qs-key{flex:none;width:1.6em;height:1.6em;border-radius:50%;border:2px solid var(--navy);display:flex;align-items:center;justify-content:center;font-family:Poppins,sans-serif;font-weight:600;font-size:.8em}
.qs-gridin{align-self:flex-start;border:2px dashed var(--navy);border-radius:16px;padding:18px 40px;font-family:Poppins,sans-serif;font-weight:500;font-size:26px;color:var(--muted)}
.qs-cta{background:var(--navy);color:var(--cream);font-family:Poppins,sans-serif}
.qs-portrait .qs-cta{margin:0 -72px;padding:26px 72px}
.qs-story .qs-cta{border-radius:28px;padding:40px 44px}
.qs-cta-a{font-weight:700;font-size:36px}
.qs-story .qs-cta-a{font-size:40px}
.qs-cta-u{font-weight:500;font-size:30px;opacity:.9;margin-top:4px}
.qs-story .qs-cta-u{font-size:32px}
.katex{font-size:1.05em;white-space:nowrap}
`;

export function QotdSocialCard({
  input,
  format,
  logoSrc,
}: {
  input: QotdSocialInput;
  format: QotdSocialFormat;
  logoSrc: string;
}): JSX.Element {
  return (
    <div className={`qs-frame qs-${format}`} data-qotd-social-card={format}>
      <header className="qs-head">
        <img src={logoSrc} alt="Lyceon" />
        <div>
          <div className="qs-title">SAT Question of the Day</div>
          <div className="qs-date">{formatSocialDate(input.qotd_date)}</div>
        </div>
      </header>
      <span className="qs-chip">
        {QOTD_SECTION_NAME[input.section_code]} · {input.domain}
      </span>
      <div className="qs-body" id="qs-body">
        {input.passage && input.passage.trim().length > 0 ? (
          <div className="qs-passage">
            <StaticMath content={input.passage} />
          </div>
        ) : null}
        <div className="qs-stem">
          <StaticMath content={input.stem} />
        </div>
        {input.item_type === "mcq" ? (
          <ol className="qs-opts">
            {input.options.map((option, index) => (
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
      <div className="qs-cta">
        <div className="qs-cta-a">Answer it free</div>
        <div className="qs-cta-u">{QOTD_SOCIAL_URL}</div>
      </div>
    </div>
  );
}

/**
 * Markdown copies of the public pages, and /llms.txt.
 *
 * @spec [owner brief "AI visibility: markdown copies + AI crawler tracking" (Karl, 2026-11-28)
 *       items 1-3; docs/plans/seo/seo-marketing-vertical.md §5 F1 (one prerendered source for every
 *       public page); CLAUDE.md Public Disclosure Doctrine 1 and 2 (no new public copy: llms.txt
 *       reuses each page's own title and meta description)] | @implemented [2026-11-28]
 *
 * plain English: `pageMarkdown(html)` turns a prerendered page's `<main>` into Markdown. It reads
 * the HTML the build has just rendered, so the copy can never say anything the page does not: the
 * same headings, paragraphs, lists, tables, links and maths, in the same order. It is served at the
 * page's path + ".md" (`twinPathFor`; `/index.md` for the homepage), the same file to every
 * visitor. `llmsTxt(pages)` lists every copy with its page's own title and description.
 *
 * Trade-offs:
 *  - A small parser for the markup React's server renderer writes (well-formed, attributes
 *    quoted, void elements known) rather than a DOM library: the prerender bundle inlines every
 *    dependency, and no new dependency is allowed. Markup it cannot read fails the build.
 *  - The converter covers what the public pages use (headings, paragraphs, lists, tables, quotes,
 *    code, links, emphasis, KaTeX maths, link cards wrapping blocks). Anything else is kept as its
 *    text, so nothing on the page is dropped; at worst a structure is flattened.
 *
 * Edge cases:
 *  - Scripts, styles, SVG icons, <noscript> and <template> are not page text and are skipped.
 *  - KaTeX maths becomes `$tex$` (`$$tex$$` for display maths), from the TeX source KaTeX keeps in
 *    its MathML annotation, instead of the visual and MathML copies the HTML carries side by side.
 *  - Relative links become absolute on the site URL, so a copy read on its own still links home;
 *    in-page anchors ("#...") keep only their text.
 *  - Characters Markdown would read as syntax are escaped with a backslash.
 *  - A page with no `<main>`, or more than one, fails the build.
 */

export type MarkdownTwinPage = {
  /** The page's URL path, e.g. `/parent`. */
  path: string;
  title: string;
  description: string;
};

/** Where a page's Markdown copy is served: its path + ".md", or /index.md for the homepage. */
export function twinPathFor(urlPath: string): string {
  return urlPath === "/" ? "/index.md" : `${urlPath}.md`;
}

/** The copy's file in dist/public: `index.md`, `parent.md`, `blog/x.md`. */
export function twinFileFor(urlPath: string): string {
  return twinPathFor(urlPath).slice(1);
}

// ---------------------------------------------------------------------------------------------
// Parsing React's server-rendered HTML
// ---------------------------------------------------------------------------------------------

export type HtmlElement = {
  tag: string;
  attrs: Readonly<Record<string, string>>;
  children: HtmlNode[];
};
export type HtmlNode = HtmlElement | string;

const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);
const RAW_TEXT = new Set(["script", "style"]);

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (whole, code: string) => {
      if (code.startsWith("#x") || code.startsWith("#X"))
        return String.fromCodePoint(parseInt(code.slice(2), 16));
      if (code.startsWith("#"))
        return String.fromCodePoint(parseInt(code.slice(1), 10));
      return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
    },
  );
}

const ATTR = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/** Parses an HTML fragment into a root element holding its nodes. Throws on unbalanced markup. */
export function parseHtml(html: string): HtmlElement {
  const root: HtmlElement = { tag: "#root", attrs: {}, children: [] };
  const stack: HtmlElement[] = [root];
  const top = (): HtmlElement => stack[stack.length - 1] ?? root;
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      top().children.push(decodeEntities(html.slice(i)));
      break;
    }
    if (lt > i) top().children.push(decodeEntities(html.slice(i, lt)));
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      if (end === -1) throw new Error("parseHtml: unterminated comment");
      i = end + 3;
      continue;
    }
    if (html.startsWith("<!", lt) || html.startsWith("<?", lt)) {
      const end = html.indexOf(">", lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    const gt = html.indexOf(">", lt);
    if (gt === -1) throw new Error("parseHtml: unterminated tag");
    const raw = html.slice(lt + 1, gt);
    if (raw.startsWith("/")) {
      const name = raw.slice(1).trim().toLowerCase();
      const at = stack.map((e) => e.tag).lastIndexOf(name);
      if (at < 1) throw new Error(`parseHtml: </${name}> closes nothing`);
      stack.length = at;
      i = gt + 1;
      continue;
    }
    const selfClosing = raw.endsWith("/");
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const nameMatch = /^([a-zA-Z][a-zA-Z0-9:-]*)/.exec(body);
    if (!nameMatch?.[1]) throw new Error(`parseHtml: cannot read <${raw}>`);
    const tag = nameMatch[1].toLowerCase();
    const attrs: Record<string, string> = {};
    for (const m of body.slice(nameMatch[1].length).matchAll(ATTR)) {
      const key = m[1];
      if (key)
        attrs[key.toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
    }
    const el: HtmlElement = { tag, attrs, children: [] };
    top().children.push(el);
    i = gt + 1;
    if (selfClosing || VOID.has(tag)) continue;
    if (RAW_TEXT.has(tag)) {
      const close = html.toLowerCase().indexOf(`</${tag}`, i);
      if (close === -1) throw new Error(`parseHtml: unterminated <${tag}>`);
      el.children.push(html.slice(i, close));
      i = html.indexOf(">", close) + 1;
      continue;
    }
    stack.push(el);
  }
  if (stack.length !== 1)
    throw new Error(`parseHtml: <${top().tag}> is never closed`);
  return root;
}

function isElement(node: HtmlNode): node is HtmlElement {
  return typeof node !== "string";
}

function elementsOf(el: HtmlElement): HtmlElement[] {
  return el.children.filter(isElement);
}

function hasClass(el: HtmlElement, name: string): boolean {
  return (el.attrs.class ?? "").split(/\s+/).includes(name);
}

/** Every element under `el` (depth first) for which `match` holds. */
function findAll(
  el: HtmlElement,
  match: (e: HtmlElement) => boolean,
): HtmlElement[] {
  return elementsOf(el).flatMap((child) => [
    ...(match(child) ? [child] : []),
    ...findAll(child, match),
  ]);
}

function textOf(node: HtmlNode): string {
  return isElement(node) ? node.children.map(textOf).join("") : node;
}

/** The page's one `<main>` element. Throws when there is none, or more than one. */
export function mainElement(html: string): HtmlElement {
  const mains = findAll(parseHtml(html), (e) => e.tag === "main");
  if (mains.length !== 1 || !mains[0])
    throw new Error(`expected one <main>, found ${mains.length}`);
  return mains[0];
}

// ---------------------------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------------------------

const SKIP = new Set(["script", "style", "svg", "noscript", "template"]);

const BLOCK = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "ul",
]);

type Ctx = { baseUrl: string };

function isKatex(el: HtmlElement): boolean {
  return hasClass(el, "katex") || hasClass(el, "katex-display");
}

function isDisplayMath(el: HtmlElement): boolean {
  return hasClass(el, "katex-display");
}

/** KaTeX keeps the TeX source in its MathML annotation. */
function katexSource(el: HtmlElement): string {
  const tex = findAll(
    el,
    (e) => e.tag === "annotation" && e.attrs.encoding === "application/x-tex",
  )[0];
  return (tex ? textOf(tex) : textOf(el)).trim();
}

function isBlock(el: HtmlElement): boolean {
  return BLOCK.has(el.tag) && !isKatex(el);
}

function hasBlockDescendant(el: HtmlElement): boolean {
  return elementsOf(el).some(
    (child) =>
      !SKIP.has(child.tag) &&
      !isKatex(child) &&
      (BLOCK.has(child.tag) || hasBlockDescendant(child)),
  );
}

/** Escapes what Markdown would otherwise read as syntax. */
function escapeText(text: string): string {
  return text.replace(/([\\`*_[\]|$<>])/g, "\\$1");
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A line Markdown would read as a heading, quote or list item is escaped at its start. */
function escapeLineStart(line: string): string {
  return line.replace(/^(#{1,6}\s|[-+]\s|\d+[.)]\s)/, "\\$1");
}

function absoluteHref(href: string, ctx: Ctx): string | null {
  if (href === "" || href.startsWith("#")) return null;
  if (href.startsWith("/")) return `${ctx.baseUrl}${href}`;
  return href;
}

/** Emphasis around the text, keeping the whitespace that surrounded it outside the markers. */
function wrap(marker: string, text: string): string {
  const t = collapse(text);
  if (t === "") return text.trim() === "" ? text : "";
  const lead = /^\s/.test(text) ? " " : "";
  const trail = /\s$/.test(text) ? " " : "";
  return `${lead}${marker}${t}${marker}${trail}`;
}

/** Inline Markdown for an element's children, on one line. */
function inlineChildren(el: HtmlElement, ctx: Ctx): string {
  return el.children
    .map((node) => {
      if (!isElement(node)) return escapeText(node);
      if (SKIP.has(node.tag)) return "";
      return isBlock(node)
        ? ` ${inlineChildren(node, ctx)} `
        : inline(node, ctx);
    })
    .join("");
}

function inline(el: HtmlElement, ctx: Ctx): string {
  if (isKatex(el)) {
    const tex = katexSource(el);
    return isDisplayMath(el) ? ` $$${tex}$$ ` : ` $${tex}$ `;
  }
  switch (el.tag) {
    case "br":
      return " ";
    case "strong":
    case "b":
      return wrap("**", inlineChildren(el, ctx));
    case "em":
    case "i":
      return wrap("*", inlineChildren(el, ctx));
    case "code":
      return `\`${textOf(el).replace(/`/g, "'")}\``;
    case "img": {
      const alt = collapse(el.attrs.alt ?? "");
      return alt === "" ? "" : `![${escapeText(alt)}]`;
    }
    // Links and buttons are drawn as separate controls, so a space keeps two of them that sit
    // side by side in the markup (a table of contents, a pair of buttons) apart.
    case "a": {
      const text = collapse(inlineChildren(el, ctx));
      const href = absoluteHref(el.attrs.href ?? "", ctx);
      if (text === "") return "";
      return href === null ? ` ${text} ` : ` [${text}](${href}) `;
    }
    case "button":
      return ` ${inlineChildren(el, ctx)} `;
    default:
      return inlineChildren(el, ctx);
  }
}

/** Markdown blocks for an element's children: runs of inline content become paragraphs. */
function childBlocks(el: HtmlElement, ctx: Ctx): string[] {
  const out: string[] = [];
  let run = "";
  const flush = (): void => {
    const text = collapse(run);
    if (text !== "") out.push(escapeLineStart(text));
    run = "";
  };
  for (const node of el.children) {
    if (!isElement(node)) {
      run += escapeText(node);
      continue;
    }
    if (SKIP.has(node.tag)) continue;
    if (isKatex(node) && isDisplayMath(node)) {
      flush();
      out.push(`$$${katexSource(node)}$$`);
    } else if (isBlock(node)) {
      flush();
      out.push(...block(node, ctx));
    } else if (node.tag === "a" && hasBlockDescendant(node)) {
      flush();
      out.push(...linkCard(node, ctx));
    } else if (!isKatex(node) && hasBlockDescendant(node)) {
      flush();
      out.push(...childBlocks(node, ctx));
    } else {
      run += inline(node, ctx);
    }
  }
  flush();
  return out;
}

/** A link wrapping blocks (a card): its blocks, with the first one linked. */
function linkCard(el: HtmlElement, ctx: Ctx): string[] {
  const blocks = childBlocks(el, ctx);
  const href = absoluteHref(el.attrs.href ?? "", ctx);
  const first = blocks[0];
  if (href === null || first === undefined) return blocks;
  const heading = /^(#{1,6} )(.*)$/.exec(first);
  blocks[0] = heading
    ? `${heading[1]}[${heading[2]}](${href})`
    : `[${first}](${href})`;
  return blocks;
}

function listBlock(el: HtmlElement, ctx: Ctx, depth: number): string {
  // A numbered list whose items print their own number (a styled step counter) keeps that
  // number and takes bullets, so no step reads "1. 1".
  const ordered =
    el.tag === "ol" &&
    !elementsOf(el)
      .filter((li) => li.tag === "li")
      .some((li, i) => collapse(textOf(li)).startsWith(`${i + 1} `));
  const indent = "  ".repeat(depth);
  const lines: string[] = [];
  let n = 1;
  for (const li of elementsOf(el)) {
    if (li.tag !== "li") continue;
    const marker = ordered ? `${n}.` : "-";
    n += 1;
    const nested: string[] = [];
    let own = "";
    for (const node of li.children) {
      if (!isElement(node)) {
        own += escapeText(node);
      } else if (node.tag === "ul" || node.tag === "ol") {
        nested.push(listBlock(node, ctx, depth + 1));
      } else if (!SKIP.has(node.tag)) {
        own += isBlock(node)
          ? ` ${childBlocks(node, ctx).join(" ")} `
          : inline(node, ctx);
      }
    }
    const text = collapse(own);
    if (text !== "" || nested.length > 0)
      lines.push(`${indent}${marker} ${text}`.trimEnd(), ...nested);
  }
  return lines.join("\n");
}

function tableBlock(el: HtmlElement, ctx: Ctx): string {
  const rows = findAll(el, (e) => e.tag === "tr").map((tr) =>
    elementsOf(tr)
      .filter((c) => c.tag === "td" || c.tag === "th")
      .map((c) => collapse(inlineChildren(c, ctx))),
  );
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (width === 0) return "";
  const line = (cells: readonly string[]): string =>
    `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
  const [head, ...body] = rows;
  return [
    line(head ?? []),
    line(Array.from({ length: width }, () => "---")),
    ...body.map(line),
  ].join("\n");
}

function block(el: HtmlElement, ctx: Ctx): string[] {
  const heading = /^h([1-6])$/.exec(el.tag);
  if (heading) {
    const text = collapse(inlineChildren(el, ctx));
    return text === "" ? [] : [`${"#".repeat(Number(heading[1]))} ${text}`];
  }
  switch (el.tag) {
    case "p": {
      if (hasBlockDescendant(el)) return childBlocks(el, ctx);
      const text = collapse(inlineChildren(el, ctx));
      return text === "" ? [] : [escapeLineStart(text)];
    }
    case "ul":
    case "ol": {
      const list = listBlock(el, ctx, 0);
      return list === "" ? [] : [list];
    }
    case "table": {
      // A caption is the table's title: kept, as its own line, before the table.
      const caption = findAll(el, (e) => e.tag === "caption")
        .map((c) => collapse(inlineChildren(c, ctx)))
        .filter((c) => c !== "");
      const table = tableBlock(el, ctx);
      return [
        ...caption.map(escapeLineStart),
        ...(table === "" ? [] : [table]),
      ];
    }
    case "blockquote":
      return childBlocks(el, ctx).map((b) =>
        b
          .split("\n")
          .map((l) => `> ${l}`)
          .join("\n"),
      );
    case "pre":
      return [`\`\`\`\n${textOf(el).replace(/```/g, "'''")}\n\`\`\``];
    case "hr":
      return ["---"];
    default:
      return childBlocks(el, ctx);
  }
}

/** A prerendered page's `<main>` as Markdown, ending in one newline. */
export function pageMarkdown(html: string, baseUrl: string): string {
  return `${childBlocks(mainElement(html), { baseUrl }).join("\n\n")}\n`;
}

// ---------------------------------------------------------------------------------------------
// llms.txt
// ---------------------------------------------------------------------------------------------

/** The section a page is listed under in llms.txt. */
function sectionOf(path: string): string {
  if (path === "/blog" || path.startsWith("/blog/")) return "Blog";
  if (path.startsWith("/sat-question-of-the-day"))
    return "SAT Question of the Day";
  if (path === "/legal" || path.startsWith("/legal/")) return "Legal";
  return "Pages";
}

const SECTION_ORDER = ["Pages", "Blog", "SAT Question of the Day", "Legal"];

/**
 * /llms.txt (the llmstxt.org layout): the site name, the homepage's own description, then every
 * Markdown copy with its page's title and description, in build order within each section.
 */
export function llmsTxt(
  pages: readonly MarkdownTwinPage[],
  baseUrl: string,
): string {
  const home = pages.find((p) => p.path === "/");
  if (!home) throw new Error("llms.txt: the homepage has no Markdown copy");
  const lines = ["# Lyceon", "", `> ${collapse(home.description)}`];
  for (const section of SECTION_ORDER) {
    const inSection = pages.filter((p) => sectionOf(p.path) === section);
    if (inSection.length === 0) continue;
    lines.push("", `## ${section}`, "");
    for (const page of inSection)
      lines.push(
        `- [${collapse(page.title)}](${baseUrl}${twinPathFor(page.path)}): ${collapse(page.description)}`,
      );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * A local stand-in for the design canvas runtime (`support.js`) the signed-off prototypes load.
 *
 * @spec [student-UI register §6 Wave 5 (side-by-side with the signed-off prototype);
 *        docs/plans/student-ui/design/README.md ("the prototypes load ./support.js, which is not
 *        part of this package")] | @implemented [2026-10-03]
 *
 * plain English: `docs/plans/student-ui/design/prototype/*.dc.html` are canvas documents: an
 * `<x-dc>` template plus a `<script type="text/x-dc">` holding a `Component extends DCLogic`
 * whose `renderVals()` returns the template's values. The runtime that renders them is not in
 * the repo and the harness may not fetch it, so this file renders the same small grammar the ten
 * prototypes use, and nothing more:
 *   - `{{path}}` (dotted identifiers only) in text and attributes;
 *   - `<sc-if value="{{x}}">` (children kept when truthy) and `<sc-for list="{{xs}}" as="x">`;
 *   - `onClick` / `onChange` / `onKeyDown="{{fn}}"` bound as DOM listeners;
 *   - `<helmet>` (its styles and links stay in the document);
 *   - `this.props` from the script's `data-props` defaults, overridden by
 *     `window.__DC_PROPS__` (the harness sets `{ plan, theme }`), and `this.setState`, which
 *     re-renders.
 * Injected with `page.addInitScript({ path })` before the page parses, so it runs on
 * DOMContentLoaded; the missing `./support.js` request simply fails. A construct outside this
 * grammar throws, so a prototype that grows a new one fails the capture instead of rendering
 * wrong. Sets `document.documentElement.dataset.dcReady = "1"` when the first render is done.
 */
/* global window, document, Node -- browser script, injected into the prototype page */
(function installDcRuntime() {
  "use strict";

  class DCLogic {
    constructor(props) {
      this.props = props;
      this.state = {};
      this.__rerender = null;
    }
    setState(patch) {
      const next =
        typeof patch === "function" ? patch(this.state, this.props) : patch;
      this.state = Object.assign({}, this.state, next);
      if (this.__rerender) this.__rerender();
    }
  }

  const WHOLE = /^\{\{\s*([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\s*\}\}$/;
  const ANY = /\{\{\s*([^}]*?)\s*\}\}/g;
  const PATH = /^[A-Za-z_$][\w$]*(?:\.[\w$]+)*$|^(true|false)$/;
  const BOOLEAN_ATTRS = new Set([
    "disabled",
    "checked",
    "hidden",
    "selected",
    "open",
    "readonly",
    "required",
    "multiple",
  ]);

  function lookup(path, scopes) {
    if (path === "true") return true;
    if (path === "false") return false;
    if (!PATH.test(path))
      throw new Error(`prototype runtime: unsupported expression {{${path}}}`);
    const [head, ...rest] = path.split(".");
    let value;
    for (let i = scopes.length - 1; i >= 0; i--) {
      if (head in scopes[i]) {
        value = scopes[i][head];
        break;
      }
    }
    for (const key of rest) value = value == null ? undefined : value[key];
    return value;
  }

  function interpolate(text, scopes) {
    return text.replace(ANY, (_m, path) => {
      const v = lookup(path, scopes);
      return v == null ? "" : String(v);
    });
  }

  function eventFor(attr, el) {
    const name = attr.slice(2).toLowerCase();
    if (name !== "change") return name;
    const type = (el.getAttribute("type") || "").toLowerCase();
    const textual =
      el.tagName === "TEXTAREA" ||
      (el.tagName === "INPUT" &&
        !["checkbox", "radio", "range"].includes(type));
    return textual ? "input" : "change";
  }

  function renderNodes(nodes, scopes, out) {
    for (const node of nodes) renderNode(node, scopes, out);
  }

  function renderNode(node, scopes, out) {
    if (node.nodeType === Node.TEXT_NODE) {
      out.appendChild(
        document.createTextNode(interpolate(node.nodeValue, scopes)),
      );
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName.toLowerCase();
    if (tag === "sc-if") {
      const m = WHOLE.exec(node.getAttribute("value") || "");
      if (!m)
        throw new Error('prototype runtime: sc-if needs value="{{path}}"');
      if (lookup(m[1], scopes)) renderNodes(node.childNodes, scopes, out);
      return;
    }
    if (tag === "sc-for") {
      const m = WHOLE.exec(node.getAttribute("list") || "");
      const as = node.getAttribute("as");
      if (!m || !as)
        throw new Error(
          'prototype runtime: sc-for needs list="{{path}}" and as',
        );
      const list = lookup(m[1], scopes);
      if (!Array.isArray(list))
        throw new Error(
          `prototype runtime: sc-for list {{${m[1]}}} is not an array`,
        );
      for (const item of list)
        renderNodes(node.childNodes, scopes.concat([{ [as]: item }]), out);
      return;
    }
    if (tag.startsWith("sc-"))
      throw new Error(`prototype runtime: unsupported element <${tag}>`);
    const el =
      node.namespaceURI === "http://www.w3.org/2000/svg"
        ? document.createElementNS(node.namespaceURI, node.tagName)
        : document.createElement(node.tagName);
    let valueProp;
    for (const attr of Array.from(node.attributes)) {
      if (attr.name.startsWith("hint-")) continue;
      const whole = WHOLE.exec(attr.value);
      if (/^on[a-z]+$/i.test(attr.name)) {
        if (!whole)
          throw new Error(
            `prototype runtime: ${attr.name} must be a single {{fn}}`,
          );
        const fn = lookup(whole[1], scopes);
        if (typeof fn === "function")
          el.addEventListener(eventFor(attr.name, node), fn);
        continue;
      }
      if (whole && BOOLEAN_ATTRS.has(attr.name.toLowerCase())) {
        if (lookup(whole[1], scopes)) el.setAttribute(attr.name, "");
        continue;
      }
      const value = interpolate(attr.value, scopes);
      el.setAttribute(attr.name, value);
      if (attr.name === "value") valueProp = value;
    }
    const source =
      tag === "template" ? node.content.childNodes : node.childNodes;
    renderNodes(source, scopes, el);
    if (valueProp !== undefined && "value" in el) el.value = valueProp;
    out.appendChild(el);
  }

  function boot() {
    const host = document.querySelector("x-dc");
    const script = document.querySelector('script[type="text/x-dc"]');
    if (!host || !script) return;
    const template = Array.from(host.childNodes).map((n) => n.cloneNode(true));
    const spec = JSON.parse(script.getAttribute("data-props") || "{}");
    const props = {};
    for (const [key, def] of Object.entries(spec)) {
      if (
        !key.startsWith("$") &&
        def &&
        typeof def === "object" &&
        "default" in def
      )
        props[key] = def.default;
    }
    Object.assign(props, window.__DC_PROPS__ || {});
    const Component = new Function(
      "DCLogic",
      `${script.textContent}\n;return Component;`,
    )(DCLogic);
    const instance = new Component(props);
    const render = () => {
      const frag = document.createDocumentFragment();
      renderNodes(template, [instance.renderVals()], frag);
      host.replaceChildren(frag);
    };
    instance.__rerender = render;
    render();
    document.documentElement.dataset.dcReady = "1";
  }

  document.addEventListener("DOMContentLoaded", () => {
    try {
      boot();
    } catch (err) {
      document.documentElement.dataset.dcError =
        err instanceof Error ? err.message : String(err);
      throw err;
    }
  });
})();

// Tiny DOM helper shared by every scene. No framework: this is meant to be
// the thinnest possible layer, since the scene *logic* (not the DOM code)
// is what eventually needs to be re-read while porting to C#/Unity.

import { describeResources } from "./data/resourceCatalog.js";

export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      el.setAttribute(key, value === true ? "" : value);
    }
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const kid of kids) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.appendChild(typeof kid === "string" ? document.createTextNode(kid) : kid);
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// Renders the shared screen shell (eyebrow + title + body + action bar)
// used by every scene so the twelve screens stay visually consistent.
// `corner` is an optional small HUD (see resourceHud below), shown at
// the top-right alongside the eyebrow.
export function renderScreen(container, { eyebrow, title, subtitle, body, actions = [], corner } = {}) {
  clear(container);
  container.appendChild(
    h("div", { class: "screen-frame" }, [
      h("header", { class: "screen-head" }, [
        h("div", { class: "screen-head__top" }, [
          eyebrow ? h("p", { class: "eyebrow", text: eyebrow }) : h("span"),
          corner && corner.length ? h("div", { class: "hud-corner" }, corner) : null,
        ]),
        h("h1", { class: "screen-title", text: title }),
        subtitle ? h("p", { class: "screen-sub", text: subtitle }) : null,
      ]),
      h("div", { class: "screen-body" }, Array.isArray(body) ? body : [body]),
      actions.length ? h("footer", { class: "screen-actions" }, actions) : null,
    ])
  );
}

// Small "資源" readout (name x qty) for the corner of a screen. Names
// stand in for icons for now, per the design doc.
export function resourceHud(resources) {
  return describeResources(resources).map((r) =>
    h("span", { class: "tag hud-tag", text: `${r.abbr}×${r.qty}` })
  );
}

export function button(label, { variant = null, disabled = false, onClick, block = false } = {}) {
  const classes = ["btn"];
  if (variant) classes.push(`btn--${variant}`);
  if (block) classes.push("btn--block");
  return h("button", {
    class: classes.join(" "),
    disabled,
    onClick: disabled ? undefined : onClick,
    text: label,
  });
}

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
//
// Every scene calls this on *every* interaction (toggling a detail
// panel, hiring a candidate, ...), which tears down and rebuilds the
// whole .screen-frame each time. A freshly-built element always starts
// scrolled to the top, so without this the scrollbar would visibly jump
// back on every click — save the outgoing frame's scrollTop and apply
// it to the new one.
export function renderScreen(container, { eyebrow, title, subtitle, body, actions = [], corner } = {}) {
  const previousFrame = container.querySelector(".screen-frame");
  const scrollTop = previousFrame ? previousFrame.scrollTop : 0;

  clear(container);
  const frame = h("div", { class: "screen-frame" }, [
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
  ]);
  container.appendChild(frame);
  // Setting scrollTop synchronously right after appendChild gets
  // silently clamped to 0 -- even forcing a reflow (reading
  // offsetHeight) isn't reliably enough for the scroll-position
  // snapshot specifically. A rAF callback runs after the browser's
  // next style/layout pass, so the real scrollHeight is in effect by
  // then; any flash at scrollTop 0 is under a frame and imperceptible.
  requestAnimationFrame(() => {
    frame.scrollTop = scrollTop;
  });
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

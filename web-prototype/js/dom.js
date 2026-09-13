// Tiny DOM helper shared by every scene. No framework: this is meant to be
// the thinnest possible layer, since the scene *logic* (not the DOM code)
// is what eventually needs to be re-read while porting to C#/Unity.

import { describeResources, RESOURCE_COLOR_CLASS } from "./data/resourceCatalog.js";

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
// `corner` is an optional small resource summary (see resourceHud
// below), shown above the eyebrow.
//
// Every scene calls this on *every* interaction (toggling a detail
// panel, hiring a candidate, ...), which tears down and rebuilds the
// whole .screen-frame each time. A freshly-built element always starts
// scrolled to the top, so without this the scrollbar would visibly jump
// back on every click — save the outgoing frame's scrollTop and apply
// it to the new one.
//
// The saved position lives on `container` itself (not read from the
// outgoing frame at call time): exploration.js's live simulation can
// trigger two renderScreen calls back-to-back within the same
// microtask chain, with no browser paint in between (a supervisor
// resolving a waiting worker's promise synchronously resumes that
// worker's own render before the first render's own rAF has restored
// its scrollTop). Reading the live frame in that situation would
// capture 0 from the still-unrestored first frame instead of the
// user's real scroll position. A persisted value, kept current by a
// scroll listener on every frame, stays correct no matter how many
// renders happen before the next paint.
export function renderScreen(container, { eyebrow, title, subtitle, body, actions = [], corner } = {}) {
  const previousFrame = container.querySelector(".screen-frame");
  const scrollTop = container._savedScrollTop ?? (previousFrame ? previousFrame.scrollTop : 0);

  clear(container);
  const frame = h("div", { class: "screen-frame" }, [
    corner && corner.length ? h("div", { class: "hud-corner" }, corner) : null,
    h("header", { class: "screen-head" }, [
      h("div", { class: "screen-head__top" }, [eyebrow ? h("p", { class: "eyebrow", text: eyebrow }) : h("span")]),
      h("h1", { class: "screen-title", text: title }),
      subtitle ? h("p", { class: "screen-sub", text: subtitle }) : null,
    ]),
    h("div", { class: "screen-body" }, Array.isArray(body) ? body : [body]),
    actions.length ? h("footer", { class: "screen-actions" }, actions) : null,
  ]);
  container.appendChild(frame);
  frame.addEventListener("scroll", () => { container._savedScrollTop = frame.scrollTop; }, { passive: true });
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

// 短縮表示: a small resource summary shown above the eyebrow on every
// screen but 部隊編成画面 (see renderScreen's `corner`). 剛体資源 is
// shown above 自然資源, both left-aligned as one line of "/"-joined
// entries rather than individual pill tags -- with this many possible
// species (up to 9 rigid, 6 natural), a wrapping row of pills got
// visually noisy fast. Each entry is colored per RESOURCE_COLOR_CLASS
// where that resource has one (see resourceCatalog.js) so a player can
// tell at a glance how stocked they are on a given weapon-upgrade
// theme; entries without a mapped color render as plain text.
function hudLine(label, entries) {
  if (!entries.length) return null;
  const children = [`${label}: `];
  entries.forEach((entry, index) => {
    if (index > 0) children.push(" / ");
    const colorClass = RESOURCE_COLOR_CLASS[entry.speciesId];
    children.push(colorClass ? h("span", { class: colorClass, text: entry.text }) : entry.text);
  });
  return h("p", { class: "hud-line" }, children);
}

export function resourceHud(resources) {
  const { natural, rigid } = describeResources(resources);
  return [hudLine("剛体資源", rigid), hudLine("自然資源", natural)].filter(Boolean);
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

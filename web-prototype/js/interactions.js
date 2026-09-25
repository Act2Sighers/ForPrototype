// 汎用インタラクション・プリミティブ集。DOM/CSSの標準APIだけで完結し、
// シーンの状態管理（sceneManager.js／各シーンのrenderScreen再構築）とは
// 独立して動く。renderScreenが画面を作り直しても、ここで貼ったイベント
// リスナーはそのたび呼び出し側が要素ごと再アタッチする前提。

// 【ホバーポップアップ】要素にマウスオーバーしている間だけポップアップを
// 表示し、外れると閉じる。followCursor:trueならポップアップがマウス位置に
// 追従する。
export function attachHoverPopup(anchorEl, buildPopupEl, { followCursor = false, offsetX = 14, offsetY = 14 } = {}) {
  let popupEl = null;

  const position = (e) => {
    if (!popupEl) return;
    popupEl.style.left = `${e.clientX + offsetX}px`;
    popupEl.style.top = `${e.clientY + offsetY}px`;
  };

  const show = (e) => {
    popupEl = buildPopupEl();
    popupEl.style.position = "fixed";
    popupEl.style.pointerEvents = "none";
    popupEl.style.zIndex = "1000";
    document.body.appendChild(popupEl);
    position(e);
  };

  const hide = () => {
    if (!popupEl) return;
    popupEl.remove();
    popupEl = null;
  };

  anchorEl.addEventListener("mouseenter", show);
  anchorEl.addEventListener("mouseleave", hide);
  if (followCursor) anchorEl.addEventListener("mousemove", position);

  // 呼び出し側が明示的に後始末したい場合用（要素ごと破棄されるなら不要）。
  return { hide };
}

// 【ドラッグ＆ドロップ】pointer eventsでの自前ドラッグ。ネイティブHTML5
// DnD APIは既定のゴースト画像がブラウザ間で挙動が揺れやすいため、位置を
// 直接動かすこちらの方式を採用。ドロップ先の判定はdocument.elementFromPoint
// + dropZoneSelectorで行う。スナップはせず、任意の位置に配置可能。
export function makeDraggable(el, { dropZoneSelector = ".drop-zone", onDrop, onDragStart, onDragMove } = {}) {
  let startX = 0;
  let startY = 0;
  let origLeft = 0;
  let origTop = 0;
  let activePointerId = null;

  const onPointerMove = (e) => {
    if (e.pointerId !== activePointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    el.style.left = `${origLeft + dx}px`;
    el.style.top = `${origTop + dy}px`;
    onDragMove?.(e);
  };

  const onPointerUp = (e) => {
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
    el.classList.remove("is-dragging");
    el.style.pointerEvents = "";
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    el.style.visibility = "hidden";
    const dropTarget = document.elementFromPoint(e.clientX, e.clientY);
    el.style.visibility = "";
    const zone = dropTarget?.closest(dropZoneSelector) ?? null;
    onDrop?.(zone, e);
  };

  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    activePointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    const rect = el.getBoundingClientRect();
    const parentRect = el.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0 };
    origLeft = rect.left - parentRect.left;
    origTop = rect.top - parentRect.top;
    el.style.position = "absolute";
    el.style.left = `${origLeft}px`;
    el.style.top = `${origTop}px`;
    el.classList.add("is-dragging");
    // ドラッグ中は自分自身がelementFromPointに引っかからないよう、後で
    // 一時的にvisibility:hiddenにする（pointer-events:noneだとpointerup
    // 自体が飛ばなくなるため使わない）。
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    onDragStart?.(e);
  });
}

// 【ドラッグ矢印】開始要素からポインタダウンし、マウスを動かしている間、
// svgRoot内に始点(startEl中心)→現在のマウス座標への矢印を描画し続ける。
// マウスを動かすたび角度・長さが更新される。離した時点のelementFromPointを
// onDropに渡す。
export function attachDragArrow(startEl, svgRoot, { onDrop, onDragMove } = {}) {
  const svgNs = "http://www.w3.org/2000/svg";
  let line = null;
  let x1 = 0;
  let y1 = 0;

  const toSvgCoords = (clientX, clientY) => {
    const svgRect = svgRoot.getBoundingClientRect();
    return { x: clientX - svgRect.left, y: clientY - svgRect.top };
  };

  const onPointerMove = (e) => {
    if (!line) return;
    const { x, y } = toSvgCoords(e.clientX, e.clientY);
    line.setAttribute("x2", x);
    line.setAttribute("y2", y);
    onDragMove?.(e);
  };

  const onPointerUp = (e) => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    line?.remove();
    line = null;
    const target = document.elementFromPoint(e.clientX, e.clientY);
    onDrop?.(target, e);
  };

  startEl.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const startRect = startEl.getBoundingClientRect();
    const start = toSvgCoords(
      startRect.left + startRect.width / 2,
      startRect.top + startRect.height / 2
    );
    x1 = start.x;
    y1 = start.y;
    line = document.createElementNS(svgNs, "line");
    line.setAttribute("x1", x1);
    line.setAttribute("y1", y1);
    line.setAttribute("x2", x1);
    line.setAttribute("y2", y1);
    line.setAttribute("class", "drag-arrow");
    line.setAttribute("marker-end", "url(#drag-arrow-head)");
    svgRoot.appendChild(line);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  });
}

// 【自動ポップアップ】プレイヤー操作と無関係に、指定した時刻に現れて
// 一定時間後に自動で消える。
export function showTimedPopup(buildEl, { delay = 0, duration = 2000 } = {}) {
  setTimeout(() => {
    const el = buildEl();
    document.body.appendChild(el);
    setTimeout(() => el.remove(), duration);
  }, delay);
}

// 【流れるテキスト】枠内を一方向に流れ続けるテキスト（ニュースティッカー
// 型）。中身を複製して隙間なくループさせる。速度はduration(秒)で指定。
export function createMarquee(text, { duration = 8 } = {}) {
  const track = document.createElement("div");
  track.className = "marquee-track";
  track.style.animationDuration = `${duration}s`;
  for (let i = 0; i < 2; i++) {
    const span = document.createElement("span");
    span.className = "marquee-copy";
    span.textContent = text;
    track.appendChild(span);
  }
  const wrap = document.createElement("div");
  wrap.className = "marquee";
  wrap.appendChild(track);
  return wrap;
}

// 【任意配置】position:absoluteで designer が指定した任意の座標に置く
// だけのヘルパー。スナップは一切行わない。
export function placeAbsolute(el, { x, y, container }) {
  el.style.position = "absolute";
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  (container ?? el.parentElement)?.appendChild(el);
  return el;
}

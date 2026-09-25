import {
  attachHoverPopup,
  makeDraggable,
  attachDragArrow,
  showTimedPopup,
  createMarquee,
  placeAbsolute,
} from "./interactions.js";

// ① ホバーポップアップ（マウス追従）
attachHoverPopup(
  document.getElementById("hover-target"),
  () => {
    const el = document.createElement("div");
    el.className = "demo-popup";
    el.textContent = "マウスオーバー中だけ見える説明です";
    return el;
  },
  { followCursor: true }
);

// ② ドラッグ＆ドロップ（自由配置・スナップなし）
const dragToken = document.getElementById("drag-token");
const dragArena = dragToken.parentElement;
const dragStatus = document.getElementById("drag-status");
const dragTokenStartLeft = dragToken.offsetLeft;
const dragTokenStartTop = dragToken.offsetTop;
makeDraggable(dragToken, {
  dropZoneSelector: "#drop-zone",
  onDrop: (zone, e) => {
    if (zone) {
      const arenaRect = dragArena.getBoundingClientRect();
      const x = e.clientX - arenaRect.left - dragToken.offsetWidth / 2;
      const y = e.clientY - arenaRect.top - dragToken.offsetHeight / 2;
      dragToken.style.left = `${x}px`;
      dragToken.style.top = `${y}px`;
      dragStatus.textContent = `配置されました（枠内, x=${Math.round(x)}, y=${Math.round(y)}）`;
    } else {
      dragToken.style.left = `${dragTokenStartLeft}px`;
      dragToken.style.top = `${dragTokenStartTop}px`;
      dragStatus.textContent = "枠外だったため元の位置に戻りました。";
    }
  },
});

// ③ ドラッグ矢印
const arrowStatus = document.getElementById("arrow-status");
attachDragArrow(document.getElementById("arrow-start"), document.getElementById("arrow-svg"), {
  onDrop: (target) => {
    if (target?.id === "arrow-target-a") arrowStatus.textContent = "対象Aが選ばれました。";
    else if (target?.id === "arrow-target-b") arrowStatus.textContent = "対象Bが選ばれました。";
    else arrowStatus.textContent = "対象の上で離されなかったため、選択はキャンセルされました。";
  },
});

// ④ 自動ポップアップ
document.getElementById("timed-trigger").addEventListener("click", () => {
  showTimedPopup(
    () => {
      const el = document.createElement("div");
      el.className = "demo-popup demo-popup--timed";
      el.textContent = "自動で出て、自動で消えるイベント演出";
      return el;
    },
    { delay: 1200, duration: 2500 }
  );
});

// ⑤ 流れるテキスト
document.getElementById("marquee-frame").appendChild(
  createMarquee("このテキストは枠内を右から左へ途切れず流れ続けます　　", { duration: 9 })
);

// ⑥ 任意座標への自由配置
const board = document.getElementById("freeform-board");
const freeformSpots = [
  { label: "★", x: 24, y: 18 },
  { label: "●", x: 180, y: 60 },
  { label: "▲", x: 90, y: 130 },
  { label: "■", x: 260, y: 20 },
  { label: "◆", x: 320, y: 110 },
];
for (const spot of freeformSpots) {
  const el = document.createElement("div");
  el.className = "demo-freeform-icon";
  el.textContent = spot.label;
  placeAbsolute(el, { x: spot.x, y: spot.y, container: board });
}

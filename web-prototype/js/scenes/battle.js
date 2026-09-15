import { renderScreen, button, h } from "../dom.js";
import state from "../state.js";
import { computeStats } from "../data/resourceCatalog.js";
import { characterHpGauge } from "../characterCard.js";

// Layout-only pass: the actual turn/phase engine doesn't exist yet (see
// the user's replacement battle-system design, still to be built up
// piece by piece), so every value below that would normally come from
// live battle state is a fixed stand-in for "what a fresh battle's
// first moment looks like" -- IN reset to 0, PT at its round-start max
// of 3, 体幹 at its neutral baseline of 0, no 能力値 corrections active
// yet. A future round wires real per-unit battle state through here
// instead of these constants; the rendering shape (colors, lamp,
// grayout-readiness) is already built to expect it.
const ROUND_START_PT = 3;

const BATTLE_STAT_ORDER = ["attack", "defense", "destruction", "wisdom", "coordination"];
const BATTLE_STAT_ABBR = { attack: "攻", defense: "防", destruction: "破", wisdom: "賢", coordination: "協" };

// 能力値の補正状態 -- "positive" | "negative" | null. No corrections
// mechanic exists yet, so this always returns null (uncolored) for now;
// see the module comment above.
function getStatCorrection() {
  return null;
}

function statAbbrSpan(key, value) {
  const correction = getStatCorrection();
  const cls = correction === "positive" ? "battle-stat battle-stat--boost" : correction === "negative" ? "battle-stat battle-stat--drop" : "battle-stat";
  return h("span", { class: cls, text: `${BATTLE_STAT_ABBR[key]}${value}` });
}

function battleStatsLine(character) {
  const s = computeStats(character);
  const parts = ["能力値: [ "];
  BATTLE_STAT_ORDER.forEach((key, i) => {
    if (i > 0) parts.push(" / ");
    parts.push(statAbbrSpan(key, s[key]));
  });
  parts.push(" ]");
  return h("p", { class: "battle-unit__stats" }, parts);
}

// 体幹: 0 基準の正負整数。正なら「装甲」で青く、負なら「脆弱性」で
// 黄色く表示し、0（補正なし）はどちらのラベルも付けず素のまま表示する。
function staminaSpan() {
  const stamina = 0; // placeholder -- no 体幹 mechanic yet
  if (stamina > 0) return h("span", { class: "battle-unit__stamina battle-unit__stamina--armor", text: `装甲${stamina}` });
  if (stamina < 0) return h("span", { class: "battle-unit__stamina battle-unit__stamina--fragile", text: `脆弱性${-stamina}` });
  return h("span", { class: "battle-unit__stamina", text: "体幹: 0" });
}

// 残りPTを示すランプ。図形で示す指定なので文字の「●」「○」ではなく
// 実際の丸い要素を並べる（武器強化画面のゲージと同じ考え方）。
function ptLamp(current, max) {
  const dots = [];
  for (let i = 0; i < max; i++) {
    dots.push(h("span", { class: `pt-lamp__dot${i < current ? " pt-lamp__dot--filled" : ""}` }));
  }
  return h("div", { class: "pt-lamp" }, dots);
}

function battleUnitCard(character) {
  return h("div", { class: "battle-unit" }, [
    h("div", { class: "battle-unit__head" }, [
      h("span", { class: "battle-unit__name", text: character.name }),
      staminaSpan(),
    ]),
    characterHpGauge(character),
    battleStatsLine(character),
    h("div", { class: "battle-unit__footer" }, [
      h("span", { text: "IN: 0" }),
      h("span", { text: `PT: ${ROUND_START_PT} / ${ROUND_START_PT}` }),
      ptLamp(ROUND_START_PT, ROUND_START_PT),
    ]),
  ]);
}

// 敵陣営のデータはまだ存在しないため、6枠分の未実装プレースホルダーを
// 置いておく。
function emptyEnemySlot() {
  return h("div", { class: "battle-unit battle-unit--empty" }, [
    h("span", { class: "battle-unit__empty-label", text: "（未実装）" }),
  ]);
}

function battleLog() {
  const lines = ["（テキストログ：戦闘の経過がここに表示されます）"];
  return h(
    "div",
    { class: "battle-log" },
    lines.map((line) => h("p", { class: "battle-log__line", text: line }))
  );
}

function battleCenter() {
  return h("div", { class: "battle-center" }, [
    h("p", { class: "battle-center__turn", text: "1ターン目" }),
    h("p", { class: "battle-center__phase", text: "オードブル！" }),
    // 特定ユニット間のやり取りが発生している間だけ、ここに矢印が差し
    // 込まれる想定の予約スペース（味方↔敵は直線、自陣営同士はUターン
    // 形状）。今は常に空。
    h("div", { class: "battle-center__arrow" }),
    h("p", { class: "battle-center__vs", text: "vs" }),
  ]);
}

function battleArena() {
  const allies = state.formationSlots.map(battleUnitCard);
  const enemies = Array.from({ length: 6 }, () => emptyEnemySlot());
  return h("div", { class: "battle-arena" }, [
    h("div", { class: "battle-column battle-column--ally" }, allies),
    battleCenter(),
    h("div", { class: "battle-column battle-column--enemy" }, enemies),
  ]);
}

// レイアウトのみの実装 -- 中身（行動決定・実行フェイズ・勝敗判定など）
// は今後の回で順に積み上げる。
export function BattleScene(container, params, api) {
  renderScreen(container, {
    eyebrow: "BATTLE",
    title: "戦闘",
    body: [battleLog(), battleArena()],
    actions: [
      button("ポーズ", { variant: "ghost", onClick: () => api.callScene("pause") }),
      button("全滅（テスト用）", {
        variant: "danger",
        onClick: () => api.navigateTo("result", { mode: "gameover" }),
      }),
      button("戦闘を終える", { variant: "primary", onClick: () => api.closeScene() }),
    ],
  });
  return {};
}

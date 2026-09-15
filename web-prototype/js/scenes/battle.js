import { renderScreen, button, h } from "../dom.js";
import state from "../state.js";
import { computeStats, computeMaxHp, createCharacterFromData } from "../data/resourceCatalog.js";

// Layout-only pass: the actual turn/phase engine doesn't exist yet (see
// the user's replacement battle-system design, still to be built up
// piece by piece), so every value below that would normally come from
// live battle state is a fixed stand-in for "what a fresh battle's
// first moment looks like" -- IN reset to 0, PT at its round-start max
// of 3, 体幹 at its neutral baseline of 0, no 能力値 corrections active
// yet, and the 行動内容/行動対象 dropdowns have nothing real to offer
// (hence 行動実行！ staying disabled). A future round wires real
// per-unit battle state and real dropdown options through here instead
// of these constants; the rendering shape is already built to expect it.
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

// 隊員情報カード（characterCard.js）の HP ゲージと同じ構造だが、
// 戦闘画面の枠は横幅が厳しいので「カロリー(HP)」ではなく「HP」だけ
// のラベルにした専用版。
function battleHpGauge(character) {
  const maxHp = computeMaxHp(character.growth);
  const currentHp = character.currentHp ?? maxHp;
  const pct = maxHp > 0 ? Math.max(0, Math.min(100, (currentHp / maxHp) * 100)) : 0;
  return h("div", { class: "hp-line" }, [
    h("span", { class: "hp-line__label stat-hp", text: "HP" }),
    h("span", { class: "hp-line__value", text: `${currentHp} / ${maxHp}` }),
    h("div", { class: "hp-gauge" }, [h("div", { class: "hp-gauge__fill", style: `width:${pct}%` })]),
  ]);
}

function battleUnitCard(character) {
  return h("div", { class: "battle-unit" }, [
    h("div", { class: "battle-unit__head" }, [
      h("span", { class: "battle-unit__name", text: character.name }),
      staminaSpan(),
    ]),
    battleHpGauge(character),
    battleStatsLine(character),
    h("div", { class: "battle-unit__footer" }, [
      h("span", { text: "IN: 0" }),
      h("div", { class: "battle-unit__pt" }, [
        h("span", { text: `PT: ${ROUND_START_PT} / ${ROUND_START_PT}` }),
        ptLamp(ROUND_START_PT, ROUND_START_PT),
      ]),
    ]),
  ]);
}

// 敵陣営もまだ本当のデータモデルは無いため、レイアウト確認用として
// ビスケット・ベーカーの初期雇用データを編成人数分だけその場で生成
// する（保存はされない、描画のたびに使い捨て）。枠のレイアウトは
// battleUnitCard をそのまま流用し、味方枠と完全に同じにする。
function createLayoutEnemies(count) {
  return Array.from({ length: count }, () => createCharacterFromData("biscuitBaker"));
}

// 行動内容／行動対象を選ぶプルダウン2つ。中身の選択肢はフェイズや
// 戦況によって将来変わる想定だが、今はまだどちらも実データが無いので
// プレースホルダー1件だけを入れて無効化しておく（行動実行！ボタンが
// 無効なのと同じ理由）。
function actionSelectRow(labelText) {
  return h("div", { class: "battle-action-select__row" }, [
    h("span", { class: "battle-action-select__label", text: labelText }),
    h("select", { class: "battle-action-select__dropdown", disabled: true }, [h("option", { text: "－" })]),
  ]);
}

function actionSelectFields() {
  return h("div", { class: "battle-action-select__fields" }, [actionSelectRow("行動内容"), actionSelectRow("行動対象")]);
}

// ワイドモードの専用列に並ぶ、隊員名付きの版。味方ステータス列とは
// 別列で独立に積み上がるため、行の高さがずれても誰の枠か分かるよう
// 名前を添えている。
function actionSelectBox(character) {
  return h("div", { class: "battle-action-select" }, [
    h("p", { class: "battle-action-select__name", text: character.name }),
    actionSelectFields(),
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

// 携帯モードでもワイドモードでも共通の、テキストログ直下の実行ボタン。
// 行動内容も行動対象もまだ無いので常時無効。
function actionExecuteButton() {
  return h("button", { class: "btn btn--primary battle-execute-btn", disabled: true, text: "行動実行！" });
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

// ワイドモード：味方の行動選択列（左端）／味方ステータス列／中央情報
// （矢印表示部）／敵ステータス列、の4列。中央の矢印表示部を味方・敵
// 両ステータス列に挟ませるため、行動選択列は一番外側に置く。
function battleArena() {
  const allies = state.formationSlots;
  const enemies = createLayoutEnemies(allies.length);
  return h("div", { class: "battle-arena" }, [
    h("div", { class: "battle-column battle-column--action" }, allies.map(actionSelectBox)),
    h("div", { class: "battle-column battle-column--ally" }, allies.map(battleUnitCard)),
    battleCenter(),
    h("div", { class: "battle-column battle-column--enemy" }, enemies.map(battleUnitCard)),
  ]);
}

// 携帯モード：視覚的な戦場が非表示になる代わりに、隊員ごとの名前・HP
// ・行動選択プルダウンだけの縦並びリストを出す。
function mobileUnitRow(character) {
  return h("div", { class: "battle-mobile-unit" }, [
    h("p", { class: "battle-mobile-unit__name", text: character.name }),
    battleHpGauge(character),
    actionSelectFields(),
  ]);
}

function battleMobileRoster() {
  return h("div", { class: "battle-mobile-roster" }, state.formationSlots.map(mobileUnitRow));
}

// レイアウトのみの実装 -- 中身（行動決定・実行フェイズ・勝敗判定など）
// は今後の回で順に積み上げる。
export function BattleScene(container, params, api) {
  renderScreen(container, {
    eyebrow: "BATTLE",
    title: "戦闘",
    body: [battleLog(), actionExecuteButton(), battleArena(), battleMobileRoster()],
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

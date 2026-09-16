import { renderScreen, button, h } from "../dom.js";
import state from "../state.js";
import { computeStats, computeMaxHp, createCharacterFromData } from "../data/resourceCatalog.js";

// Placeholder pacing per the user's own instruction (tune later), mirroring
// exploration.js's own __EXPLORATION_FAST__ hook. window.__BATTLE_FAST__
// lets tests speed this up without touching production behavior.
const FAST = typeof window !== "undefined" && window.__BATTLE_FAST__;
const ACTION_DELAY_MS = FAST ? 10 : 1000;
const MAIN_PHASE_WAIT_MS = FAST ? 20 : 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

const SVG_NS = "http://www.w3.org/2000/svg";
function svg(tag, attrs = {}, children = []) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    el.setAttribute(key, value);
  }
  for (const kid of Array.isArray(children) ? children : [children]) {
    if (kid) el.appendChild(kid);
  }
  return el;
}

// 矢印はアリーナ全体を覆う1枚のオーバーレイSVGに、行動主体・行動対象
// それぞれのステータス枠の「中央側の辺」の中点を実測して描く（DOM実測
// が必要なので、この2つの生成関数はピクセル座標を直接受け取る）。
// 相手陣営への矢印は直線＋矢じり。
function crossArrowElements(a, b) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const headLen = 10;
  const headWidth = 6;
  const baseX = b.x - headLen * Math.cos(angle);
  const baseY = b.y - headLen * Math.sin(angle);
  const leftX = baseX + headWidth * Math.sin(angle);
  const leftY = baseY - headWidth * Math.cos(angle);
  const rightX = baseX - headWidth * Math.sin(angle);
  const rightY = baseY + headWidth * Math.cos(angle);
  return [
    svg("line", { x1: a.x, y1: a.y, x2: baseX, y2: baseY, class: "battle-arrow-line" }),
    svg("polygon", { points: `${b.x},${b.y} ${leftX},${leftY} ${rightX},${rightY}`, class: "battle-arrow-head" }),
  ];
}

// 自陣営（自分自身を含む）への矢印はUターン、実際にはコの字型。行動
// 主体・対象それぞれの辺の中点(同じx座標のはず)を、行動主体側の外側
// （味方なら左、敵なら右）へ膨らませて繋ぐ。自分自身が対象の場合は
// 幅の狭いコの字にする。矢じりは対象側の辺の中点に、内向きに付く。
function loopArrowElements(x, yStart, yEnd, faction, isSelf) {
  const outwardSign = faction === "ally" ? -1 : 1;
  const offset = isSelf ? 14 : 26;
  const y0 = isSelf ? yStart - 10 : yStart;
  const y1 = isSelf ? yStart + 10 : yEnd;
  const xOuter = x + outwardSign * offset;
  const path = svg("path", { d: `M${x},${y0} L${xOuter},${y0} L${xOuter},${y1} L${x},${y1}`, class: "battle-arrow-line", fill: "none" });
  const headLen = 8;
  const headWidth = 6;
  const baseX = xOuter > x ? x + headLen : x - headLen;
  const head = svg("polygon", { points: `${x},${y1} ${baseX},${y1 - headWidth} ${baseX},${y1 + headWidth}`, class: "battle-arrow-head" });
  return [path, head];
}

// ステータス枠の「中央側の辺」の中点：味方は右辺、敵は左辺。
function edgePoint(rect, arenaRect, faction) {
  const x = (faction === "ally" ? rect.right : rect.left) - arenaRect.left;
  const y = rect.top - arenaRect.top + rect.height / 2;
  return { x, y };
}

// Prepフェイズの4行動。いずれも「モジュール」(内部識別用の符丁で、実際
// にユニットが使う「スキル」とは区別される) 1つだけで構成される仮実装
// -- 将来的にはダイスロールなどが絡む可能性があるが、今はIN/PTが正しく
// 増減することの確認が目的。targetFaction: "own"=自陣営(自分自身も可)、
// "opposing"=相手陣営。stat: 効果がINかPTかの識別用（ログ表示に使う）。
const PREP_MODULES = {
  optimize: { id: "optimize", label: "最適化", targetFaction: "own", stat: "in", apply: (t) => { t.in += 1; } },
  restrain: { id: "restrain", label: "牽制", targetFaction: "opposing", stat: "in", apply: (t) => { t.in -= 1; } },
  inspire: {
    id: "inspire",
    label: "鼓舞",
    targetFaction: "own",
    stat: "pt",
    apply: (t) => { t.pt.current += 1; t.pt.max += 1; },
  },
  intimidate: {
    id: "intimidate",
    label: "威圧",
    targetFaction: "opposing",
    stat: "pt",
    apply: (t) => {
      t.pt.current = Math.max(1, t.pt.current - 1);
      t.pt.max = Math.max(1, t.pt.max - 1);
    },
  },
};

const PREP_START_PT = 3;

// 陣営ごとの隊員をラップする、戦闘限定の使い捨てデータ。IN/PT/行動選択
// はここにだけ持たせ、隊員本体（state.formationSlots の実オブジェクト）
// には一切書き込まない。
function createBattleUnit(character, faction) {
  return { character, faction, in: 0, pt: { current: PREP_START_PT, max: PREP_START_PT }, action: null, displayName: character.name };
}

// 戦闘開始時、陣営を問わず同名のユニットがいる場合、2体目以降の名前に
// 「 (2)」のように連番を振る（1体目はそのまま）。武器や隊員本体の
// name は一切書き換えず、戦闘画面だけが使う displayName に持たせる。
function assignDisplayNames(units) {
  const counts = new Map();
  for (const unit of units) {
    const name = unit.character.name;
    const count = (counts.get(name) ?? 0) + 1;
    counts.set(name, count);
    unit.displayName = count === 1 ? name : `${name} (${count})`;
  }
}

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
// 体幹そのものを動かす行動はまだ無いので、常に0のプレースホルダー。
function staminaSpan() {
  const stamina = 0;
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

// 味方・敵どちらのステータス枠もこの1つを共有する。IN/PTは戦闘用ラッパ
// (unit) から、HP/能力値は隊員本体(unit.character)から読む。
// highlightClass: 矢印表示中の行動主体/行動対象を示す追加クラス、無い
// 時はnull。data-unit-id は矢印オーバーレイがDOM実測で枠を探すためのキー。
function battleUnitCard(unit, highlightClass) {
  const classes = highlightClass ? `battle-unit ${highlightClass}` : "battle-unit";
  return h("div", { class: classes, "data-unit-id": unit.character.id }, [
    h("div", { class: "battle-unit__head" }, [
      h("span", { class: "battle-unit__name", text: unit.displayName }),
      staminaSpan(),
    ]),
    battleHpGauge(unit.character),
    battleStatsLine(unit.character),
    h("div", { class: "battle-unit__footer" }, [
      h("span", { text: `IN: ${unit.in}` }),
      h("div", { class: "battle-unit__pt" }, [
        h("span", { text: `PT: ${unit.pt.current} / ${unit.pt.max}` }),
        ptLamp(unit.pt.current, unit.pt.max),
      ]),
    ]),
  ]);
}

function targetDisplayName(actor, target) {
  return target === actor ? `${target.displayName}（自分自身）` : target.displayName;
}

function statSnapshotText(unit, stat) {
  return stat === "in" ? String(unit.in) : `${unit.pt.current}/${unit.pt.max}`;
}

// レイアウトのみだった前回までと異なり、今回からPrepフェイズの実際の
// 進行（CPUのランダム行動選択、プレイヤーの手動選択、ウェイト付き
// 順次処理によるIN/PT増減、矢印の一時表示）を持つ。Mainフェイズは
// まだ空実装で、表示とウェイトだけを行う。
export function BattleScene(container, params, api) {
  const allyUnits = state.formationSlots.map((c) => createBattleUnit(c, "ally"));
  const enemyUnits = Array.from({ length: allyUnits.length }, () => createBattleUnit(createCharacterFromData("biscuitBaker"), "enemy"));
  assignDisplayNames([...allyUnits, ...enemyUnits]);

  let turn = 1;
  let phase = "prep"; // "prep" | "main"
  let executing = false; // true for the whole duration of runPrepExecution (blocks input)
  let activeArrow = null; // { actor, target } | null
  const logLines = [];

  function pushLog(text) {
    logLines.push(text);
  }

  function candidateUnits(actor, moduleId) {
    const module = PREP_MODULES[moduleId];
    const own = actor.faction === "ally" ? allyUnits : enemyUnits;
    const opposing = actor.faction === "ally" ? enemyUnits : allyUnits;
    return module.targetFaction === "own" ? own : opposing;
  }

  function randomEnemyAction(unit) {
    const moduleId = pickRandom(Object.keys(PREP_MODULES));
    const targetUnit = pickRandom(candidateUnits(unit, moduleId));
    return { moduleId, targetUnit };
  }

  // 毎ターンのPrepフェイズ開始時: 全ユニットのIN/PTをリセットし、味方の
  // 行動選択は空に、敵の行動選択はCPUがランダムに選び直す（非公開）。
  function resetForNewPrepPhase() {
    for (const unit of [...allyUnits, ...enemyUnits]) {
      unit.in = 0;
      unit.pt = { current: PREP_START_PT, max: PREP_START_PT };
    }
    for (const unit of allyUnits) unit.action = null;
    for (const unit of enemyUnits) unit.action = randomEnemyAction(unit);
  }

  for (const unit of enemyUnits) unit.action = randomEnemyAction(unit);
  pushLog(`《${turn}ターン目》オードブル！`);

  function isInteractive() {
    return phase === "prep" && !executing;
  }

  function allAlliesReady() {
    return allyUnits.every((u) => u.action && u.action.targetUnit);
  }

  function handleModuleChange(unit, moduleId) {
    unit.action = moduleId ? { moduleId, targetUnit: null } : null;
    render();
  }

  function handleTargetChange(unit, targetUnit) {
    if (unit.action) unit.action.targetUnit = targetUnit;
    render();
  }

  // Prepフェイズの行動順は必ず「味方①→敵①→味方②→敵②→…」で、INとは
  // 無関係。1ユニットにつき「宣言（矢印表示）→ウェイト→効果適用＋結果
  // ログ→ウェイト」の順で進む。
  async function runPrepExecution() {
    executing = true;
    render();

    const order = allyUnits.flatMap((_, i) => [allyUnits[i], enemyUnits[i]]);
    for (const unit of order) {
      const { moduleId, targetUnit } = unit.action;
      const module = PREP_MODULES[moduleId];
      activeArrow = { actor: unit, target: targetUnit };
      pushLog(`${unit.displayName}が「${module.label}」を${targetDisplayName(unit, targetUnit)}に使用！`);
      render();
      await sleep(ACTION_DELAY_MS);

      const before = statSnapshotText(targetUnit, module.stat);
      module.apply(targetUnit);
      const after = statSnapshotText(targetUnit, module.stat);
      pushLog(`${targetUnit.displayName}の${module.stat === "in" ? "IN" : "PT"}：${before} → ${after}`);
      render();
      await sleep(ACTION_DELAY_MS);
    }

    activeArrow = null;
    for (const unit of allyUnits) unit.action = null;
    phase = "main";
    pushLog(`《${turn}ターン目》メインディッシュ！`);
    render();
    await sleep(MAIN_PHASE_WAIT_MS);

    turn += 1;
    resetForNewPrepPhase();
    phase = "prep";
    executing = false;
    pushLog(`《${turn}ターン目》オードブル！`);
    render();
  }

  function moduleSelectFor(unit) {
    const select = h(
      "select",
      {
        class: "battle-action-select__dropdown",
        disabled: !isInteractive(),
        onChange: (e) => handleModuleChange(unit, e.target.value),
      },
      [h("option", { value: "", text: "－" }), ...Object.values(PREP_MODULES).map((m) => h("option", { value: m.id, text: m.label }))]
    );
    select.value = unit.action?.moduleId ?? "";
    return select;
  }

  function targetSelectFor(unit) {
    const moduleId = unit.action?.moduleId ?? "";
    const candidates = moduleId ? candidateUnits(unit, moduleId) : [];
    const select = h(
      "select",
      {
        class: "battle-action-select__dropdown",
        disabled: !isInteractive() || !moduleId,
        onChange: (e) => {
          const target = candidates.find((c) => c.character.id === e.target.value) ?? null;
          handleTargetChange(unit, target);
        },
      },
      [
        h("option", { value: "", text: "－" }),
        ...candidates.map((c) => h("option", { value: c.character.id, text: c === unit ? `${c.displayName}（自分）` : c.displayName })),
      ]
    );
    select.value = unit.action?.targetUnit?.character.id ?? "";
    return select;
  }

  function actionSelectFields(unit) {
    return h("div", { class: "battle-action-select__fields" }, [
      h("div", { class: "battle-action-select__row" }, [h("span", { class: "battle-action-select__label", text: "行動内容" }), moduleSelectFor(unit)]),
      h("div", { class: "battle-action-select__row" }, [h("span", { class: "battle-action-select__label", text: "行動対象" }), targetSelectFor(unit)]),
    ]);
  }

  // ワイドモードの専用列に並ぶ、隊員名付きの版。味方ステータス列とは
  // 別列で独立に積み上がるため、行の高さがずれても誰の枠か分かるよう
  // 名前を添えている。
  function actionSelectBox(unit) {
    return h("div", { class: "battle-action-select" }, [h("p", { class: "battle-action-select__name", text: unit.displayName }), actionSelectFields(unit)]);
  }

  function battleLog() {
    return h(
      "div",
      { class: "battle-log" },
      logLines.map((line) => h("p", { class: "battle-log__line", text: line }))
    );
  }

  // 携帯モードでもワイドモードでも共通の、テキストログ直下の実行ボタン。
  // 全味方の行動内容・行動対象が確定するまで、またPrepフェイズ以外・
  // 処理中は無効。
  function actionExecuteButton() {
    return h("button", {
      class: "btn btn--primary battle-execute-btn",
      disabled: !isInteractive() || !allAlliesReady(),
      onClick: runPrepExecution,
      text: "行動実行！",
    });
  }

  function battleCenter() {
    return h("div", { class: "battle-center" }, [
      h("p", { class: "battle-center__turn", text: `${turn}ターン目` }),
      h("p", { class: "battle-center__phase", text: phase === "prep" ? "オードブル！" : "メインディッシュ！" }),
      h("p", { class: "battle-center__vs", text: "vs" }),
    ]);
  }

  // 矢印表示中、その行動主体・行動対象のステータス枠に付与する追加
  // クラス（無関係なユニットにはnull）。
  function highlightFor(unit) {
    if (!activeArrow) return null;
    if (unit === activeArrow.actor) return "battle-unit--actor";
    if (unit === activeArrow.target) return "battle-unit--target";
    return null;
  }

  // ワイドモード：味方の行動選択列（左端）／味方ステータス列／中央情報
  // ／敵ステータス列、の4列。矢印は各ステータス枠の中央側の辺を実測し
  // て描く1枚のオーバーレイSVG（アリーナ全体に重ねる）で、中央の
  // フェイズ表示や「vs」の上を横切ることもある。
  function battleArena() {
    return h("div", { class: "battle-arena" }, [
      h("div", { class: "battle-column battle-column--action" }, allyUnits.map(actionSelectBox)),
      h("div", { class: "battle-column battle-column--ally" }, allyUnits.map((u) => battleUnitCard(u, highlightFor(u)))),
      battleCenter(),
      h("div", { class: "battle-column battle-column--enemy" }, enemyUnits.map((u) => battleUnitCard(u, highlightFor(u)))),
      svg("svg", { class: "battle-arrow-overlay" }),
    ]);
  }

  // battleArena()がDOMに実際に挿入された後（render()内でrenderScreen
  // 呼び出し直後）に呼ぶ。activeArrowが無ければ何も描かない。DOM実測
  // (getBoundingClientRect)が必要なので、ここだけは仮想DOM的な組み立て
  // ではなく直接DOM操作している。
  function updateArrowOverlay() {
    const arenaEl = container.querySelector(".battle-arena");
    const overlay = arenaEl?.querySelector(".battle-arrow-overlay");
    if (!overlay) return;
    while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
    if (!activeArrow) return;

    const arenaRect = arenaEl.getBoundingClientRect();
    if (!arenaRect.width || !arenaRect.height) return; // 携帯モードでアリーナ自体が非表示の間は何もしない
    overlay.setAttribute("viewBox", `0 0 ${arenaRect.width} ${arenaRect.height}`);

    const actorEl = arenaEl.querySelector(`[data-unit-id="${activeArrow.actor.character.id}"]`);
    const targetEl = arenaEl.querySelector(`[data-unit-id="${activeArrow.target.character.id}"]`);
    if (!actorEl || !targetEl) return;

    const a = edgePoint(actorEl.getBoundingClientRect(), arenaRect, activeArrow.actor.faction);
    const b = edgePoint(targetEl.getBoundingClientRect(), arenaRect, activeArrow.target.faction);

    const elements =
      activeArrow.actor.faction !== activeArrow.target.faction
        ? crossArrowElements(a, b)
        : loopArrowElements(a.x, a.y, b.y, activeArrow.actor.faction, activeArrow.actor === activeArrow.target);
    for (const el of elements) overlay.appendChild(el);
  }

  // 携帯モード：視覚的な戦場が非表示になる代わりに、隊員ごとの名前・HP
  // ・行動選択プルダウンだけの縦並びリストを出す。
  function mobileUnitRow(unit) {
    return h("div", { class: "battle-mobile-unit" }, [h("p", { class: "battle-mobile-unit__name", text: unit.displayName }), battleHpGauge(unit.character), actionSelectFields(unit)]);
  }

  function battleMobileRoster() {
    return h("div", { class: "battle-mobile-roster" }, allyUnits.map(mobileUnitRow));
  }

  function render() {
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
    // テキストログは常に最新行が見えるよう、描画のたびに一番下へ
    // スクロールする（.screen-frame自体のスクロール位置保持とは別)。
    const logEl = container.querySelector(".battle-log");
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
    updateArrowOverlay();
  }

  render();
  return {};
}

import { renderScreen, button, h } from "../dom.js";
import state, { grantResource, grantTieredResource, recordDefeatedMonsterLevels, recordRescue, setBattleDoubleSpeed } from "../state.js";
import {
  computeStats,
  computeEffectiveMaxHp,
  increaseCondition,
  MONSTER_DATA,
  createMonsterFromData,
  createBossMonsterFromData,
  computeProgressLevel,
  applyHpDamage,
  applyHpHeal,
  CHARACTER_STAT_FULL_LABELS,
  computeBattleRewards,
  NATURAL_RESOURCES,
  RIGID_RESOURCES,
  NATURAL_QUALITY_LABELS,
  RIGID_QUALITY_LABELS,
  COATING_ATTRIBUTE_LABELS,
  WEAPON_TYPES,
} from "../data/resourceCatalog.js";
import { computeBossLevel } from "../data/testDungeon.js";
import { rollD6, rollSum, rollJudgement, successCountToR } from "../dice.js";

// Placeholder pacing per the user's own instruction (tune later), mirroring
// exploration.js's own __EXPLORATION_FAST__ hook. window.__BATTLE_FAST__
// lets tests speed this up without touching production behavior.
const FAST = typeof window !== "undefined" && window.__BATTLE_FAST__;
const ACTION_DELAY_MS = FAST ? 10 : 1000;
const MAIN_PHASE_WAIT_MS = FAST ? 20 : 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms / (state.battleDoubleSpeed ? 2 : 1)));
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// 体幹の絶対値を、オプション画面「体幹関連係数」の「体幹変動幅上限」
// （state.battleTuning.staminaRangeCap）以内に丸める。プロテクト/
// スマッシュのように体幹を0から遠ざける操作の直後にのみ通す
// （ピール/ブレンドや毎ターン終了時の自然逓減は0へ向かう一方なので
// 上限を超えることがなく、この丸めは不要）。
function clampStamina(value) {
  const cap = state.battleTuning.staminaRangeCap;
  return Math.min(cap, Math.max(-cap, value));
}

// Fisher-Yatesでlistをその場でシャッフルする（Mainフェイズの同IN内
// ランダム順を決めるのに使う）。
function shuffleInPlace(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
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
// 相手陣営への矢印は直線＋矢じり。variantを指定すると専用クラスが付き
// （現状"pin"＝挑発の釘付け矢印のみ）、見た目（色）だけを差し替える。
function crossArrowElements(a, b, variant) {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const headLen = 10;
  const headWidth = 6;
  const baseX = b.x - headLen * Math.cos(angle);
  const baseY = b.y - headLen * Math.sin(angle);
  const leftX = baseX + headWidth * Math.sin(angle);
  const leftY = baseY - headWidth * Math.cos(angle);
  const rightX = baseX - headWidth * Math.sin(angle);
  const rightY = baseY + headWidth * Math.cos(angle);
  const lineClass = variant ? `battle-arrow-line battle-arrow-line--${variant}` : "battle-arrow-line";
  const headClass = variant ? `battle-arrow-head battle-arrow-head--${variant}` : "battle-arrow-head";
  return [
    svg("line", { x1: a.x, y1: a.y, x2: baseX, y2: baseY, class: lineClass }),
    svg("polygon", { points: `${b.x},${b.y} ${leftX},${leftY} ${rightX},${rightY}`, class: headClass }),
  ];
}

// 「隠密」状態のユニットのステータス枠の隣（中央側、点edgeのさらに外側）
// に描く薄い青のバツ印。
function stealthMarkElements(edge, faction) {
  const offset = 14;
  const x = faction === "ally" ? edge.x + offset : edge.x - offset;
  const y = edge.y;
  const r = 6;
  return [
    svg("line", { x1: x - r, y1: y - r, x2: x + r, y2: y + r, class: "battle-stealth-mark" }),
    svg("line", { x1: x - r, y1: y + r, x2: x + r, y2: y - r, class: "battle-stealth-mark" }),
  ];
}

// 自陣営（自分自身を含む）への矢印はUターン、実際にはコの字型。行動
// 主体・対象それぞれの辺の中点(同じx座標のはず)を、味方陣営なら右側、
// 敵陣営なら左側へ膨らませて繋ぐ。自分自身が対象の場合は幅の狭いコの
// 字にする。矢じりは対象側の辺の中点に、内向きに付く。
function loopArrowElements(x, yStart, yEnd, faction, isSelf, variant) {
  const outwardSign = faction === "ally" ? 1 : -1;
  const offset = isSelf ? 14 : 26;
  const y0 = isSelf ? yStart - 10 : yStart;
  const y1 = isSelf ? yStart + 10 : yEnd;
  const xOuter = x + outwardSign * offset;
  const lineClass = variant ? `battle-arrow-line battle-arrow-line--${variant}` : "battle-arrow-line";
  const headClass = variant ? `battle-arrow-head battle-arrow-head--${variant}` : "battle-arrow-head";
  const path = svg("path", { d: `M${x},${y0} L${xOuter},${y0} L${xOuter},${y1} L${x},${y1}`, class: lineClass, fill: "none" });
  const headLen = 8;
  const headWidth = 6;
  const baseX = xOuter > x ? x + headLen : x - headLen;
  const head = svg("polygon", { points: `${x},${y1} ${baseX},${y1 - headWidth} ${baseX},${y1 + headWidth}`, class: headClass });
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
  // n（強さ）は既定1 -- スキル側がstep.paramsで上書きするまでは、プレイ
  // ヤーが直接選ぶ単体モジュールとして今まで通り常に1で動く。
  optimize: { id: "optimize", label: "最適化", targetFaction: "own", stat: "in", shortNotation: "P/最適化", apply: (t, n = 1) => { t.in += n; } },
  restrain: { id: "restrain", label: "牽制", targetFaction: "opposing", stat: "in", shortNotation: "P/牽制", apply: (t, n = 1) => { t.in -= n; } },
  inspire: {
    id: "inspire",
    label: "鼓舞",
    targetFaction: "own",
    stat: "pt",
    shortNotation: "P/鼓舞",
    apply: (t, n = 1) => { t.pt.current += n; t.pt.max += n; },
  },
  provoke: {
    id: "provoke",
    label: "挑発",
    targetFaction: "opposing",
    statusLabel: "釘付け",
    shortNotation: "P/挑発",
    apply: (actor, target, allyUnits, enemyUnits) => {
      if (isSoleSurvivor(actor, allyUnits, enemyUnits)) return { applied: false };
      target.pinnedBy = actor;
      return { applied: true };
    },
  },
  stealth: {
    id: "stealth",
    label: "隠密",
    targetFaction: "self",
    statusLabel: "隠密",
    shortNotation: "P/隠密s",
    apply: (actor, target, allyUnits, enemyUnits) => {
      if (isSoleSurvivor(actor, allyUnits, enemyUnits)) return { applied: false };
      target.stealthed = true;
      return { applied: true };
    },
  },
  intimidate: {
    id: "intimidate",
    label: "威圧",
    targetFaction: "opposing",
    stat: "pt",
    shortNotation: "P/威圧",
    apply: (t, n = 1) => {
      t.pt.current = Math.max(1, t.pt.current - n);
      t.pt.max = Math.max(1, t.pt.max - n);
    },
  },
  // 【警護】：自身以外の自陣営ユニット1体を「警護対象」状態にする土台の
  // 葉アクション。挑発/隠密と同じく、自陣営で行動可能なのが自分しか
  // いなければ不発（isSoleSurvivor）。実際の「対象の差し替え」は
  // opposingPoolFor側（Mainフェイズ限定）で行う -- unit.guardedByが
  // 立っている候補は、その守護者自身に差し替わる。
  // 隊員向けの名前付きラッパー【ついて来て！】（下のObject.assignブロック
  // 参照）と、モンスター側の【従順】【一途】（カルメヤ犬系統）がどちらも
  // これをsteps側から参照する（【体当たり】が【攻撃】を参照するのと同じ
  // 構造）。プレイヤーの自由選択メニューにはラッパー側だけを見せたいので、
  // ここ自身はmonsterOnly（＝自陣営「ally」からの自由選択には出さない）
  // 扱いにしておく -- steps経由の参照はisModuleAvailableForを通らない
  // ため、モンスター側からもラッパー経由でも変わらず使える。
  guard: {
    id: "guard",
    label: "警護",
    targetFaction: "ownExcludingSelf",
    statusLabel: "警護対象",
    monsterOnly: true,
    shortNotation: "P/警護",
    apply: (actor, target, allyUnits, enemyUnits) => {
      if (isSoleSurvivor(actor, allyUnits, enemyUnits)) return { applied: false };
      target.guardedBy = actor;
      return { applied: true };
    },
  },
};

// PrepフェイズのスキルもMainフェイズと同じ「モジュールと同じ辞書に
// steps持ちで同居させる」構造を使う（PREP_MODULES/MAIN_MODULESの
// レジストリはPrep/Mainで混ざらない）。Mainフェイズのスキルと違い、
// Prepフェイズで実際に実行されるスキルはコストを要さない（costを
// 持たない）。行動対象候補はスキル自身のtargetFactionで決まる。
// 【祝福】：オードブル、最適化。最適化した後、同じ行動対象に鼓舞を
// 行う。
Object.assign(PREP_MODULES, {
  blessing: {
    id: "blessing",
    label: "祝福",
    targetFaction: "own",
    shortNotation: "P/最適化+",
    steps: [{ actionId: "optimize" }, { actionId: "inspire" }],
  },
  // 【ついて来て！】：警護をそのまま1ステップ使う名前付きラッパー
  // （【体当たり】が【攻撃】を参照するのと同じ構造）。
  guardAlly: {
    id: "guardAlly",
    label: "ついて来て！",
    targetFaction: "ownExcludingSelf",
    allyOnly: true,
    shortNotation: "P/警護",
    steps: [{ actionId: "guard" }],
  },
  // 【陰陽】：牽制した後、（前ステップの対象とは無関係に）自身を対象に
  // 最適化を行う。スキル自身の対象選択は牽制の候補（相手陣営）1回のみ
  // -- target:"self"が2ステップ目の対象を行動主体自身に固定する。
  yinYang: {
    id: "yinYang",
    label: "陰陽",
    targetFaction: "opposing",
    shortNotation: "P/牽制+",
    steps: [{ actionId: "restrain" }, { actionId: "optimize", target: "self" }],
  },
  // 【衛星】：鼓舞。ただし対象候補から自身を除外する（targetFaction:
  // "ownExcludingSelf"）。鼓舞した後、（前ステップの対象とは無関係に）
  // 自身を対象に鼓舞を行う。
  satellite: {
    id: "satellite",
    label: "衛星",
    targetFaction: "ownExcludingSelf",
    shortNotation: "P/鼓舞+",
    steps: [{ actionId: "inspire" }, { actionId: "inspire", target: "self" }],
  },
  // 【漁火】：威圧した後、（1回目とは別の）もう1体の相手陣営ユニットに
  // 威圧を行う。スキル自身の対象選択は1回目の威圧の候補（相手陣営）
  // 1回のみ -- target:"opposingExcludingUsed"が2回目の対象をこのスキル
  // 内で既に対象になったユニットを除いてランダムに選び直す（他に候補
  // がいなければ不発）。
  fishFire: {
    id: "fishFire",
    label: "漁火",
    targetFaction: "opposing",
    shortNotation: "P/威圧+",
    steps: [{ actionId: "intimidate" }, { actionId: "intimidate", target: "opposingExcludingUsed" }],
  },
  // 【泥沼】：行動対象の指定を受けず（targetFaction: "none"）、相手陣営
  // の生存者全員に順番に牽制を行う -- step.each:"opposing"が対象候補の
  // 選択を経由せず陣営全員を自分でイテレートする。
  quagmire: {
    id: "quagmire",
    label: "泥沼",
    targetFaction: "none",
    shortNotation: "P/牽制*",
    steps: [{ actionId: "restrain", each: "opposing" }],
  },
});

// モンスタースキル・Prepフェイズ。既存のPrepスキル同様、monsterOnly:true
// を付けてプレイヤーの行動選択肢（moduleSelectFor）には出さない
// （isModuleAvailableFor参照）。
Object.assign(PREP_MODULES, {
  excitement: {
    id: "excitement",
    label: "興奮",
    targetFaction: "self",
    monsterOnly: true,
    shortNotation: "P/最適化s",
    steps: [{ actionId: "optimize" }],
  },
  interference: {
    id: "interference",
    label: "邪魔",
    targetFaction: "opposing",
    monsterOnly: true,
    shortNotation: "P/牽制",
    steps: [{ actionId: "restrain" }],
  },
  staticCling: {
    id: "staticCling",
    label: "静電気",
    targetFaction: "none",
    monsterOnly: true,
    shortNotation: "P/最適化*",
    steps: [{ actionId: "optimize", each: "own" }],
  },
  elegance: {
    id: "elegance",
    label: "優雅",
    targetFaction: "self",
    monsterOnly: true,
    shortNotation: "P/鼓舞s",
    steps: [{ actionId: "inspire" }],
  },
  // 【食べ比べ】：相手陣営1体を選び、1D6の出目で鼓舞(1)/威圧(1)/威圧(2)の
  // いずれかに分岐する。鼓舞・威圧そのものは対象の陣営を問わず機能する
  // （apply()はどちらもPTを増減させるだけの処理で、targetFactionは候補
  // 選択にしか使わない）ため、対象を相手陣営に固定した専用スキルとして
  // 素直に流用できる。ダイス分岐は固定確率のstepsでは表現できないため、
  // custom マーカーで resolvePrepAction 側の専用処理（resolveTasteTest）
  // に振り分ける（steps は持たない）。
  tasteTest: {
    id: "tasteTest",
    label: "食べ比べ",
    targetFaction: "opposing",
    monsterOnly: true,
    shortNotation: "P/特殊D",
    custom: "tasteTest",
  },
  // 【噛み合わせ】：牽制した後、（前ステップの対象とは無関係に）自身を
  // 対象に最適化を行う -- 構造は既存の陰陽と同一。
  biteMesh: {
    id: "biteMesh",
    label: "噛み合わせ",
    targetFaction: "opposing",
    monsterOnly: true,
    shortNotation: "P/牽制+",
    steps: [{ actionId: "restrain" }, { actionId: "optimize", target: "self" }],
  },
  // 【団結】：自身を最適化する強さ(n)が固定値ではなく「自陣営の行動可能
  // なユニットの数」（自身を含む）で毎回変わる。step.paramsを関数にして
  // 解決時に都度算出する -- ownPoolForはBattleScene内のクロージャで
  // トップレベルのこのオブジェクトからは見えないため、呼び出し側
  // （resolveStepParams）が第3引数として渡す。
  unity: {
    id: "unity",
    label: "団結",
    targetFaction: "self",
    monsterOnly: true,
    shortNotation: "P/最適化?s",
    steps: [{ actionId: "optimize", params: (unit, targetUnit, pools) => ({ n: pools.ownPoolFor(unit).length }) }],
  },
  clockUp: {
    id: "clockUp",
    label: "クロックアップ",
    targetFaction: "self",
    monsterOnly: true,
    shortNotation: "P/最適化5s",
    steps: [{ actionId: "optimize", params: { n: 5 } }],
  },
  fortress: {
    id: "fortress",
    label: "要塞",
    targetFaction: "self",
    monsterOnly: true,
    shortNotation: "P/鼓舞3s",
    steps: [{ actionId: "inspire", params: { n: 3 } }],
  },
  // カルメヤ犬系統の上位個体用スキル。【興奮】(最適化(1)自身)の強さ違い。
  delight: {
    id: "delight",
    label: "幸喜",
    targetFaction: "self",
    monsterOnly: true,
    shortNotation: "P/最適化2s",
    steps: [{ actionId: "optimize", params: { n: 2 } }],
  },
  happiness: {
    id: "happiness",
    label: "幸福",
    targetFaction: "self",
    monsterOnly: true,
    shortNotation: "P/最適化3s",
    steps: [{ actionId: "optimize", params: { n: 3 } }],
  },
  // 【威嚇】/【凝視】：【邪魔】(牽制(1)相手陣営1体)の強さ違い。
  threaten: {
    id: "threaten",
    label: "威嚇",
    targetFaction: "opposing",
    monsterOnly: true,
    shortNotation: "P/牽制2",
    steps: [{ actionId: "restrain", params: { n: 2 } }],
  },
  glare: {
    id: "glare",
    label: "凝視",
    targetFaction: "opposing",
    monsterOnly: true,
    shortNotation: "P/牽制3",
    steps: [{ actionId: "restrain", params: { n: 3 } }],
  },
  // 【従順】：土台の葉アクション【警護】(guard)をそのまま1ステップ流用
  // （【体当たり】が【攻撃】を参照するのと同じ構造。隊員向けの名前付き
  // ラッパー【ついて来て！】(guardAlly)を経由せず、直接guardを参照する）。
  obedience: {
    id: "obedience",
    label: "従順",
    targetFaction: "ownExcludingSelf",
    monsterOnly: true,
    shortNotation: "P/警護",
    steps: [{ actionId: "guard" }],
  },
  // 【一途】：警護した後、（前ステップの対象と）同じ対象に鼓舞(1)を行う。
  devotion: {
    id: "devotion",
    label: "一途",
    targetFaction: "ownExcludingSelf",
    monsterOnly: true,
    shortNotation: "P/警護+",
    steps: [{ actionId: "guard" }, { actionId: "inspire" }],
  },
  // メレンゲ猫系統の上位個体用スキル。【優雅】(鼓舞(1)自身)の発展形：
  // 相手を威圧してから、その分以上に自身を鼓舞する（相手から奪い、
  // 自分に与える一貫したコンセプト）。
  nobility: {
    id: "nobility",
    label: "高雅",
    targetFaction: "opposing",
    monsterOnly: true,
    shortNotation: "P/威圧+",
    steps: [
      { actionId: "intimidate" },
      { actionId: "inspire", params: { n: 2 }, target: "self" },
    ],
  },
  serenity: {
    id: "serenity",
    label: "閑雅",
    targetFaction: "opposing",
    monsterOnly: true,
    shortNotation: "P/威圧2+",
    steps: [
      { actionId: "intimidate", params: { n: 2 } },
      { actionId: "inspire", params: { n: 3 }, target: "self" },
    ],
  },
  // チョコロック系統の上位個体用スキル。【邪魔】(牽制(1)相手陣営1体)の
  // 対象数を増やす方向の発展形。
  trafficJam: {
    id: "trafficJam",
    label: "渋滞",
    targetFaction: "opposing",
    monsterOnly: true,
    shortNotation: "P/牽制2",
    steps: [{ actionId: "restrain" }, { actionId: "restrain", target: "opposingExcludingUsed" }],
  },
  gridlock: {
    id: "gridlock",
    label: "大渋滞",
    targetFaction: "none",
    monsterOnly: true,
    shortNotation: "P/牽制*",
    steps: [{ actionId: "restrain", each: "opposing" }],
  },
  // ユキドケイ系統の上位個体用スキル。【クロックアップ】(最適化(5)自身)
  // の強さ違い。
  clockHack: {
    id: "clockHack",
    label: "クロックハック",
    targetFaction: "self",
    monsterOnly: true,
    shortNotation: "P/最適化99s",
    steps: [{ actionId: "optimize", params: { n: 99 } }],
  },
  // 飴アーミー系統の上位個体用スキル（飴コマンダー専用）。【団結】が
  // 自陣営の生存数に応じた最適化なのに対し、【軍歌】は自陣営全員を
  // 固定値(3)で最適化する。
  anthem: {
    id: "anthem",
    label: "軍歌",
    targetFaction: "none",
    monsterOnly: true,
    shortNotation: "P/最適化3*",
    steps: [{ actionId: "optimize", each: "own", params: { n: 3 } }],
  },
});

// キャラクタースキル・Prepフェイズ。allyOnly:trueでモンスターの行動
// 選択肢（randomEnemyActionのフォールバック含む）には出さない。所持
// スキル自体の制限はCHARACTER_SKILL_LOADOUTS/isModuleAvailableForが
// 別途行う。
Object.assign(PREP_MODULES, {
  // 【下がって！】：挑発をそのままラップしただけ。
  retreatCall: {
    id: "retreatCall",
    label: "下がって！",
    targetFaction: "opposing",
    allyOnly: true,
    shortNotation: "P/挑発",
    steps: [{ actionId: "provoke" }],
  },
  // 【お祭りのヨカン】：自身に鼓舞(1)、最適化(2)を順に行う。
  festivalHunch: {
    id: "festivalHunch",
    label: "お祭りのヨカン",
    targetFaction: "self",
    allyOnly: true,
    shortNotation: "P/鼓舞s+",
    steps: [{ actionId: "inspire", params: { n: 1 } }, { actionId: "optimize", params: { n: 2 } }],
  },
  // 【日陰者のセイギ】：隠密をそのままラップしただけ。
  shadowJustice: {
    id: "shadowJustice",
    label: "日陰者のセイギ",
    targetFaction: "self",
    allyOnly: true,
    shortNotation: "P/隠密s",
    steps: [{ actionId: "stealth" }],
  },
  // 【お姉ちゃん頑張れ〜】：自身以外の自陣営全員に鼓舞(1)。対象候補の
  // 選択自体が不要（targetFaction:"none"）で、each:"ownExcludingSelf"
  // が自身を除いた自陣営の生存者全員を順番に処理する。
  sisterCheer: {
    id: "sisterCheer",
    label: "お姉ちゃん頑張れ〜",
    targetFaction: "none",
    allyOnly: true,
    shortNotation: "P/鼓舞*",
    steps: [{ actionId: "inspire", each: "ownExcludingSelf", params: { n: 1 } }],
  },
  // 【チェック】：相手陣営1体を威圧(1)し、同じ相手ではなく自身を対象に
  // 鼓舞(1)を行う（陰陽と同じtarget:"self"override）。
  check: {
    id: "check",
    label: "チェック",
    targetFaction: "opposing",
    allyOnly: true,
    shortNotation: "P/威圧+",
    steps: [{ actionId: "intimidate", params: { n: 1 } }, { actionId: "inspire", target: "self", params: { n: 1 } }],
  },
  // 【ハイ・プロット】/【ロー・プロット】：どちらも自身にのみ作用する
  // （targetFaction:"self"のため、各stepのtargetは何も指定しなくても
  // 既にactor自身を指す）。鼓舞・威圧・最適化・牽制のapply()自体は
  // 対象の陣営を問わず機能するため、通常は相手陣営向けの威圧・牽制を
  // 自分自身に使う「IN⇔PTのトレードオフ」スキルとして成立する。
  highPlot: {
    id: "highPlot",
    label: "ハイ・プロット",
    targetFaction: "self",
    allyOnly: true,
    shortNotation: "P/最適化5s+",
    steps: [{ actionId: "optimize", params: { n: 5 } }, { actionId: "intimidate", params: { n: 2 } }],
  },
  lowPlot: {
    id: "lowPlot",
    label: "ロー・プロット",
    targetFaction: "self",
    allyOnly: true,
    shortNotation: "P/牽制5s+",
    steps: [{ actionId: "restrain", params: { n: 5 } }, { actionId: "inspire", params: { n: 2 } }],
  },
});

// 武器固有スキル・Prepフェイズ。CHARACTER_SKILL_LOADOUTSによる所持
// スキル制限とは別枠で、weaponOnly:trueがisModuleAvailableFor側の
// 「装備中の武器のWEAPON_TYPES[...].skillIdと一致するか」判定を通す
// （skillId自体はWEAPON_TYPES側に持たせる）。
Object.assign(PREP_MODULES, {
  // 【チアーズ】（シェイカー）：対象選択の必要なし（targetFaction:
  // "none"）、味方陣営全員に最適化(2)。既存の【静電気】と同型。
  cheers: {
    id: "cheers",
    label: "チアーズ",
    targetFaction: "none",
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "P/最適化2*",
    steps: [{ actionId: "optimize", each: "own", params: { n: 2 } }],
  },
  // 【ピクルス】（ビンヅメ）：自身以外の自陣営1体に鼓舞(3)、（前ステップ
  // の対象とは無関係に）自身に威圧(2)。構造は【チェック】と同型
  // （targetFactionが違う対を成す形）。
  pickles: {
    id: "pickles",
    label: "ピクルス",
    targetFaction: "ownExcludingSelf",
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "P/鼓舞3+",
    steps: [
      { actionId: "inspire", params: { n: 3 } },
      { actionId: "intimidate", target: "self", params: { n: 2 } },
    ],
  },
});

// 戦闘不能：HPが0以下になったユニット。行動できず、行動対象にも選べず、
// Main/Prepどちらの行動順からも除外される。
function isIncapacitated(unit) {
  return (unit.character.currentHp ?? computeEffectiveMaxHp(unit.character)) <= 0;
}

// 挑発/隠密の不発判定：自陣営で行動可能（戦闘不能になっていない）なのが
// 自分自身しかいない場合に真を返す共通ヘルパー。
function isSoleSurvivor(actor, allyUnits, enemyUnits) {
  const own = actor.faction === "ally" ? allyUnits : enemyUnits;
  return own.filter((u) => !isIncapacitated(u)).length <= 1;
}

// monsterOnly:true（モンスタースキル）は隊員側の行動選択肢
// （moduleSelectFor）には出さない -- 隊員がスキルを持つようになるのは
// 将来の対応で、それまでは体当たり/鳴き声のような明確にモンスター向け
// の技を人間の隊員が選べてしまうのを防ぐ。
// 属性攻撃(module.attribute持ち)は、行動主体のモンスター自身がその属性を
// 持っている時しか選べない（隊員はattributeを持たないので常に対象外）。
// 逆に、属性を持つモンスターは無属性の素の「攻撃」を選べない -- 属性を
// 持つ以上、その攻撃は必ず属性攻撃として現れる、という整理。
function isModuleAvailableFor(unit, module) {
  if (module.monsterOnly && unit.faction !== "enemy") return false;
  if (module.allyOnly && unit.faction !== "ally") return false;
  // 武器固有スキル：module.weaponOnly=trueのモジュールは、CHARACTER_
  // SKILL_LOADOUTSの所持スキル制限を経由せず（下の所持スキル制限は
  // weaponOnlyには適用しない -- 武器技はどのキャラクターの固定
  // ローダウト配列にも載らないので、経由させると誰も選べなくなって
  // しまう）、装備中の武器のWEAPON_TYPES[...].skillIdと一致する時
  // だけ選択可能になる（武器を外したり持ち替えたりすれば選べなくなる）。
  if (module.weaponOnly) {
    const weaponTypeId = unit.character.weapon?.baseTypeId;
    if (!weaponTypeId || WEAPON_TYPES[weaponTypeId]?.skillId !== module.id) return false;
  }
  // 前提技制限：module.requiresPriorActionIdsを持つモジュール（例：
  // 【サニーサイドアップ】：スマッシュまたはプロテクトの使用直後にのみ
  // 選択可）は、このMainフェイズ中に自分が直前に実行した技が内部で
  // 使った葉アクションのid一覧（unit.lastLeafActionIds）に、対象の
  // どれか1つでも含まれている時だけ選択可能。ハニービービートの
  // スマッシュや守りの手のプロテクトのような、複合スキルの中の1
  // ステップとしての使用もここに含まれる（module.id単体だけを見ると
  // 素のスマッシュ/プロテクトを直接選べるキャラクターがいないため、
  // 複合スキル経由の使用も拾えないと誰にとっても到達不能になる）。
  // 他の武器固有スキル（バウンス/ブレンドなど）が採る「選べるが不発」
  // 方式とは違い、これだけは選択肢自体を隠す（ユーザー指示：技の性質上
  // 「この順番で使う」ことが前提のため）。
  if (module.requiresPriorActionIds && !module.requiresPriorActionIds.some((id) => (unit.lastLeafActionIds ?? []).includes(id))) return false;
  // 所持スキル制限：CHARACTER_SKILL_LOADOUTSに定義があるキャラクター
  // は、そのリストに載っているモジュールしか選べない（weaponOnlyの
  // モジュールは上の武器チェックだけで判定済みなのでここは経由しない）。
  // 未定義のキャラクター（今回未実装分）は、従来通り全モジュールを
  // 自由選択できる（pickMonsterActionがMONSTER_SKILL_LOADOUTS未定義の
  // モンスターをrandomEnemyActionにフォールバックするのと同じ考え方）。
  if (unit.faction === "ally" && !module.weaponOnly) {
    const loadout = CHARACTER_SKILL_LOADOUTS[unit.character.dataId];
    if (loadout && !loadout.includes(module.id)) return false;
  }
  if (module.attribute) return unit.character.attribute === module.attribute;
  if (module.id === "attack" && unit.character.attribute) return false;
  return true;
}

// 補正なしの素の能力値（隊員本体のcomputeStatsの値そのまま）。強化魔法/
// 弱体化魔法自身の発動判定（X用ダイス数）だけはこちらを使う。
function rawStat(unit, key) {
  return computeStats(unit.character)[key];
}

// 実効能力値：unit.correctionsに補正がかかっていればそれを加味した値。
// 上記以外の全モジュール（攻撃/貫通攻撃/回復/プロテクト/スマッシュ/
// 継続回復/継続ダメージのダイス数）はこちらを使う。0未満にはしない
// （攻撃力だけは0だと成立しなくなってしまうため、最低値を1にする）。
function correctedStat(unit, key) {
  const c = unit.corrections[key];
  const floor = key === "attack" ? 1 : 0;
  return Math.max(floor, rawStat(unit, key) + (c ? c.sign * c.n : 0));
}

// 能力値補正の適用：同じ能力値に既存の補正があれば、強さ(n)を比較して
// n以上なら上書き、n未満なら不発（既存の補正はそのまま残る）。
function applyCorrection(target, statKey, n, sign, turns) {
  const existing = target.corrections[statKey];
  if (existing && n < existing.n) return { applied: false, statKey, n, sign, turns, existingN: existing.n };
  target.corrections[statKey] = { n, sign, turnsRemaining: turns };
  return { applied: true, statKey, n, sign, turns };
}

// 継続回復/継続ダメージの適用：対象のHP継続効果は共有の単一枠なので、
// 既存の効果（回復/ダメージ問わず）と強さ(n)を比較して同じルールで
// 上書きするか不発にする。
function applyContinuousStatus(target, n, type, turns) {
  const existing = target.continuousHp;
  if (existing && n < existing.n) return { applied: false, n, type, turns, existingN: existing.n };
  target.continuousHp = { n, type, turnsRemaining: turns };
  return { applied: true, n, type, turns };
}

const CONTINUOUS_EFFECT_LABELS = { heal: "継続回復", damage: "継続ダメージ", ratioDamage: "継続割合ダメージ" };
function continuousEffectLabel(type) {
  return CONTINUOUS_EFFECT_LABELS[type];
}

// 能力値補正（強化魔法/弱体化魔法）を対象ステータスごとに生成する
// ファクトリ。バフ/デバフの整理（属性ごとに対応する能力値が決まって
// いる）に合わせて、5能力値×上昇/低下の計10種を用意する -- 将来の
// スキル合成（属性攻撃など）は、この中から対応するモジュールを部品
// として呼び出す想定。n（補正の強さ）は引数化してあるが、現状はまだ
// スキル側が無くプレイヤーが直接選ぶ単体モジュールとして並んでいる
// ため、既定値の1で固定して使う。judgeStatKey：継続ターン数(X)を出す
// ダイスに使う、行動主体側の能力値の既定（強化魔法は使い手の協調性、
// 弱体化魔法は使い手の賢さ）。params.aStatでスキル側が上書きできる
// （例：ロリポップ・スパイラルの【完璧なサポート】は弱体化魔法の判定を
// 協調性で行う）。
function createCorrectionModule(id, label, statKey, sign, judgeStatKey, shortNotation) {
  return {
    id,
    label,
    targetFaction: sign > 0 ? "own" : "opposing",
    effect: "correction",
    shortNotation,
    apply: (actor, target, params = {}) => {
      const { n = 1, aStat } = params;
      const { successCount } = rollJudgement(rawStat(actor, aStat ?? judgeStatKey));
      const turns = successCountToR(successCount);
      return applyCorrection(target, statKey, n, sign, turns);
    },
  };
}

const CORRECTION_MODULE_DEFS = [
  { statKey: "attack", statLabel: "攻撃力", shortStat: "攻", enhanceId: "enhanceAttack", weakenId: "weakenAttack" },
  { statKey: "defense", statLabel: "防御力", shortStat: "防", enhanceId: "enhanceDefense", weakenId: "weakenDefense" },
  { statKey: "destruction", statLabel: "破壊力", shortStat: "破", enhanceId: "enhanceDestruction", weakenId: "weakenDestruction" },
  { statKey: "wisdom", statLabel: "賢さ", shortStat: "賢", enhanceId: "enhanceWisdom", weakenId: "weakenWisdom" },
  { statKey: "coordination", statLabel: "協調性", shortStat: "協", enhanceId: "enhanceCoordination", weakenId: "weakenCoordination" },
];

const CORRECTION_MODULES = {};
for (const { statKey, statLabel, shortStat, enhanceId, weakenId } of CORRECTION_MODULE_DEFS) {
  CORRECTION_MODULES[enhanceId] = createCorrectionModule(enhanceId, `強化魔法(${statLabel})`, statKey, 1, "coordination", `M/強化(${shortStat})`);
  CORRECTION_MODULES[weakenId] = createCorrectionModule(weakenId, `弱体化魔法(${statLabel})`, statKey, -1, "wisdom", `M/弱体化(${shortStat})`);
}

// 属性攻撃が付与する状態異常（強さ・発動確率）：モンスターのレベルに
// 応じて決まる（プレイヤーが直接選ぶ強化魔法/弱体化魔法とは別枠 -- あちら
// はn=1固定・発動確率100%のプレイヤー操作、こちらはモンスターのレベル
// 依存で毎回変わる）。強さ=レベル÷10切り上げ、発動確率=レベル×3%
// （上限100%）。
function attributeDebuffN(actor) {
  return Math.ceil(actor.character.level / 10);
}
function attributeProcChance(actor) {
  return Math.min(1, actor.character.level * 0.03);
}

// 5能力値の属性攻撃デバフ（浸水～高温）：弱体化魔法と同じ仕組み
// （applyCorrection、判定にはactorの賢さ）を使うが、強さ(n)は固定1では
// なくattributeDebuffNから取る専用の葉モジュール。MAIN_MODULESには
// 登録しない（プレイヤーが直接選べる項目ではなく、属性攻撃スキルの
// 内部でだけ使うため）。
const ATTRIBUTE_STAT_KEYS = { soak: "attack", humidity: "defense", cold: "destruction", dry: "wisdom", heat: "coordination" };
function createAttributeStatDebuff(statKey) {
  return {
    effect: "correction",
    apply: (actor, target) => {
      const { successCount } = rollJudgement(rawStat(actor, "wisdom"));
      const turns = successCountToR(successCount);
      return applyCorrection(target, statKey, attributeDebuffN(actor), -1, turns);
    },
  };
}

// 時間(継続ダメージ)/腐敗(継続割合ダメージ)の属性攻撃デバフ。既存の
// dot/continuousRatioDamageと同じ判定基準（actorの賢さの実効値）を
// 使うが、強さ(n)はやはりattributeDebuffN。
function createAttributeContinuousDebuff(type) {
  return {
    effect: "continuous",
    apply: (actor, target) => {
      const { successCount } = rollJudgement(correctedStat(actor, "wisdom"));
      const turns = successCountToR(successCount);
      return applyContinuousStatus(target, attributeDebuffN(actor), type, turns);
    },
  };
}

const ATTRIBUTE_DEBUFF_MODULES = {
  soak: createAttributeStatDebuff(ATTRIBUTE_STAT_KEYS.soak),
  humidity: createAttributeStatDebuff(ATTRIBUTE_STAT_KEYS.humidity),
  cold: createAttributeStatDebuff(ATTRIBUTE_STAT_KEYS.cold),
  dry: createAttributeStatDebuff(ATTRIBUTE_STAT_KEYS.dry),
  heat: createAttributeStatDebuff(ATTRIBUTE_STAT_KEYS.heat),
  time: createAttributeContinuousDebuff("damage"),
  decay: createAttributeContinuousDebuff("ratioDamage"),
};

// 汚染だけは対応する単一のデバフを持たず、時間の継続ダメージと浸水～
// 高温の弱体化の計6種類（腐敗は含まない）からランダムに重複なく2つを
// 選んで両方付与する。
const CONTAMINATION_DEBUFF_KEYS = ["time", "soak", "humidity", "cold", "dry", "heat"];

// Mainフェイズの行動。攻撃/貫通攻撃/回復（HP増減）、プロテクト/スマッシュ
// （体幹増減）、強化魔法/弱体化魔法（能力値補正、5能力値ぶん）、継続回復/
// 継続ダメージ/継続割合ダメージ（HP継続増減）の16種類。モジュール本来は
// PTを消費しない（消費するのは将来の「スキル」側）ので、ここでも一切PT
// を扱わない。
// effect: "hp"のものはapply()が{magnitude, label}を返しHPログに使う。
// effect: "stamina"のものはapply()が対象の体幹を直接増減するだけで、
// ログ表示はresolveMainAction側でunit.staminaのbefore/afterを見る
// （PrepフェイズのIN/PTログと同じ組み立て）。
// effect: "correction"/"continuous"のものはapply()が
// {applied, ...}（不発ならapplied:false）を返す。
const MAIN_MODULES = {
  attack: {
    id: "attack",
    label: "攻撃",
    targetFaction: "opposing",
    effect: "hp",
    shortNotation: "M/攻撃",
    // params.aStat/dStat：能動/受動能力値の上書き（既定attack/defense）。
    // スキル側がstep.paramsで指定する（例：ティックの能動:賢さ、
    // 受動:賢さ）。
    apply: (actor, target, params = {}) => {
      const a = rollSum(correctedStat(actor, params.aStat ?? "attack"));
      const d = rollSum(correctedStat(target, params.dStat ?? "defense"));
      const c = Math.pow(state.battleTuning.staminaCorrectionMultiplier, -1 * target.stamina);
      const damage = Math.ceil(((a * a) / (a + d)) * c);
      applyHpDamage(target.character, damage);
      return { magnitude: damage, label: "ダメージ" };
    },
  },
  pierceAttack: {
    id: "pierceAttack",
    label: "貫通攻撃",
    targetFaction: "opposing",
    effect: "hp",
    shortNotation: "M/貫通攻撃",
    // params.aStat：能動能力値の上書き（既定attack）。attackと同じ考え方。
    apply: (actor, target, params = {}) => {
      const a = rollSum(correctedStat(actor, params.aStat ?? "attack"));
      const c = Math.pow(state.battleTuning.staminaCorrectionMultiplier, -1 * target.stamina);
      const damage = Math.ceil(a * c);
      applyHpDamage(target.character, damage);
      return { magnitude: damage, label: "ダメージ" };
    },
  },
  heal: {
    id: "heal",
    label: "回復",
    targetFaction: "own",
    effect: "hp",
    shortNotation: "M/回復",
    // params.aStat：判定に使う能動能力値の上書き（既定coordination）。
    // params.b：回復力への加算（既定0、負値も可）。【処方箋】のような
    // 「回復力そのものを動的に増減させる」スキルのための拡張 -- 合計は
    // 最低1に切り上げる（successCountToR自体も最低1だが、bがマイナスの
    // 時はそれだけでは足りないため改めて保証する）。
    apply: (actor, target, params = {}) => {
      const { successCount } = rollJudgement(correctedStat(actor, params.aStat ?? "coordination"));
      const healPower = Math.max(1, successCountToR(successCount) + (params.b ?? 0));
      const healAmount = rollSum(healPower);
      applyHpHeal(target.character, healAmount);
      return { magnitude: healAmount, label: "回復" };
    },
  },
  protect: {
    id: "protect",
    label: "プロテクト",
    targetFaction: "own",
    effect: "stamina",
    shortNotation: "M/プロテクト",
    // params.aStat：能動能力値の上書き（既定defense）。戻り値の
    // magnitudeは体幹の増加量（成功度合いそのもの）-- 【エコロジー】の
    // ような「直前のステップの結果を次のステップのparamsが参照する」
    // 構成のために持たせる（このapply自体は自分の戻り値を使わない）。
    apply: (actor, target, params = {}) => {
      const { successCount } = rollJudgement(correctedStat(actor, params.aStat ?? "defense"));
      const x = successCountToR(successCount);
      target.stamina = clampStamina(target.stamina + x);
      return { magnitude: x, label: "体幹上昇" };
    },
  },
  smash: {
    id: "smash",
    label: "スマッシュ",
    targetFaction: "opposing",
    effect: "stamina",
    shortNotation: "M/スマッシュ",
    // params.aStat：能動能力値の上書き（既定destruction）。戻り値の
    // magnitudeは体幹の減少量（プロテクトと同じ理由で持たせる）。
    apply: (actor, target, params = {}) => {
      const { successCount } = rollJudgement(correctedStat(actor, params.aStat ?? "destruction"));
      const x = successCountToR(successCount);
      target.stamina = clampStamina(target.stamina - x);
      return { magnitude: x, label: "体幹低下" };
    },
  },
  ...CORRECTION_MODULES,
  regen: {
    id: "regen",
    label: "継続回復",
    targetFaction: "own",
    effect: "continuous",
    shortNotation: "M/継続回復",
    // params.aStat：継続ターン数の判定に使う能動能力値の上書き（既定
    // coordination）。
    apply: (actor, target, params = {}) => {
      const { n = 1, aStat } = params;
      const { successCount } = rollJudgement(correctedStat(actor, aStat ?? "coordination"));
      const turns = successCountToR(successCount);
      return applyContinuousStatus(target, n, "heal", turns);
    },
  },
  revive: {
    id: "revive",
    label: "蘇生",
    targetFaction: "ownIncapacitated",
    effect: "revive",
    shortNotation: "M/蘇生",
    apply: (actor, target) => {
      if (actor.faction === "enemy") return { applied: false };
      const healedHp = Math.min(computeEffectiveMaxHp(target.character), correctedStat(actor, "coordination") * 2);
      target.character.currentHp = healedHp;
      return { applied: true, healedHp };
    },
  },
  dot: {
    id: "dot",
    label: "継続ダメージ",
    targetFaction: "opposing",
    effect: "continuous",
    shortNotation: "M/継続ダメ",
    // params.aStat：継続ターン数の判定に使う能動能力値の上書き（既定
    // wisdom）。
    apply: (actor, target, params = {}) => {
      const { n = 1, aStat } = params;
      const { successCount } = rollJudgement(correctedStat(actor, aStat ?? "wisdom"));
      const turns = successCountToR(successCount);
      return applyContinuousStatus(target, n, "damage", turns);
    },
  },
  // 腐敗属性のデバフの土台：継続ダメージが「nD6合計÷2切り上げ」の
  // 固定量を毎Mainフェイズ終了時に削るのに対し、こちらは「変調減少後
  // 最大HP×n÷10（切り上げ）」という割合ベースで削る（applyContinuousHpTicks
  // 側でtype==="ratioDamage"のみ計算式を分けている）。continuousHpの
  // 単一共有枠を、継続回復/継続ダメージと同じn基準の上書きルールで
  // 奪い合う（applyContinuousStatusはtypeを問わず同じ比較をする）。
  continuousRatioDamage: {
    id: "continuousRatioDamage",
    label: "継続割合ダメージ",
    targetFaction: "opposing",
    effect: "continuous",
    shortNotation: "M/継続割合ダメ",
    // params.aStat：継続ターン数の判定に使う能動能力値の上書き（既定
    // wisdom）。dot/regenと同じ形に揃える。
    apply: (actor, target, params = {}) => {
      const { n = 1, aStat } = params;
      const { successCount } = rollJudgement(correctedStat(actor, aStat ?? "wisdom"));
      const turns = successCountToR(successCount);
      return applyContinuousStatus(target, n, "ratioDamage", turns);
    },
  },
};

// 複合スキル：leafモジュール（apply()を持つ）や他のスキルのidをsteps
// に並べて、同じ1体の行動対象へ順番に適用する。「スキルは他のスキル
// のモジュールになることがある」という整理の通り、この登録先はleaf
// モジュールと同じMAIN_MODULES辞書 -- steps側からはidで参照するだけな
// ので、複合スキルが他の複合スキルをネストしても構わない（runSteps参
// 照）。costはPTで支払う（葉モジュール自体はPTを一切消費しない、とい
// う既存の設計はそのまま）。行動対象候補は、このスキル自身の
// targetFaction一本で決まる -- 内部のsteps側では対象を選び直さない
// （【鉄槌】の説明にある「初動モジュールの行動対象候補がそのままスキル
// の行動対象候補になる」を、初動と同じtargetFactionをスキル自身に
// 持たせることで表現している）。
// 【鉄槌】：3コスト、スマッシュ。スマッシュした後、同じ行動対象に攻撃
// を行う -- モジュール合成エンジンの動作確認用の最小例。
Object.assign(MAIN_MODULES, {
  ironHammer: {
    id: "ironHammer",
    label: "鉄槌(PT3)",
    targetFaction: "opposing",
    cost: 3,
    shortNotation: "M/3/スマッシュ+",
    steps: [{ actionId: "smash" }, { actionId: "attack" }],
  },
  // モンスタースキル・Mainフェイズ。monsterOnly:trueでプレイヤーの行動
  // 選択肢には出さない。属性を持つモンスターがこれらを使う場合、内部の
  // 「攻撃」ステップは自動的に属性攻撃へ置き換わる（貫通攻撃は対象外 --
  // runSteps内のapplyLeafWithAttributeSwap参照）。
  tackle: {
    id: "tackle",
    label: "体当たり",
    targetFaction: "opposing",
    cost: 2,
    monsterOnly: true,
    shortNotation: "M/2/攻撃",
    steps: [{ actionId: "attack" }],
  },
  cry: {
    id: "cry",
    label: "鳴き声",
    targetFaction: "opposing",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/弱体化(攻)",
    steps: [{ actionId: "weakenAttack" }],
  },
  harden: {
    id: "harden",
    label: "固める",
    targetFaction: "self",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/強化(防)s",
    steps: [{ actionId: "enhanceDefense" }],
  },
  scratch: {
    id: "scratch",
    label: "引っ掻き",
    targetFaction: "opposing",
    cost: 2,
    monsterOnly: true,
    shortNotation: "M/2/貫通攻撃",
    steps: [{ actionId: "pierceAttack" }],
  },
  electrocute: {
    id: "electrocute",
    label: "感電",
    targetFaction: "opposing",
    cost: 3,
    monsterOnly: true,
    shortNotation: "M/3/攻撃+",
    steps: [{ actionId: "attack" }, { actionId: "smash" }, { actionId: "weakenDestruction", params: { n: 2 } }],
  },
  discharge: {
    id: "discharge",
    label: "放電",
    targetFaction: "opposing",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/弱体化(破)",
    steps: [{ actionId: "weakenDestruction" }],
  },
  // 【甘い果実】：healTarget:trueが、CPU側の対象選択で「候補からランダム
  // に1体」ではなく「自陣営の残りHPが最も少ない1体」を選ばせる（同値は
  // ランダム）。単体回復系のモンスタースキルに共通のルールとして、この
  // フラグを立てる方針にした -- pickMonsterSkillTarget参照。
  sweetFruit: {
    id: "sweetFruit",
    label: "甘い果実",
    targetFaction: "own",
    cost: 2,
    monsterOnly: true,
    healTarget: true,
    shortNotation: "M/2/継続回復2",
    steps: [{ actionId: "regen", params: { n: 2 } }],
  },
  sourFruit: {
    id: "sourFruit",
    label: "酸っぱい果実",
    targetFaction: "opposing",
    cost: 2,
    monsterOnly: true,
    shortNotation: "M/2/継続ダメ2",
    steps: [{ actionId: "dot", params: { n: 2 } }],
  },
  tick: {
    id: "tick",
    label: "ティック",
    targetFaction: "opposing",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/攻撃/賢",
    steps: [{ actionId: "attack", params: { aStat: "wisdom", dStat: "wisdom" } }],
  },
  charge: {
    id: "charge",
    label: "突撃",
    targetFaction: "opposing",
    cost: 2,
    monsterOnly: true,
    shortNotation: "M/2/スマッシュ+",
    steps: [{ actionId: "smash" }, { actionId: "attack" }],
  },
  guard: {
    id: "guard",
    label: "防衛",
    targetFaction: "self",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/プロテクトs",
    steps: [{ actionId: "protect" }],
  },
  thaw: {
    id: "thaw",
    label: "雪解け",
    targetFaction: "none",
    cost: 3,
    monsterOnly: true,
    shortNotation: "M/3/特殊*",
    steps: [{ actionId: "smash", each: "opposing" }],
  },
  slam: {
    id: "slam",
    label: "スラム",
    targetFaction: "opposing",
    cost: 3,
    monsterOnly: true,
    shortNotation: "M/3/攻撃+",
    steps: [{ actionId: "attack" }, { actionId: "smash" }],
  },
  // 【ラッシュ】：選択した1体に攻撃した後、（1回目とは別の）もう1体の
  // 相手陣営ユニットにランダムに攻撃する -- 構造は既存の漁火と同一。
  rush: {
    id: "rush",
    label: "ラッシュ",
    targetFaction: "opposing",
    cost: 3,
    monsterOnly: true,
    shortNotation: "M/3/攻撃2",
    steps: [{ actionId: "attack" }, { actionId: "attack", target: "opposingExcludingUsed" }],
  },
  // カルメヤ犬系統の上位個体用スキル。
  // 【八つ当たり】：選択した1体に攻撃を2回連続で行う（同一対象）。
  tantrum: {
    id: "tantrum",
    label: "八つ当たり",
    targetFaction: "opposing",
    cost: 2,
    monsterOnly: true,
    shortNotation: "M/2/攻撃2",
    steps: [{ actionId: "attack" }, { actionId: "attack" }],
  },
  // 【見回り】：ラッシュと同じ構造（別対象へ2連続攻撃）だがコスト2。
  patrol: {
    id: "patrol",
    label: "見回り",
    targetFaction: "opposing",
    cost: 2,
    monsterOnly: true,
    shortNotation: "M/2/攻撃+",
    steps: [{ actionId: "attack" }, { actionId: "attack", target: "opposingExcludingUsed" }],
  },
  // 【大回り】：見回りをさらに1体分延長し、計3体に順番に攻撃する。
  grandPatrol: {
    id: "grandPatrol",
    label: "大回り",
    targetFaction: "opposing",
    cost: 2,
    monsterOnly: true,
    shortNotation: "M/2/攻撃3",
    steps: [
      { actionId: "attack" },
      { actionId: "attack", target: "opposingExcludingUsed" },
      { actionId: "attack", target: "opposingExcludingUsed" },
    ],
  },
  // 【泣き声】：【鳴き声】(弱体化魔法(攻撃力)(1))の強さ違い。
  whimper: {
    id: "whimper",
    label: "泣き声",
    targetFaction: "opposing",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/弱体化(攻)2",
    steps: [{ actionId: "weakenAttack", params: { n: 2 } }],
  },
  // 【懐き声】：相手陣営1体に弱体化魔法(防御力)(2)をかける。
  fawn: {
    id: "fawn",
    label: "懐き声",
    targetFaction: "opposing",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/弱体化(防)2",
    steps: [{ actionId: "weakenDefense", params: { n: 2 } }],
  },
  // 【遠吠え】：自陣営1体に強化魔法(攻撃力)(2)をかける。
  howl: {
    id: "howl",
    label: "遠吠え",
    targetFaction: "own",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/強化(攻)2",
    steps: [{ actionId: "enhanceAttack", params: { n: 2 } }],
  },
  // メレンゲ猫系統の上位個体用スキル。相手から奪い、自分に与える一貫
  // したコンセプト。
  // 【引き裂き】：引っ掻き(貫通攻撃)をもう1体、別対象へ追加する。
  tear: {
    id: "tear",
    label: "引き裂き",
    targetFaction: "opposing",
    cost: 2,
    monsterOnly: true,
    shortNotation: "M/2/貫通攻撃2",
    steps: [{ actionId: "pierceAttack" }, { actionId: "pierceAttack", target: "opposingExcludingUsed" }],
  },
  // 【歌い声】/【招き声】：弱体化魔法(攻撃力)をかけた後、自身に強化
  // 魔法(攻撃力)をかける。
  serenade: {
    id: "serenade",
    label: "歌い声",
    targetFaction: "opposing",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/弱体化(攻)2+",
    steps: [
      { actionId: "weakenAttack", params: { n: 2 } },
      { actionId: "enhanceAttack", params: { n: 1 }, target: "self" },
    ],
  },
  allure: {
    id: "allure",
    label: "招き声",
    targetFaction: "opposing",
    cost: 2,
    monsterOnly: true,
    shortNotation: "M/2/弱体化(攻)3+",
    steps: [
      { actionId: "weakenAttack", params: { n: 3 } },
      { actionId: "enhanceAttack", params: { n: 2 }, target: "self" },
    ],
  },
  // 【爪研ぎ】：素のスマッシュをコスト1で使う。
  sharpenClaws: {
    id: "sharpenClaws",
    label: "爪研ぎ",
    targetFaction: "opposing",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/スマッシュ",
    steps: [{ actionId: "smash" }],
  },
  // 体幹を判定無しで固定量だけ増減させる土台の葉アクション（スマッシュ/
  // プロテクトの判定ベースの増減とは別枠 -- 【崇高】のような「n分だけ
  // 確実に増減させる」効果のための専用プリミティブ）。
  staminaShift: {
    id: "staminaShift",
    label: "体幹操作",
    targetFaction: "opposing",
    effect: "stamina",
    monsterOnly: true,
    shortNotation: "M/体幹操作",
    apply: (actor, target, params = {}) => {
      const { n = 0 } = params;
      target.stamina = clampStamina(target.stamina + n);
      return { magnitude: n, label: n >= 0 ? "体幹上昇" : "体幹低下" };
    },
  },
  // 【崇高】：相手の体幹を2減少させ、その後自身の体幹を2増加させる
  // （体幹操作を使った固定値、判定なし）。
  transcendence: {
    id: "transcendence",
    label: "崇高",
    targetFaction: "opposing",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/体幹操作+",
    steps: [
      { actionId: "staminaShift", params: { n: -2 } },
      { actionId: "staminaShift", params: { n: 2 }, target: "self" },
    ],
  },
  // チョコロック系統の上位個体用スキル。回数・対象数を増やす方向の発展形。
  collision: {
    id: "collision",
    label: "衝突",
    targetFaction: "opposing",
    cost: 2,
    monsterOnly: true,
    shortNotation: "M/2/攻撃+",
    steps: [{ actionId: "attack" }, { actionId: "smash" }],
  },
  headOnCollision: {
    id: "headOnCollision",
    label: "正面衝突",
    targetFaction: "opposing",
    cost: 2,
    monsterOnly: true,
    shortNotation: "M/2/攻撃++",
    steps: [{ actionId: "attack" }, { actionId: "smash" }, { actionId: "smash" }],
  },
  fortify: {
    id: "fortify",
    label: "固め上げる",
    targetFaction: "ownExcludingSelf",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/強化(防)2+",
    steps: [
      { actionId: "enhanceDefense", params: { n: 2 } },
      { actionId: "enhanceDefense", params: { n: 2 }, target: "self" },
    ],
  },
  fortifyAll: {
    id: "fortifyAll",
    label: "固め連ねる",
    targetFaction: "none",
    cost: 2,
    monsterOnly: true,
    shortNotation: "M/2/強化(防)3*",
    steps: [{ actionId: "enhanceDefense", params: { n: 3 }, each: "own" }],
  },
  // ユキドケイ系統の上位個体用スキル。
  avalanche: {
    id: "avalanche",
    label: "雪崩",
    targetFaction: "none",
    cost: 2,
    monsterOnly: true,
    shortNotation: "M/2/スマッシュ*",
    steps: [{ actionId: "smash", each: "opposing" }],
  },
  // 【カウントダウン】/【カウントアップ】：アラート(タイマー)と同じ
  // 「現在のターン数」を参照する仕組み（resolveStepParamsが渡す
  // pools.turn）。戦闘が長引くほど強くなる。
  countdown: {
    id: "countdown",
    label: "カウントダウン",
    targetFaction: "none",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/継続ダメ?*",
    steps: [{ actionId: "dot", each: "opposing", params: (unit, targetUnit, pools) => ({ n: Math.ceil(pools.turn / 2) }) }],
  },
  countUp: {
    id: "countUp",
    label: "カウントアップ",
    targetFaction: "none",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/継続回復?*",
    steps: [{ actionId: "regen", each: "own", params: (unit, targetUnit, pools) => ({ n: Math.ceil(pools.turn / 3) }) }],
  },
  // 飴アーミー系統の上位個体用スキル。それぞれの兵科が担う仕事を1つだけ
  // 持つ、という一貫したコンセプト。
  // 【闘技】：突撃(スマッシュ+攻撃)を1体に行った後、（別の）もう1体にも
  // 突撃を行う -- 突撃自身をnested reference（体当たりが攻撃を参照する
  // のと同じ構造）として2回使うことで実現している。突撃自身のcostは
  // ここでは参照されない（コスト消費は最上位のresolveMainAction側が
  // このモジュール自身のcostだけを見て行うため）。
  combatArts: {
    id: "combatArts",
    label: "闘技",
    targetFaction: "opposing",
    cost: 3,
    monsterOnly: true,
    shortNotation: "M/3/攻撃+2",
    steps: [{ actionId: "charge" }, { actionId: "charge", target: "opposingExcludingUsed" }],
  },
  // 【呪詛】：相手陣営1体に弱体化魔法(賢さ)(3)、弱体化魔法(協調性)(3)を
  // 順にかける（同一対象）。
  curse: {
    id: "curse",
    label: "呪詛",
    targetFaction: "opposing",
    cost: 3,
    monsterOnly: true,
    shortNotation: "M/3/弱体化(賢)3+",
    steps: [
      { actionId: "weakenWisdom", params: { n: 3 } },
      { actionId: "weakenCoordination", params: { n: 3 } },
    ],
  },
  // 【当身】：素のスマッシュをコスト1で使う。
  counterStrike: {
    id: "counterStrike",
    label: "当身",
    targetFaction: "opposing",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/スマッシュ",
    steps: [{ actionId: "smash" }],
  },
  // 【護身】：自身以外の自陣営1体にプロテクトをかけた後、自身にも
  // プロテクトをかける。
  selfDefense: {
    id: "selfDefense",
    label: "護身",
    targetFaction: "ownExcludingSelf",
    cost: 2,
    monsterOnly: true,
    shortNotation: "M/2/プロテクト+",
    steps: [{ actionId: "protect" }, { actionId: "protect", target: "self" }],
  },
  // 【修復】：残りHPが最も少ない自陣営1体（healTarget、甘い果実と同じ
  // 選び方）に回復を2回行う。
  repair: {
    id: "repair",
    label: "修復",
    targetFaction: "own",
    cost: 2,
    monsterOnly: true,
    healTarget: true,
    shortNotation: "M/2/回復2",
    steps: [{ actionId: "heal" }, { actionId: "heal" }],
  },
  // 【補給】：自陣営全員に継続回復(3)を付与する。
  supply: {
    id: "supply",
    label: "補給",
    targetFaction: "none",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/継続回復3*",
    steps: [{ actionId: "regen", each: "own", params: { n: 3 } }],
  },
  // 【司令】：自身以外の自陣営1体を選び、その対象自身の素の能力値の
  // うち最も高いもの(同値なら重複なくランダムに1つ)へ強化魔法(5)を
  // かける。対象依存で動的に能力値を選ぶ必要があるため、enhance系
  // モジュール（能力値をモジュール生成時に固定している）は流用できず、
  // 専用の葉アクションとして持つ。
  command: {
    id: "command",
    label: "司令",
    targetFaction: "ownExcludingSelf",
    effect: "correction",
    cost: 3,
    monsterOnly: true,
    shortNotation: "M/3/特殊",
    apply: (actor, target, params = {}) => {
      const { n = 5 } = params;
      const statKeys = ["attack", "defense", "destruction", "wisdom", "coordination"];
      const values = statKeys.map((key) => rawStat(target, key));
      const max = Math.max(...values);
      const tied = statKeys.filter((key, i) => values[i] === max);
      const statKey = pickRandom(tied);
      const { successCount } = rollJudgement(rawStat(actor, "coordination"));
      const turns = successCountToR(successCount);
      return applyCorrection(target, statKey, n, 1, turns);
    },
  },
});

// キャラクタースキル・Mainフェイズ。allyOnly:trueでモンスターの行動
// 選択肢には出さない。即席攻撃はこのスキル自身が唯一のleafモジュール
// （攻撃力を能動能力値ではなく固定2D6で計算する専用の攻撃）で、他の
// スキルのように既存モジュールをstepsでラップしていない。
Object.assign(MAIN_MODULES, {
  // 【即席攻撃】：能動能力値の代わりに固定2D6（=能動能力値2相当）で
  // ダメージを計算する攻撃。フレーク・シュガー/ロリポップ・スパイラル
  // /サンライト・サッカルムが共有する。
  quickAttack: {
    id: "quickAttack",
    label: "即席攻撃",
    targetFaction: "opposing",
    effect: "hp",
    cost: 1,
    allyOnly: true,
    shortNotation: "M/1/即席攻撃",
    apply: (actor, target, params = {}) => {
      const a = rollSum(2);
      const d = rollSum(correctedStat(target, params.dStat ?? "defense"));
      const c = Math.pow(state.battleTuning.staminaCorrectionMultiplier, -1 * target.stamina);
      const damage = Math.ceil(((a * a) / (a + d)) * c);
      applyHpDamage(target.character, damage);
      return { magnitude: damage, label: "ダメージ" };
    },
  },
  // 【応急手当】：継続回復をそのままラップしただけ。
  firstAid: {
    id: "firstAid",
    label: "応急手当",
    targetFaction: "own",
    cost: 1,
    allyOnly: true,
    shortNotation: "M/1/継続回復",
    steps: [{ actionId: "regen", params: { n: 1 } }],
  },
  // 【守りの手】：自身にプロテクト、強化魔法(防御力)(2)を順に行う。
  guardingHand: {
    id: "guardingHand",
    label: "守りの手",
    targetFaction: "self",
    cost: 2,
    allyOnly: true,
    shortNotation: "M/2/プロテクトs+",
    steps: [{ actionId: "protect" }, { actionId: "enhanceDefense", params: { n: 2 } }],
  },
  // 【攻めの手】：攻撃した後、対象が「釘付け」状態（target.pinnedByが
  // 立っている）なら追加で貫通攻撃を行う。固定のchance確率ではなく、
  // (unit,targetUnit)=>numberの関数chanceを使うことで、既存のchance
  // 機構をそのまま「条件付き発動」として流用している。
  attackingHand: {
    id: "attackingHand",
    label: "攻めの手",
    targetFaction: "opposing",
    cost: 2,
    allyOnly: true,
    shortNotation: "M/2/攻撃+",
    steps: [
      { actionId: "attack" },
      { actionId: "pierceAttack", chance: (unit, targetUnit) => (targetUnit.pinnedBy ? 1 : 0) },
    ],
  },
  // 【ハニービービート】：相手陣営1体にスマッシュ、スマッシュ、攻撃を
  // 順に行う。
  honeyBeeBeat: {
    id: "honeyBeeBeat",
    label: "ハニービービート",
    targetFaction: "opposing",
    cost: 3,
    allyOnly: true,
    shortNotation: "M/3/スマッシュ2+",
    steps: [{ actionId: "smash" }, { actionId: "smash" }, { actionId: "attack" }],
  },
  // 【ビターフィール】：相手陣営1体に継続ダメージ(5)を付与した後、
  // （前ステップの対象とは無関係に）自身に継続ダメージ(2)を付与する。
  bitterFeel: {
    id: "bitterFeel",
    label: "ビターフィール",
    targetFaction: "opposing",
    cost: 2,
    allyOnly: true,
    shortNotation: "M/2/継続ダメ5+",
    steps: [{ actionId: "dot", params: { n: 5 } }, { actionId: "dot", target: "self", params: { n: 2 } }],
  },
  // 【完璧なサポート】：相手陣営1体に弱体化魔法(攻撃力)(3)、
  // 弱体化魔法(防御力)(3)を順に行う。判定に使う能動能力値は（弱体化
  // 魔法の既定である賢さではなく）協調性に上書きする -- ロリポップ・
  // スパイラルの課題（協調性の成長が彼女の技のどれからも参照されて
  // いなかった）への回答として、Stage0のcreateCorrectionModule.
  // params.aStat拡張をそのまま使う。
  perfectSupport: {
    id: "perfectSupport",
    label: "完璧なサポート",
    targetFaction: "opposing",
    cost: 3,
    allyOnly: true,
    shortNotation: "M/3/弱体化(攻防)3/協",
    steps: [
      { actionId: "weakenAttack", params: { n: 3, aStat: "coordination" } },
      { actionId: "weakenDefense", params: { n: 3, aStat: "coordination" } },
    ],
  },
  // 【フラッシュ】：相手陣営全員に攻撃した後、自身にも攻撃を行う（反動
  // ダメージ）。targetFaction:"none"のため対象候補の選択自体が不要 --
  // 最初のstepのeach:"opposing"が相手陣営全員を、2番目のstepは（何も
  // 指定しなくても既にactor自身を指す既定のtargetUnitのまま）自身を
  // 対象にする。
  flash: {
    id: "flash",
    label: "フラッシュ",
    targetFaction: "none",
    cost: 4,
    allyOnly: true,
    shortNotation: "M/4/攻撃*",
    steps: [{ actionId: "attack", each: "opposing" }, { actionId: "attack" }],
  },
  // 【処方箋】：残りPTを全額消費する代わりに、回復力へ「消費したPT-3」
  // を加算する（最低1）。cost:"all"はresolveMainAction側で「PTが足り
  // ず不発」判定をスキップし、その時点の残りPT全額を支払う特別な値。
  // 支払ったPT量はunit.lastActionCostに一時保存され、params関数から
  // 参照する。
  prescription: {
    id: "prescription",
    label: "処方箋",
    targetFaction: "own",
    cost: "all",
    allyOnly: true,
    shortNotation: "M/r/回復r",
    steps: [{ actionId: "heal", params: (unit) => ({ b: unit.lastActionCost - 3 }) }],
  },
});

// 武器固有スキル・Mainフェイズ。weaponOnly:trueの意味はPREP_MODULES側
// の同名コメント参照。
Object.assign(MAIN_MODULES, {
  // 【ホーンブレイク】（ナイフ）/【アイスブレイク】（アイスピック）/
  // 【シェルブレイク】（フォーク）：いずれも「残りコスト全消費、攻撃
  // した後、消費したPT分だけ相手の特定能力値を弱体化」という同型の
  // 構成（処方箋と同じcost:"all"パターン -- unit.lastActionCostへ支払
  // 額が記録済みのものを弱体化のnとしてそのまま使う）。ダメージより
  // 威勢を削ぐことを狙ったコンセプトで、弱体化の判定ステータスは
  // weakenAttack/weakenDestruction/weakenDefenseそれぞれの既定（賢さ）
  // のまま上書きしない。
  hornBreak: {
    id: "hornBreak",
    label: "ホーンブレイク",
    targetFaction: "opposing",
    cost: "all",
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "M/r/弱体化(攻)r",
    steps: [{ actionId: "attack" }, { actionId: "weakenAttack", params: (unit) => ({ n: unit.lastActionCost }) }],
  },
  iceBreak: {
    id: "iceBreak",
    label: "アイスブレイク",
    targetFaction: "opposing",
    cost: "all",
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "M/r/弱体化(破)r",
    steps: [{ actionId: "attack" }, { actionId: "weakenDestruction", params: (unit) => ({ n: unit.lastActionCost }) }],
  },
  shellBreak: {
    id: "shellBreak",
    label: "シェルブレイク",
    targetFaction: "opposing",
    cost: "all",
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "M/r/弱体化(防)r",
    steps: [{ actionId: "attack" }, { actionId: "weakenDefense", params: (unit) => ({ n: unit.lastActionCost }) }],
  },
  // 【サプライズ】（ストロー）：攻撃の能動能力値を協調性に上書きする
  // （Stage0のattack.params.aStat拡張をそのまま使う）。
  surprise: {
    id: "surprise",
    label: "サプライズ",
    targetFaction: "opposing",
    cost: 2,
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "M/2/攻撃/協",
    steps: [{ actionId: "attack", params: { aStat: "coordination" } }],
  },
  // 【バウンス】（ディッパー）：自身のIN値で分岐する特殊スキル。実際の
  // 分岐処理はcustom resolver（resolveBounce、BattleScene内）が持つ。
  // targetFaction:"self"のため対象選択は不要。
  bounce: {
    id: "bounce",
    label: "バウンス",
    targetFaction: "self",
    cost: 1,
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "M/1/特殊INs",
    custom: "bounce",
  },
  // 【サニーサイドアップ】（フライパン）：直前に使った技がスマッシュ/
  // プロテクトを内包する場合だけ選択肢に出る（requiresPriorActionIds、
  // isModuleAvailableFor参照 -- ハニービービートのスマッシュや守りの手
  // のプロテクトのような、複合スキルの中の1ステップとしての使用も含む）。
  // 自陣営1体に回復（回復力ボーナス+2）。
  sunnySideUp: {
    id: "sunnySideUp",
    label: "サニーサイドアップ",
    targetFaction: "own",
    cost: 1,
    allyOnly: true,
    weaponOnly: true,
    requiresPriorActionIds: ["smash", "protect"],
    shortNotation: "M/1/回復2",
    steps: [{ actionId: "heal", params: { b: 2 } }],
  },
  // 【アラート】（タイマー）：継続ダメージのnを「現在のターン数÷2
  // （切り上げ）」にする（resolveStepParamsが渡すpools.turnを参照）。
  // 戦闘が長引くほど強くなる。
  alert: {
    id: "alert",
    label: "アラート",
    targetFaction: "opposing",
    cost: 1,
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "M/1/継続ダメ?",
    steps: [{ actionId: "dot", params: (unit, targetUnit, pools) => ({ n: Math.ceil(pools.turn / 2) }) }],
  },
  // 【エコロジー】（カミザラ）：自身にプロテクトをかけ、そのプロテクト
  // で増えた体幹の量（lastResult.magnitude）をそのまま継続回復のnに
  // 使う（Stage0のステップ間結果参照フックの最初の実使用）。継続回復
  // の判定ステータスは防御力に上書き。targetFaction:"self"のため対象
  // 選択は不要。
  ecology: {
    id: "ecology",
    label: "エコロジー",
    targetFaction: "self",
    cost: 2,
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "M/2/プロテクトs+",
    steps: [
      { actionId: "protect" },
      { actionId: "regen", params: (unit, targetUnit, pools, lastResult) => ({ n: lastResult?.magnitude ?? 0, aStat: "defense" }) },
    ],
  },
  // 【シェアカット】（ピザカッター）：対象選択の必要なし（targetFaction:
  // "none"）。実際の可変回数・毎回ランダム対象の攻撃はcustom resolver
  // （resolveShareCut、BattleScene内）が持つ -- 固定回数・固定候補
  // 前提の既存stepsエンジンでは表現できないため。
  shareCut: {
    id: "shareCut",
    label: "シェアカット",
    targetFaction: "none",
    cost: 2,
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "M/2/特殊?",
    custom: "shareCut",
  },
  // 【アレンジ】（レシピブック）：自陣営・相手陣営どちらの1体でも選べる
  // （targetFaction:"any"）。継続回復⇔継続ダメージの交換／全補正の
  // バフ⇔デバフ反転／体幹×-1、という複数フィールドにまたがる処理を
  // 一度に行うため、既存のeffect種別（hp/stamina/correction/
  // continuous）のどれにも当てはまらず、custom resolver
  // （resolveArrange）で直接対象を書き換える。
  arrange: {
    id: "arrange",
    label: "アレンジ",
    targetFaction: "any",
    cost: 1,
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "M/1/特殊?",
    custom: "arrange",
  },
  // 【ピール】（スライサー）：相手陣営全員に、体幹が1以上ある時だけ
  // 体幹を1減らしHPを固定8削る（peelHitが葉、each:"opposing"がラップ
  // する）。体幹0以下の相手には何も起きない（peelHit自身がmagnitude:0
  // で不発を表現する）。
  peel: {
    id: "peel",
    label: "ピール",
    targetFaction: "none",
    cost: 2,
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "M/2/特殊*",
    steps: [{ actionId: "peelHit", each: "opposing" }],
  },
  peelHit: {
    id: "peelHit",
    label: "ピール",
    targetFaction: "opposing",
    effect: "hp",
    apply: (actor, target) => {
      if (target.stamina < 1) return { magnitude: 0, label: "ダメージ" };
      target.stamina -= 1;
      applyHpDamage(target.character, 8);
      return { magnitude: 8, label: "ダメージ" };
    },
  },
  // 【ブレンド】（ミキサー）：相手陣営1体を選んで使う（不発ありの方式
  // --「選べるが不発」に統一するユーザー指示に従う）。対象の体幹が
  // -1以下の時だけ、その脆弱性を全て支払って「4×(-体幹)」の固定
  // ダメージを与え体幹を0に戻す。体幹が0以上の相手には何も起きない。
  // 単体のleafモジュールとして、自分自身がsteps無しでapplyを直接持つ
  // （quickAttackなどと同じ形）。
  blend: {
    id: "blend",
    label: "ブレンド",
    targetFaction: "opposing",
    effect: "hp",
    cost: 2,
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "M/2/特殊",
    apply: (actor, target) => {
      if (target.stamina >= 0) return { magnitude: 0, label: "ダメージ" };
      const damage = 4 * -target.stamina;
      target.stamina = 0;
      applyHpDamage(target.character, damage);
      return { magnitude: damage, label: "ダメージ" };
    },
  },
});

// 属性攻撃(attribute)：module.attributeを持つ自分専用の「攻撃」。この
// idはisModuleAvailableForで、モンスター自身の属性と一致する時しか
// 選べないようゲートされる（プレイヤーの隊員はattributeを持たない
// ため常に対象外）。実際の効果適用はsteps/runStepsの汎用エンジンでは
// なく、専用のapplyAttributeAttack（BattleScene内、下記resolveMainAction
// 付近）が受け持つ -- 発動確率がactorのレベル依存の動的な値になる点、
// 汚染だけ「6種類から重複なく2つ」という毎回選び直しが必要な点は、
// 固定値のchanceを前提にしたstepsの形では表現しづらいため。
const ATTRIBUTE_ATTACK_KEYS = ["soak", "humidity", "cold", "dry", "heat", "time", "decay", "contamination"];
Object.assign(
  MAIN_MODULES,
  Object.fromEntries(
    ATTRIBUTE_ATTACK_KEYS.map((attribute) => {
      const id = `attributeAttack_${attribute}`;
      return [
        id,
        {
          id,
          label: `属性攻撃(${COATING_ATTRIBUTE_LABELS[attribute]})`,
          targetFaction: "opposing",
          attribute,
        },
      ];
    })
  )
);

// モンスターの所持スキル：MONSTER_DATA/BOSS_MONSTER_DATAのdataIdごとに、
// Prep/Mainそれぞれで使う{moduleId, chance}の配列を持つ。moduleIdは
// PREP_MODULES/MAIN_MODULESのキー。選択方法（chooseMonsterSkillEntry
// 参照）：①PTが足りる・対象がいるものだけを候補にする、②発生確率の
// 高い順に並べ、最後の1つ以外は自分の確率で判定、最後の候補は無条件で
// 発動する（「A 100%, B 0%」で「使えるなら必ずA、それ以外はB」になる
// のもこの規則からそのまま出る）。所持スキルが定義されていないモンス
// ター（将来の追加分）はpickMonsterAction側で旧来のrandomEnemyActionに
// フォールバックする。
const MONSTER_SKILL_LOADOUTS = {
  karumeDog: {
    prep: [{ moduleId: "excitement", chance: 1 }],
    main: [
      { moduleId: "tackle", chance: 0.7 },
      { moduleId: "cry", chance: 0.3 },
    ],
  },
  chocoRock: {
    prep: [{ moduleId: "interference", chance: 1 }],
    main: [
      { moduleId: "tackle", chance: 0.4 },
      { moduleId: "harden", chance: 0.6 },
    ],
  },
  electricJelly: {
    prep: [{ moduleId: "staticCling", chance: 1 }],
    main: [
      { moduleId: "electrocute", chance: 1 },
      { moduleId: "discharge", chance: 0 },
    ],
  },
  merengeCat: {
    prep: [{ moduleId: "elegance", chance: 1 }],
    main: [
      { moduleId: "scratch", chance: 0.5 },
      { moduleId: "cry", chance: 0.5 },
    ],
  },
  fruitTree: {
    prep: [{ moduleId: "tasteTest", chance: 1 }],
    main: [
      { moduleId: "sweetFruit", chance: 0.5 },
      { moduleId: "sourFruit", chance: 0.5 },
    ],
  },
  chewingMachine: {
    prep: [{ moduleId: "biteMesh", chance: 1 }],
    main: [{ moduleId: "tick", chance: 1 }],
  },
  candyArmy: {
    prep: [{ moduleId: "unity", chance: 1 }],
    main: [
      { moduleId: "charge", chance: 0.8 },
      { moduleId: "guard", chance: 0.2 },
    ],
  },
  yukiClock: {
    prep: [{ moduleId: "clockUp", chance: 1 }],
    main: [{ moduleId: "thaw", chance: 1 }],
  },
  takeniniteiru: {
    prep: [{ moduleId: "fortress", chance: 1 }],
    main: [
      { moduleId: "slam", chance: 0.5 },
      { moduleId: "rush", chance: 0.5 },
    ],
  },
  // カルメヤ犬の上位個体（中盤3体＋終盤1体）。ELITE_MONSTER_DATA参照
  // （成長値はカルメヤ犬と同一、スキル構成だけを変えた強化版）。
  katakuriDog: {
    prep: [{ moduleId: "delight", chance: 1 }],
    main: [
      { moduleId: "tackle", chance: 0.6 },
      { moduleId: "fawn", chance: 0.4 },
    ],
  },
  caramelDog: {
    prep: [{ moduleId: "threaten", chance: 1 }],
    main: [
      { moduleId: "tackle", chance: 0.6 },
      { moduleId: "howl", chance: 0.4 },
    ],
  },
  castellaDog: {
    prep: [{ moduleId: "obedience", chance: 1 }],
    main: [
      { moduleId: "patrol", chance: 0.8 },
      { moduleId: "cry", chance: 0.2 },
    ],
  },
  kasanariDog: {
    prep: [
      { moduleId: "happiness", chance: 0.3 },
      { moduleId: "glare", chance: 0.3 },
      { moduleId: "devotion", chance: 0.4 },
    ],
    main: [
      { moduleId: "tantrum", chance: 0.4 },
      { moduleId: "grandPatrol", chance: 0.3 },
      { moduleId: "fawn", chance: 0.1 },
      { moduleId: "howl", chance: 0.1 },
      { moduleId: "whimper", chance: 0.1 },
    ],
  },
  // メレンゲ猫の上位個体（中盤1体＋終盤1体）。ELITE_MONSTER_DATA参照
  // （成長値はメレンゲ猫と同一、スキル構成だけを変えた強化版）。
  rengeCat: {
    prep: [{ moduleId: "nobility", chance: 1 }],
    main: [
      { moduleId: "scratch", chance: 0.5 },
      { moduleId: "sharpenClaws", chance: 0.25 },
      { moduleId: "serenade", chance: 0.25 },
    ],
  },
  shakunageCat: {
    prep: [{ moduleId: "serenity", chance: 1 }],
    main: [
      { moduleId: "tear", chance: 0.4 },
      { moduleId: "sharpenClaws", chance: 0.2 },
      { moduleId: "transcendence", chance: 0.2 },
      { moduleId: "allure", chance: 0.2 },
    ],
  },
  // チョコロックの上位個体（中盤1体＋終盤1体）。ELITE_MONSTER_DATA参照
  // （成長値はチョコロックと同一、スキル構成だけを変えた強化版）。
  chocoBlock: {
    prep: [{ moduleId: "trafficJam", chance: 1 }],
    main: [
      { moduleId: "collision", chance: 0.4 },
      { moduleId: "fortify", chance: 0.6 },
    ],
  },
  chocoBariRock: {
    prep: [{ moduleId: "gridlock", chance: 1 }],
    main: [
      { moduleId: "headOnCollision", chance: 0.4 },
      { moduleId: "fortifyAll", chance: 0.6 },
    ],
  },
  // ユキドケイの上位個体（中盤1体＋終盤1体）。同じくELITE_MONSTER_DATA
  // 参照。
  ooYukiClock: {
    prep: [{ moduleId: "clockUp", chance: 1 }],
    main: [
      { moduleId: "avalanche", chance: 0.9 },
      { moduleId: "countdown", chance: 0.1 },
    ],
  },
  yukiBotoke: {
    prep: [{ moduleId: "clockHack", chance: 1 }],
    main: [
      { moduleId: "avalanche", chance: 0.8 },
      { moduleId: "countdown", chance: 0.1 },
      { moduleId: "countUp", chance: 0.1 },
    ],
  },
  // 飴アーミーの上位個体（中盤3体＋終盤3体、うち3体は中盤・終盤の両方に
  // 跨って登場する -- 誤記ではなく意図的な仕様）。ELITE_MONSTER_DATA
  // 参照（成長値は飴アーミーと同一）。
  // 【メモ】飴アーミー系統は戦闘への出現のさせ方自体を他のモンスターと
  // 変える予定（詳細未定）。実際に組み込む際はbuildNormalEnemyUnits等の
  // 通常の抽選ロジックをそのまま使わない可能性がある点に注意。
  candyBattleArmy: {
    prep: [{ moduleId: "unity", chance: 1 }],
    main: [
      { moduleId: "combatArts", chance: 0.8 },
      { moduleId: "guard", chance: 0.2 },
    ],
  },
  candyMagicArmy: {
    prep: [{ moduleId: "unity", chance: 1 }],
    main: [
      { moduleId: "curse", chance: 0.8 },
      { moduleId: "guard", chance: 0.2 },
    ],
  },
  candyShieldArmy: {
    prep: [{ moduleId: "unity", chance: 1 }],
    main: [
      { moduleId: "counterStrike", chance: 0.2 },
      { moduleId: "selfDefense", chance: 0.8 },
    ],
  },
  candyMedicalArmy: {
    prep: [{ moduleId: "unity", chance: 1 }],
    main: [
      { moduleId: "repair", chance: 0.8 },
      { moduleId: "supply", chance: 0.2 },
    ],
  },
  candyCommander: {
    prep: [{ moduleId: "anthem", chance: 1 }],
    main: [
      { moduleId: "command", chance: 0.8 },
      { moduleId: "guard", chance: 0.2 },
    ],
  },
};

// 隊員の所持スキル：CHARACTER_DATAのdataIdごとに、そのキャラクターが
// 選択できるモジュールid（Prep/Main問わず1本のリストにまとめたもの、
// isModuleAvailableForがフェイズ別レジストリから引いたmodule.idと
// 突き合わせるだけなので、Prep用/Main用に分ける必要が無い）を持つ。
// モンスターと違い、隊員側は「選ぶ・使う」のどちらもプレイヤー操作
// なので確率(chance)の概念は無い。ここに定義の無いキャラクター
// （今回未実装分）はisModuleAvailableForが制限をかけず、従来通り
// 全モジュールを自由選択できる。
const CHARACTER_SKILL_LOADOUTS = {
  flakeSugar: ["guardAlly", "quickAttack", "guardingHand"],
  cubeSugar: ["retreatCall", "firstAid", "attackingHand"],
  honeyScrew: ["festivalHunch", "firstAid", "honeyBeeBeat"],
  chocolatBitterTaste: ["shadowJustice", "firstAid", "bitterFeel"],
  lollipopSpiral: ["sisterCheer", "quickAttack", "perfectSupport"],
  flawlessNoColor: ["check", "firstAid", "flash"],
  sunlightSaccharum: ["highPlot", "lowPlot", "quickAttack", "prescription"],
};

// 「【スキル名】最短表記」の組み立てと、隊員/武器情報表示専用の逆引き。
// PREP_MODULES/MAIN_MODULESどちらのidも一意なので1つの辞書にまとめて
// 引ける（両レジストリのObject.assignが全て終わった後で作る必要がある
// ため、この位置に置く）。
const SKILL_MODULES = { ...PREP_MODULES, ...MAIN_MODULES };

export function describeSkill(moduleId) {
  const module = SKILL_MODULES[moduleId];
  return `【${module.label}】${module.shortNotation}`;
}

export function describeSkills(moduleIds) {
  return moduleIds.map(describeSkill).join("／");
}

// 武器固有スキル1つ分の表示用文字列（武器がその武器種のskillIdを持たな
// ければnull -- 現状は全武器種が必ず持つが、念のため）。武器置き場/
// 武器取引画面や、隊員が装備している武器の表示から呼ぶ想定。
export function describeWeaponSkill(weapon) {
  const skillId = WEAPON_TYPES[weapon.baseTypeId]?.skillId;
  return skillId ? describeSkill(skillId) : null;
}

// キャラクター固有スキルの表示用文字列（CHARACTER_SKILL_LOADOUTSに
// エントリの無いキャラクターはnull -- 未実装分は固有スキルを持たない）。
export function describeCharacterSkills(characterDataId) {
  const loadout = CHARACTER_SKILL_LOADOUTS[characterDataId];
  return loadout ? describeSkills(loadout) : null;
}

const PREP_START_PT = 3;

// 陣営ごとの隊員をラップする、戦闘限定の使い捨てデータ。IN/PT/行動選択
// はここにだけ持たせ、隊員本体（state.formationSlots の実オブジェクト）
// には一切書き込まない。corrections: 能力値ごとの補正枠（無ければ
// null）。continuousHp: 継続回復/継続ダメージの単一共有枠（無ければ
// null）。
function createBattleUnit(character, faction) {
  return {
    character,
    faction,
    in: 0,
    pt: { current: PREP_START_PT, max: PREP_START_PT },
    stamina: 0,
    corrections: { attack: null, defense: null, destruction: null, wisdom: null, coordination: null },
    continuousHp: null,
    pinnedBy: null,
    stealthed: false,
    guardedBy: null,
    lastActionCost: 0,
    // 直前に実際に実行した（コスト支払いまで進んだ）Mainモジュールが
    // 内部で実行した葉アクションのidの一覧（複合スキルなら中身の
    // 全ステップ分、単体モジュールならそれ自身のidのみ）。module.
    // requiresPriorActionIdsを持つスキル（【サニーサイドアップ】：
    // スマッシュ/プロテクトを内包する技の使用直後にのみ選択可 --
    // 【ハニービービート】のスマッシュや【守りの手】のプロテクトの
    // ような、複合スキルの中の1ステップとしての使用も対象に含める）
    // のためだけに使う -- 毎Prepフェイズ開始時にリセットする。
    lastLeafActionIds: [],
    action: null,
    displayName: character.name,
  };
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

// 能力値の補正状態 -- "positive" | "negative" | null。強化魔法/弱体化
// 魔法でその能力値に補正がかかっていれば符号を返す（表示の色分け用）。
function getStatCorrection(unit, key) {
  const c = unit.corrections[key];
  if (!c) return null;
  return c.sign > 0 ? "positive" : "negative";
}

function statAbbrSpan(key, value, correction) {
  const cls = correction === "positive" ? "battle-stat battle-stat--boost" : correction === "negative" ? "battle-stat battle-stat--drop" : "battle-stat";
  return h("span", { class: cls, text: `${BATTLE_STAT_ABBR[key]}${value}` });
}

function battleStatsLine(unit) {
  const parts = ["[ "];
  BATTLE_STAT_ORDER.forEach((key, i) => {
    if (i > 0) parts.push(" / ");
    parts.push(statAbbrSpan(key, correctedStat(unit, key), getStatCorrection(unit, key)));
  });
  parts.push(" ]");
  return h("p", { class: "battle-unit__stats" }, parts);
}

// 能力値の行の右側にイニシアチブ(IN)を右揃えで添える行。
function battleStatsRow(unit) {
  return h("div", { class: "battle-unit__statline" }, [battleStatsLine(unit), h("span", { class: "battle-unit__in", text: `IN: ${unit.in}` })]);
}

// 体幹: 0 基準の正負整数。正なら「装甲」で青く、負なら「脆弱性」で
// 黄色く表示し、0（補正なし）はどちらのラベルも付けず素のまま表示する。
// 毎ターン終了時に0へ向けて自然逓減する（量は体幹関連係数「体幹自然
// 逓減量」で可変、既定1 -- applyEndOfTurnStaminaDecay参照）。
function staminaSpan(stamina) {
  if (stamina > 0) return h("span", { class: "battle-unit__stamina battle-unit__stamina--armor", text: `装甲${stamina}` });
  if (stamina < 0) return h("span", { class: "battle-unit__stamina battle-unit__stamina--fragile", text: `脆弱性${-stamina}` });
  return h("span", { class: "battle-unit__stamina", text: "体幹: 0" });
}

// 変調：隊員（味方陣営）限定の常設パラメータ。モンスターには表示しない。
function conditionBadge(unit) {
  return h("span", { class: "battle-unit__condition", text: `変調: ${unit.character.condition ?? 0}` });
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
// のラベルにした専用版。継続回復/継続ダメージがかかっている間は、
// ラベルを「HP(↑n)」「HP(↓n)」に変えてその存在を示す。
function battleHpGauge(unit) {
  const character = unit.character;
  const maxHp = computeEffectiveMaxHp(character);
  const currentHp = character.currentHp ?? maxHp;
  const pct = maxHp > 0 ? Math.max(0, Math.min(100, (currentHp / maxHp) * 100)) : 0;
  const c = unit.continuousHp;
  const label = c ? `HP(${c.type === "heal" ? "↑" : "↓"}${c.n})` : "HP";
  return h("div", { class: "hp-line" }, [
    h("span", { class: "hp-line__label stat-hp", text: label }),
    h("span", { class: "hp-line__value", text: `${currentHp} / ${maxHp}` }),
    h("div", { class: "hp-gauge" }, [h("div", { class: "hp-gauge__fill", style: `width:${pct}%` })]),
  ]);
}

// 味方・敵どちらのステータス枠もこの1つを共有する。IN/PTは戦闘用ラッパ
// (unit) から、HP/能力値は隊員本体(unit.character)から読む。
// extraClass: 矢印表示中の行動主体/行動対象、または行動対象選択中の
// クリック可能表示を示す追加クラス、無い時はnull。onClickはワイド
// モードでのステータス枠クリックによる行動対象指定用。data-unit-id は
// 矢印オーバーレイがDOM実測で枠を探すためのキー。
// 横幅対策：ステータス枠・行動選択枠の表示名だけファーストネームに
// 短縮する（ログ本文のunit.displayNameはフルネームのまま変えない）。
// 同種モンスターが複数いる時の判別用サフィックス「 (2)」（末尾の半角
// スペース+丸括弧数字、createBattleUnit参照）は残す。日本語名の区切り
// 「・」が無い名前（フルーツリーなど）はそのまま返す。
function firstName(displayName) {
  const suffixMatch = displayName.match(/ \(\d+\)$/);
  const suffix = suffixMatch ? suffixMatch[0] : "";
  const base = suffix ? displayName.slice(0, -suffix.length) : displayName;
  const sepIndex = base.indexOf("・");
  return (sepIndex === -1 ? base : base.slice(0, sepIndex)) + suffix;
}

function battleUnitCard(unit, extraClass, onClick) {
  const classes = extraClass ? `battle-unit ${extraClass}` : "battle-unit";
  const headRight = isIncapacitated(unit)
    ? h("span", { class: "battle-unit__down-badge", text: "戦闘不能" })
    : unit.faction === "ally"
      ? conditionBadge(unit)
      : null;
  return h("div", { class: classes, "data-unit-id": unit.character.id, onClick }, [
    h("div", { class: "battle-unit__head" }, [h("span", { class: "battle-unit__name", text: firstName(unit.displayName) }), headRight]),
    battleHpGauge(unit),
    battleStatsRow(unit),
    h("div", { class: "battle-unit__footer" }, [
      staminaSpan(unit.stamina),
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

// 行動宣言ログの1行。targetFaction === "none"（【泥沼】のような、対象
// 候補の選択自体を必要としないスキル）は、単一の対象へ向けた宣言文
// ではなく発動そのものを告げる文にする -- 実際のtargetUnitはUI/CPUの
// 選択を通すための行動主体自身のダミー値でしかなく、表示に使うと
// 「自分自身に使用」という誤解を招くため。
// steps/customを持つ（＝単体の基礎行動ではなく複合/特殊スキル）場合だけ
// 最短表記を添える -- 攻撃/牽制のような基礎行動はラベルだけで自明な
// ため、逆に冗長になってしまう。隊員側もモンスター側もこの1関数を
// 経由する（declarationLineの2つの呼び出し元参照）ので、キャラクター
// スキル/武器固有スキル/モンスタースキルどれもここで一律に表示される。
function declarationLine(unit, module, targetUnit) {
  const notation = module.steps || module.custom ? `(${module.shortNotation})` : "";
  return module.targetFaction === "none"
    ? `${unit.displayName}が「${module.label}」${notation}を発動！`
    : `${unit.displayName}が「${module.label}」${notation}を${targetDisplayName(unit, targetUnit)}に使用！`;
}

function statSnapshotText(unit, stat) {
  return stat === "in" ? String(unit.in) : `${unit.pt.current}/${unit.pt.max}`;
}

// Prep/Mainどちらのフェイズも、CPUのランダム行動選択・プレイヤーの
// 手動選択・ウェイト付き順次処理・矢印の一時表示という同じ流れを持つ。
// Prepフェイズの行動順は常に「味方①→敵①→味方②→敵②→…」の固定、
// Mainフェイズの行動順はINが高い順（同値はランダム）。HPが0以下の
// ユニットは戦闘不能となり、行動できず行動対象にも選べなくなる。
// 陣営が全滅した時点で勝敗が決し、ログに結果（勝利ならモンスターデータ
// 由来の戦闘勝利報酬つき）を残して行動バーを「戦闘を終える」ボタン
// 1つだけに切り替える。実際の画面遷移（勝利なら戦闘不能だった味方の
// HP1/4復活を挟んでマップへ、敗北なら結果画面へ）はそのボタンを押した
// 時点で行い、自動では進まない。
// 通常戦闘の配置数：現在のマスの列番号と休憩発生クロック（ダンジョン
// パラメータ）を見て、休憩を何回くぐり抜けた後かで2/3/4体と決める
// （1回目の休憩前=2体、1〜2回目の間=3体、2回目の後=4体）。テスト
// ダンジョン用の一次的な計算で、ダンジョンごとに変わる想定はまだ無い。
function pickNormalEnemyCount(columnIndex, restClock) {
  const passedCheckpoints = restClock.filter((checkpoint) => checkpoint < columnIndex).length;
  return 2 + passedCheckpoints;
}

// 通常戦闘の敵構成：カルメヤ犬・チョコロック・電気ゼリー・メレンゲ猫・
// フルーツリー・チューイング・マシン・飴アーミー・ユキドケイ（＝
// MONSTER_DATAの全種、ボスはBOSS_MONSTER_DATA側の別カタログなので混ざ
// らない）から重複ありランダムで選び、全員を同じレベル（難易度D・最深部
// の深度Lを織り込んだcomputeProgressLevel、resourceCatalog.js参照）まで
// 配置時にレベルアップさせる。
function buildNormalEnemyUnits() {
  const dungeon = state.run.dungeon;
  const dungeonParams = state.run.dungeonParams;
  const currentNode = dungeon.nodes[state.run.currentNodeId];
  const monsterLevel = computeProgressLevel(
    state.run.visitedNodeIds.length,
    dungeonParams.difficultyValue,
    dungeonParams.longestReachableNodeCount
  );
  const count = pickNormalEnemyCount(currentNode.columnIndex, dungeonParams.restClock);
  const monsterDataIds = Object.keys(MONSTER_DATA);
  return Array.from({ length: count }, () =>
    createBattleUnit(createMonsterFromData(pickRandom(monsterDataIds), monsterLevel), "enemy")
  );
}

// ボス戦の敵構成：タケニニテイル（レベルはD×M+3で自動算出、
// BOSS_MONSTER_DATAの重み付けレベルアップで生成 -- data/testDungeon.jsの
// computeBossLevel参照）＋MONSTER_DATAから重複ありランダムで4体（レベル
// は最深部の深度Mに固定）。
const BOSS_ESCORT_COUNT = 4;

function buildBossEnemyUnits() {
  const dungeonParams = state.run.dungeonParams;
  const bossLevel = computeBossLevel(dungeonParams.difficultyValue, dungeonParams.longestReachableNodeCount);
  const bossUnit = createBattleUnit(createBossMonsterFromData("takeniniteiru", bossLevel), "enemy");
  const monsterDataIds = Object.keys(MONSTER_DATA);
  const escortUnits = Array.from({ length: BOSS_ESCORT_COUNT }, () =>
    createBattleUnit(
      createMonsterFromData(pickRandom(monsterDataIds), dungeonParams.longestReachableNodeCount),
      "enemy"
    )
  );
  return [bossUnit, ...escortUnits];
}

export function BattleScene(container, params, api) {
  const mode = params?.mode === "boss" ? "boss" : "normal";
  const allyUnits = state.formationSlots.map((c) => createBattleUnit(c, "ally"));
  const enemyUnits = mode === "boss" ? buildBossEnemyUnits() : buildNormalEnemyUnits();
  assignDisplayNames([...allyUnits, ...enemyUnits]);

  let turn = 1;
  let phase = "prep"; // "prep" | "main"
  let executing = false; // true while resolving an action / auto-advancing (blocks input)
  let activeArrow = null; // { actor, target } | { actor, targets: [] } | null（後者は陣営全体を対象に取るスキル用）
  let battleOutcome = null; // "victory" | "defeat" | null -- once set, the action bar swaps to a single 戦闘を終える button
  // Mainフェイズの逐次処理用：buildMainOrder()の結果をフェイズ開始時に
  // 1度だけ確定させ（startMainPhase）、mainCursorで「今どこまで見終え
  // たか」を指す。advanceMainPhase参照。
  let mainOrder = [];
  let mainCursor = 0;
  // Prepフェイズのステータス枠クリックによる行動対象指定用：「今どの
  // ユニットの行動対象を選んでいるか」。null＝まだ誰も選んでいない
  // （＝次のクリックは「対象を選ぶ主体」の指定として扱う）。
  // handlePrepActorClick/handlePrepTargetClick参照。
  let prepTargetPickingActor = null;
  const logLines = []; // { text, kind: "ally" | "enemy" | "phase" }

  function pushLog(text, kind = "phase") {
    logLines.push({ text, kind });
  }

  // 敵ユニットの残りHP一覧（携帯モードで戦場が見えなくても敵の状況が
  // 分かるように）。戦闘不能のユニットは省略する。
  function enemyHpRosterLine() {
    return enemyUnits
      .filter((u) => !isIncapacitated(u))
      .map((u) => `${u.displayName}: ${u.character.currentHp ?? computeEffectiveMaxHp(u.character)}/${computeEffectiveMaxHp(u.character)}`)
      .join(" _ ");
  }

  // フェイズが切り替わり、ログの表示がそこで一旦止まる（Prepフェイズは
  // プレイヤー入力待ち、Mainフェイズはウェイト中）タイミングで呼ぶ。
  // 見出し行の直後に敵の残りHP一覧を添える。
  function pushPhaseHeader(label) {
    pushLog(`▼▼▼ ${turn}ターン目 ${label}▼▼▼`, "phase");
    pushLog(enemyHpRosterLine(), "roster");
  }

  // フェイズに応じてPrep/Mainどちらのモジュール表を見るか。
  function currentModules() {
    return phase === "prep" ? PREP_MODULES : MAIN_MODULES;
  }

  // own/opposing の生存プールを算出する共通ヘルパー。candidateUnits（
  // スキル自身の対象候補）だけでなく、steps側のstep.each（対象候補の
  // 選択を経ずスキル内部で陣営全員を順番に処理する）からも同じ計算を
  // 再利用する。opposingは Mainフェイズに限り、釘付け（自身のpinnedBy
  // 優先）・隠密（相手候補から除外）の制限がかかる。
  function ownPoolFor(actor) {
    const own = actor.faction === "ally" ? allyUnits : enemyUnits;
    return own.filter((u) => !isIncapacitated(u));
  }
  function opposingPoolFor(actor) {
    const opposing = actor.faction === "ally" ? enemyUnits : allyUnits;
    let pool = opposing.filter((u) => !isIncapacitated(u));
    if (phase === "main") {
      if (actor.pinnedBy) {
        // 釘付けが成立している間は、警護による対象の差し替えは行わない
        // （挑発の「確実にこの相手を狙わせる」という役割を優先する）。
        pool = pool.filter((u) => u === actor.pinnedBy);
      } else {
        pool = pool.filter((u) => !u.stealthed);
        // 警護：候補に「警護対象」状態のユニットが含まれる場合、実際の
        // 対象候補としてはその守護者に差し替える（重複は除去）。
        pool = [...new Set(pool.map((u) => (u.guardedBy && !isIncapacitated(u.guardedBy) ? u.guardedBy : u)))];
      }
    }
    return pool;
  }

  function candidateUnits(actor, moduleId) {
    const module = currentModules()[moduleId];
    const own = actor.faction === "ally" ? allyUnits : enemyUnits;

    // targetFaction === "none"：スキル自身は対象候補の選択を必要としない
    // （内部のsteps側がstep.eachなどで陣営全員/個別対象を自分で処理する
    // ため）。UIやCPUの行動決定を既存の仕組みのまま通すための便宜上の
    // 唯一の候補として、行動主体自身をダミーで返す。
    if (module.targetFaction === "none") return [actor];
    if (module.targetFaction === "self") return [actor];
    if (module.targetFaction === "ownIncapacitated") return own.filter(isIncapacitated);
    if (module.targetFaction === "own") return ownPoolFor(actor);
    // ownExcludingSelf：自陣営の中から自分自身だけを除いた候補（【衛星】
    // のような「自分以外の味方を選ばせ、自分自身は別ステップで固定的に
    // 対象にする」構成に使う）。
    if (module.targetFaction === "ownExcludingSelf") return ownPoolFor(actor).filter((u) => u !== actor);
    // any：自陣営・相手陣営を問わず生存者全員（【アレンジ】のような
    // 「どちらの陣営の1体でも選べる」構成に使う）。
    if (module.targetFaction === "any") return [...ownPoolFor(actor), ...opposingPoolFor(actor)];

    // targetFaction === "opposing"
    return opposingPoolFor(actor);
  }

  // 矢印表示用：「陣営全体」を対象に取るスキル（先頭のstepがstep.each
  // を持つもの。sisterCheer/flash/quagmire/staticClingなど）は、宣言の
  // 時点で実際に効果が及ぶ全ユニットが確定しているので、それを返す。
  // 単体対象のスキルはnull（呼び出し側は従来通り単一のtarget表示に
  // フォールバックする）。
  function declaredTargetsFor(unit, module) {
    const each = module.steps?.[0]?.each;
    if (!each) return null;
    if (each === "own") return ownPoolFor(unit);
    if (each === "ownExcludingSelf") return ownPoolFor(unit).filter((u) => u !== unit);
    return opposingPoolFor(unit);
  }

  function randomEnemyAction(unit) {
    const modules = currentModules();
    const viableModuleIds = Object.keys(modules).filter((id) => isModuleAvailableFor(unit, modules[id]) && candidateUnits(unit, id).length > 0);
    const moduleId = pickRandom(viableModuleIds);
    const targetUnit = pickRandom(candidateUnits(unit, moduleId));
    return { moduleId, targetUnit };
  }

  // costを持つモジュールの支払い可能判定。固定値（数値）は現在PTが
  // それ以上あるか、"all"（残りコスト全消費）は現在PTが1以上あるか
  // （0の状態でも選べてしまうと「0を払って無限に繰り返し選べる」PT
  // チェーンの無限ループになってしまうため、0では不可とする）。costを
  // 持たないモジュールは常にtrue。
  function isAffordable(unit, module) {
    if (!module.cost) return true;
    if (module.cost === "all") return unit.pt.current > 0;
    return unit.pt.current >= module.cost;
  }

  // 所持スキル一覧（MONSTER_SKILL_LOADOUTS）から、指定フェイズで実際に
  // 使う{moduleId, chance}を1つ選ぶ：①PTが足りる・対象がいるものだけを
  // 候補にする、②発生確率の高い順に並べ、最後の1つ以外は自分の確率で
  // 判定、最後の候補は無条件で発動する（詳しい規則はMONSTER_SKILL_LOADOUTS
  // 自身のコメント参照）。候補が無ければnull（Mainフェイズの連続使用
  // ループの終了合図、またはPrepフェイズでその所持スキルが今は使えない
  // という意味）。
  function chooseMonsterSkillEntry(unit, phase, skillList) {
    const registry = phase === "prep" ? PREP_MODULES : MAIN_MODULES;
    const viable = skillList.filter(({ moduleId }) => {
      const module = registry[moduleId];
      if (phase === "main" && !isAffordable(unit, module)) return false;
      return candidateUnits(unit, moduleId).length > 0;
    });
    if (viable.length === 0) return null;
    const ordered = [...viable].sort((a, b) => b.chance - a.chance);
    for (let i = 0; i < ordered.length; i++) {
      if (i === ordered.length - 1 || Math.random() < ordered[i].chance) return ordered[i];
    }
    return null; // 理論上到達しない（最後の候補が無条件で返るため）
  }

  // あるスキルの候補から実際に使う対象を1体選ぶ：単体回復系
  // （module.healTarget、【甘い果実】など）は自陣営の残りHPが最も少ない
  // 1体（同値はランダム）、それ以外は候補からランダムに1体。
  function pickMonsterSkillTarget(unit, moduleId, registry) {
    const module = registry[moduleId];
    const candidates = candidateUnits(unit, moduleId);
    if (module.healTarget) {
      const hpOf = (c) => c.character.currentHp ?? computeEffectiveMaxHp(c.character);
      const minHp = Math.min(...candidates.map(hpOf));
      return pickRandom(candidates.filter((c) => hpOf(c) === minHp));
    }
    return pickRandom(candidates);
  }

  // randomEnemyActionの後継：所持スキルが定義されているモンスターは
  // chooseMonsterSkillEntryで選び、未定義（将来追加分の保険）は旧来通り
  // ランダムに倒す。Mainフェイズで「もう使えるスキルが無い」場合は
  // nullを返す（連続使用ループの終了合図）。
  function pickMonsterAction(unit, phase) {
    const loadout = MONSTER_SKILL_LOADOUTS[unit.character.dataId];
    if (!loadout) return randomEnemyAction(unit);
    const entry = chooseMonsterSkillEntry(unit, phase, loadout[phase] ?? []);
    if (!entry) return null;
    const registry = phase === "prep" ? PREP_MODULES : MAIN_MODULES;
    return { moduleId: entry.moduleId, targetUnit: pickMonsterSkillTarget(unit, entry.moduleId, registry) };
  }

  // モンスターのMainフェイズの手番：PTが支払える限り、使えるスキルが
  // 尽きるまで連続で選択・実行を繰り返す（隊員側は1回選んで実行する
  // たびにプレイヤーの選択へ戻る -- advanceMainPhase参照）。連続行動の
  // 途中で勝敗が決した、または自分自身が戦闘不能になった場合はそこで
  // 打ち切る。
  async function resolveMonsterMainTurn(unit) {
    while (true) {
      const action = pickMonsterAction(unit, "main");
      if (!action) break;
      unit.action = action;
      await resolveMainAction(unit);
      if (isIncapacitated(unit) || checkBattleEnd()) break;
    }
  }

  // 毎ターンのPrepフェイズ開始時: 全ユニットのIN/PTをリセットし、味方の
  // 行動選択は空に、敵の行動選択はCPUが選び直す（非公開）。戦闘不能の
  // 敵には行動を割り当てない（動けないため）。
  function resetForNewPrepPhase() {
    for (const unit of [...allyUnits, ...enemyUnits]) {
      unit.in = 0;
      unit.pt = { current: PREP_START_PT, max: PREP_START_PT };
      unit.pinnedBy = null;
      unit.stealthed = false;
      unit.guardedBy = null;
      // 【サニーサイドアップ】の「直前に使った技」判定は同じMainフェイズ
      // 内限定 -- ターンをまたいで前の技を覚えていると不自然なので、
      // 新しいPrepフェイズが始まるたびにリセットする。
      unit.lastLeafActionIds = [];
    }
    for (const unit of allyUnits) {
      unit.action = null;
      autoFillSelection(unit, viablePrepModuleIds(unit));
    }
    for (const unit of enemyUnits) unit.action = isIncapacitated(unit) ? null : pickMonsterAction(unit, "prep");
    prepTargetPickingActor = null;
  }

  for (const unit of allyUnits) autoFillSelection(unit, viablePrepModuleIds(unit));
  for (const unit of enemyUnits) unit.action = pickMonsterAction(unit, "prep");
  pushPhaseHeader("オードブル！");

  // PrepフェイズもMainフェイズも同じ形（プレイヤー選択→行動実行）に
  // なったので、処理中でなければ常に操作可能。
  function isInteractive() {
    return !executing;
  }

  // Prepフェイズの現在の状況で、対象候補が最低1つある所持スキルのid
  // 一覧を返す（Prepにはコストの概念が無いため、対象候補の有無だけを
  // 見る）。空なら、このユニットは今このタイミングで選べる行動が無い
  // ということ（例：所持スキルが「自身以外の自陣営1体」を対象に取る
  // ものだけで、自分が自陣営で唯一の生存者になっている場合）。
  function viablePrepModuleIds(unit) {
    return Object.keys(PREP_MODULES).filter((id) => {
      const module = PREP_MODULES[id];
      if (!isModuleAvailableFor(unit, module)) return false;
      return candidateUnits(unit, id).length > 0;
    });
  }

  // 選べる行動が1つも無いユニット（viablePrepModuleIdsが空）は、
  // 「全員選択完了」の必須対象から除外する -- そうしないと、対象候補が
  // 常に存在しない所持スキルしか持たないユニットが、行動不能なまま
  // Prepフェイズを永久に完了できなくなってしまう。
  function allAlliesReady() {
    return allyUnits
      .filter((u) => !isIncapacitated(u) && viablePrepModuleIds(u).length > 0)
      .every((u) => u.action && u.action.targetUnit);
  }

  // Mainフェイズは逐次処理のため、今まさに選択待ちの1ユニット（必ず
  // mainOrder[mainCursor]、味方）だけが選択済みかどうかを見る。
  function mainActorReady() {
    const unit = mainOrder[mainCursor];
    return !!(unit && unit.action && unit.action.targetUnit);
  }

  // このユニットが「今、選択操作の対象」かどうか。Prepフェイズは全員
  // 常に選択可能（現行仕様のまま）。Mainフェイズは逐次処理のため、
  // 行動順で今の手番のユニットだけが選択可能。
  function isActingNow(unit) {
    return phase === "prep" || mainOrder[mainCursor] === unit;
  }

  // Mainフェイズの現在の手番ユニット（味方）について、今すぐ選べる
  // （所持している・PTが足りる・対象がいる）行動のidを返す。空なら
  // そのユニットの手番はスキップする（advanceMainPhase参照）。
  function viableMainModuleIds(unit) {
    return Object.keys(MAIN_MODULES).filter((id) => {
      const module = MAIN_MODULES[id];
      if (!isModuleAvailableFor(unit, module)) return false;
      if (!isAffordable(unit, module)) return false;
      return candidateUnits(unit, id).length > 0;
    });
  }

  // 現フェイズでのそのユニットの「今選べる行動」idリスト（Prep/Mainの
  // 違いをここで吸収する、UI側の共通の入口）。
  function viableModuleIdsFor(unit) {
    return phase === "main" ? viableMainModuleIds(unit) : viablePrepModuleIds(unit);
  }

  // 行動内容(module)が1つしか選べない場合は自動で選択し、行動対象も
  // その時点で選べる候補が1人しかない（targetFaction:"none"で常に自分
  // 自身、または候補が1人だけ）場合は自動で選択する。unit.actionが
  // 既に部分的に埋まっている場合（プレイヤーが行動内容だけ選んだ状態
  // など）は、そこから続きだけを埋める。viableIdsが空なら選べる行動が
  // 無いということなので、何もしない（呼び出し側がスキップを判断する
  // -- resetForNewPrepPhase/advanceMainPhase参照）。
  function autoFillSelection(unit, viableIds) {
    let moduleId = unit.action?.moduleId;
    if (!moduleId && viableIds.length === 1) moduleId = viableIds[0];
    if (!moduleId) return;
    const module = currentModules()[moduleId];
    let targetUnit = unit.action?.targetUnit ?? null;
    if (!targetUnit) {
      if (module.targetFaction === "none") {
        targetUnit = unit;
      } else {
        const candidates = candidateUnits(unit, moduleId);
        if (candidates.length === 1) targetUnit = candidates[0];
      }
    }
    unit.action = { moduleId, targetUnit };
  }

  // Mainフェイズで、今の手番ユニットの行動内容・行動対象がどちらも
  // 確定した瞬間、「行動実行！」の押下を待たずに即座にそのユニットの
  // 行動を実行する（テンポ維持のための裁定）。これにより、Mainフェイズ
  // では「行動実行！」ボタンの出番は実質無くなる（選択が完了した時点で
  // 既に実行されているため）。Prepフェイズでは何もしない（Prepは全員
  // 分をまとめて「行動実行！」で確定する一括方式のまま）。
  function maybeAutoExecuteMain(unit) {
    if (phase !== "main" || executing) return;
    if (mainOrder[mainCursor] !== unit) return;
    if (!unit.action || !unit.action.targetUnit) return;
    runMainStep();
  }

  function handleModuleChange(unit, moduleId) {
    if (!moduleId) {
      unit.action = null;
      render();
      return;
    }
    // targetFaction === "none" のスキルは対象候補の選択自体が不要なので、
    // モジュールを選んだ時点で行動主体自身をダミーの対象として即確定
    // する（allAlliesReady()の「対象確定済み」判定をそのまま通すための
    // 便宜上の値で、実際の効果適用ではsteps側のstep.eachが陣営全員を
    // 独自に処理するため参照されない）。それ以外は、候補が1人しかいな
    // ければ自動で確定する（autoFillSelection相当をこの場で行う）。
    const module = currentModules()[moduleId];
    const candidates = candidateUnits(unit, moduleId);
    const targetUnit = module.targetFaction === "none" ? unit : candidates.length === 1 ? candidates[0] : null;
    unit.action = { moduleId, targetUnit };
    render();
    maybeAutoExecuteMain(unit);
  }

  function handleTargetChange(unit, targetUnit) {
    if (unit.action) unit.action.targetUnit = targetUnit;
    render();
    maybeAutoExecuteMain(unit);
  }

  // ワイドモード限定：ステータス枠を直接クリックした時の行動対象指定。
  // Prepフェイズは「誰の対象を選ぶか」→「その対象は誰か」の2段階
  // （交互に行う、混同しない）。Mainフェイズは行動主体が常に1人（今の
  // 手番のユニット）なので、対象選択の1段階のみ。
  function handleStatusCardClick(clickedUnit) {
    if (!isInteractive()) return;
    if (phase === "prep") {
      if (prepTargetPickingActor) handlePrepTargetClick(clickedUnit);
      else handlePrepActorClick(clickedUnit);
      return;
    }
    handleMainTargetClick(clickedUnit);
  }

  // Prepフェイズ第1段階：隊員のステータス枠をクリックして「この隊員の
  // 行動対象をこれから選ぶ」と指定する。行動内容が未確定のうちは対象
  // 候補を計算できないので何もしない。
  function handlePrepActorClick(unit) {
    if (unit.faction !== "ally" || isIncapacitated(unit) || !unit.action?.moduleId) return;
    prepTargetPickingActor = unit;
    render();
  }

  // Prepフェイズ第2段階：対象選択モード中に、候補のステータス枠を
  // クリックして「行動対象はこれ」と確定する。候補でなければ何もしない
  // （モードも維持する）。確定したらモードを解除する。
  function handlePrepTargetClick(candidateUnit) {
    const actor = prepTargetPickingActor;
    const moduleId = actor.action?.moduleId;
    if (!moduleId || !candidateUnits(actor, moduleId).includes(candidateUnit)) return;
    prepTargetPickingActor = null;
    handleTargetChange(actor, candidateUnit);
  }

  // Mainフェイズ：行動主体は常に今の手番のユニット1人なので、選択の
  // 段階分けは不要。行動内容が確定していて、かつ候補に含まれる枠を
  // クリックすると対象を確定する（確定した瞬間、maybeAutoExecuteMain
  // 経由で即座に実行される）。
  function handleMainTargetClick(candidateUnit) {
    const unit = mainOrder[mainCursor];
    if (!unit || !unit.action?.moduleId) return;
    if (!candidateUnits(unit, unit.action.moduleId).includes(candidateUnit)) return;
    handleTargetChange(unit, candidateUnit);
  }

  // このステータス枠が「今クリックすると意味のある操作になるか」（見た
  // 目の点線表示用。実際の判定は各ハンドラ内でも改めて行う）。Prepは
  // 対象選択モード中の候補のみ、Mainは今の手番ユニットの行動内容が
  // 確定していればその候補。
  function isClickableAsTarget(unit) {
    if (!isInteractive()) return false;
    if (phase === "prep") {
      if (!prepTargetPickingActor) return false;
      const moduleId = prepTargetPickingActor.action?.moduleId;
      return !!moduleId && candidateUnits(prepTargetPickingActor, moduleId).includes(unit);
    }
    const actor = mainOrder[mainCursor];
    if (!actor?.action?.moduleId) return false;
    return candidateUnits(actor, actor.action.moduleId).includes(unit);
  }

  // Prepフェイズは常に「味方①→敵①→味方②→敵②→…」の固定順（この順序
  // 自体はMainフェイズと違い最初からの確定仕様で、以下の変更の対象外）。
  // 味方と敵の人数が異なる場合（隊員が3人で敵が2体、など）でも安全な
  // よう、どちらか長い方の人数までインデックスを回し、存在しない側は
  // 単に飛ばす。戦闘不能のユニットはここで除外し、行動順に含めない。
  function buildAlternatingOrder() {
    const maxLen = Math.max(allyUnits.length, enemyUnits.length);
    const order = [];
    for (let i = 0; i < maxLen; i++) {
      if (allyUnits[i]) order.push(allyUnits[i]);
      if (enemyUnits[i]) order.push(enemyUnits[i]);
    }
    return order.filter((u) => !isIncapacitated(u));
  }

  // MainフェイズはINが高いユニットから順に行動する。IN同値のユニットが
  // 複数いる場合は、その中でランダムに順序を決める。戦闘不能のユニット
  // は除外する。
  function buildMainOrder() {
    const living = [...allyUnits, ...enemyUnits].filter((u) => !isIncapacitated(u));
    const groups = new Map();
    for (const unit of living) {
      const list = groups.get(unit.in) ?? [];
      list.push(unit);
      groups.set(unit.in, list);
    }
    const inValuesDesc = [...groups.keys()].sort((a, b) => b - a);
    return inValuesDesc.flatMap((inValue) => shuffleInPlace(groups.get(inValue)));
  }

  // 味方全滅（敗北）／敵全滅（勝利）のどちらかが成立していれば返す。
  function checkBattleEnd() {
    if (allyUnits.every(isIncapacitated)) return "defeat";
    if (enemyUnits.every(isIncapacitated)) return "victory";
    return null;
  }

  // 戦闘で相対した全モンスター分の戦闘勝利報酬を計算して実際に付与し、
  // ログ表示用の文字列を返す（グラント自体もここで行う -- 演出は無く
  // テキストログの表示だけで良いという指定のため）。
  function grantBattleRewards() {
    const rewards = computeBattleRewards(enemyUnits.map((u) => u.character));
    for (const entry of rewards) {
      if (entry.tier === null) grantResource(entry.category, entry.resourceId, entry.amount);
      else grantTieredResource(entry.category, entry.resourceId, entry.tier, entry.amount);
    }
    const parts = rewards.map((entry) => {
      const species = entry.category === "natural" ? NATURAL_RESOURCES[entry.resourceId] : RIGID_RESOURCES[entry.resourceId];
      if (!entry.tier) return `${species.name}×${entry.amount}`;
      const tierLabel = (entry.category === "natural" ? NATURAL_QUALITY_LABELS : RIGID_QUALITY_LABELS)[entry.tier];
      return `${species.name}(${tierLabel})×${entry.amount}`;
    });
    return parts.join("、");
  }

  // 戦闘不能のまま勝利した味方を、最大HPの1/4（切り上げ）で復活させる。
  // マップ画面に戻るタイミング（このボタンを押した瞬間）に行う。
  function reviveIncapacitatedAllies() {
    let rescuedCount = 0;
    for (const unit of allyUnits) {
      if (!isIncapacitated(unit)) continue;
      const maxHp = computeEffectiveMaxHp(unit.character);
      unit.character.currentHp = Math.ceil(maxHp / 4);
      rescuedCount += 1;
    }
    // リザルトスコア用：戦闘不能のまま戦闘を終えた（＝ここで救済された）
    // 人数ぶん減点カウンタへ積み上げる。
    recordRescue(rescuedCount);
  }

  // 勝敗が決した瞬間に呼ぶ：結果と（勝利なら）報酬をログに残すだけで、
  // 自動では遷移しない。以降はrender()が「戦闘を終える」ボタン1つだけ
  // の行動バーを出し、それを押した時点で初めてマップ/結果画面へ移る
  // （実際の遷移とHP復活はhandleBattleEndButton側）。
  function concludeBattle(outcome) {
    battleOutcome = outcome;
    if (outcome === "victory") {
      pushLog("▼▼▼ 勝利！ ▼▼▼", "phase");
      pushLog(`戦闘勝利報酬：${grantBattleRewards()}`, "phase");
      // 変調：戦闘勝利時、「全モンスターのレベル合計÷編成スロット上の
      // 隊員人数（切り上げ）」分だけ全隊員に加算する。
      const levelSum = enemyUnits.reduce((sum, u) => sum + u.character.level, 0);
      const conditionBonus = Math.ceil(levelSum / allyUnits.length);
      for (const unit of allyUnits) increaseCondition(unit.character, conditionBonus);
      // リザルトスコア用：討伐した全モンスターのレベル合計を積み上げる。
      recordDefeatedMonsterLevels(levelSum);
    } else {
      pushLog("▼▼▼ 味方全滅…敗北 ▼▼▼", "phase");
    }
    render();
  }

  function handleBattleEndButton() {
    if (battleOutcome === "victory") {
      reviveIncapacitatedAllies();
      api.closeScene();
    } else {
      api.navigateTo("result", { mode: "gameover" });
    }
  }

  // 「自分以外の隊員が戦闘不能になった時、変調+1」：戦闘不能になった
  // のが味方であれば、それ以外の全味方の変調を+1する。
  function rippleIncapacitationCondition(unit) {
    if (unit.faction !== "ally") return;
    for (const other of allyUnits) {
      if (other !== unit) increaseCondition(other.character, 1);
    }
  }

  // 全ユニットの体幹を、毎ターン終了時に0へ向けて1だけ自然逓減させる。
  function applyEndOfTurnStaminaDecay() {
    const decay = state.battleTuning.staminaNaturalDecay;
    for (const unit of [...allyUnits, ...enemyUnits]) {
      if (unit.stamina > 0) unit.stamina = Math.max(0, unit.stamina - decay);
      else if (unit.stamina < 0) unit.stamina = Math.min(0, unit.stamina + decay);
    }
  }

  // 1つの葉モジュール（apply()を持つ、これ以上分解されない効果）を対象
  // へ適用し、効果種別ごとの結果ログを1行積む。Prep版のapplyLeafModule
  // に相当（Mainと違いPTコスト・戦闘不能の判定はPrepフェイズには存在
  // しないため、resolvePrepAction側にもここにも無い）。
  async function applyLeafPrepModule(unit, targetUnit, module, params = {}) {
    if (module.statusLabel) {
      const result = module.apply(unit, targetUnit, allyUnits, enemyUnits);
      pushLog(
        result.applied
          ? `${targetUnit.displayName}が「${module.statusLabel}」状態になった！`
          : `${unit.displayName}以外に自陣営の行動可能なユニットがいないため、効果は不発に終わった。`,
        unit.faction
      );
    } else {
      const before = statSnapshotText(targetUnit, module.stat);
      module.apply(targetUnit, params.n ?? 1);
      const after = statSnapshotText(targetUnit, module.stat);
      pushLog(`${targetUnit.displayName}の${module.stat === "in" ? "IN" : "PT"}：${before} → ${after}`, unit.faction);
    }
    render();
    await sleep(ACTION_DELAY_MS);
  }

  // 【食べ比べ】専用の処理：1D6を振り、出目に応じて対象（相手陣営、
  // スキル自身が既に解決済み）へ鼓舞(1)/威圧(1)/威圧(2)のいずれかを
  // 適用する。鼓舞・威圧のapply()自体は陣営を問わず機能する（PTを増減
  // させるだけの処理で、targetFactionは候補選択にしか使わない）ため、
  // 既存のleafモジュールをそのまま相手陣営向けに流用できる。
  async function resolveTasteTest(unit, targetUnit) {
    const roll = rollD6();
    if (roll === 1) await applyLeafPrepModule(unit, targetUnit, PREP_MODULES.inspire, { n: 1 });
    else if (roll <= 5) await applyLeafPrepModule(unit, targetUnit, PREP_MODULES.intimidate, { n: 1 });
    else await applyLeafPrepModule(unit, targetUnit, PREP_MODULES.intimidate, { n: 2 });
  }

  // Prepフェイズの1ユニット分。葉モジュール・複合スキルのどちらも同じ
  // 入口を通る：宣言（矢印表示）→ウェイト→変調加算→steps実行。Prep
  // フェイズのスキルはコストを要さないため、Mainフェイズと違いPT確認は
  // 行わない。葉モジュールは実質「自分自身1個だけのsteps」として扱う。
  // unit.actionが無い（viablePrepModuleIdsが空で選択自体を免除された）
  // ユニットは何もしない。
  async function resolvePrepAction(unit) {
    if (!unit.action) return;
    const { moduleId, targetUnit } = unit.action;
    const module = PREP_MODULES[moduleId];
    const declaredTargets = declaredTargetsFor(unit, module);
    activeArrow = declaredTargets ? { actor: unit, targets: declaredTargets } : { actor: unit, target: targetUnit };
    pushLog(declarationLine(unit, module, targetUnit), unit.faction);
    // 変調：隊員が行動を行った時+1、隊員がモンスターの行動の対象になった
    // 時+1（成否・不発を問わず、行動の宣言時点で発生する）。
    if (unit.faction === "ally") increaseCondition(unit.character, 1);
    if (unit.faction === "enemy" && targetUnit.faction === "ally") increaseCondition(targetUnit.character, 1);
    render();
    await sleep(ACTION_DELAY_MS);

    if (module.custom === "tasteTest") {
      await resolveTasteTest(unit, targetUnit);
      return;
    }
    await runSteps(PREP_MODULES, applyLeafPrepModule, unit, targetUnit, module.steps ?? [{ actionId: module.id }]);
  }

  // 1つの葉モジュール（apply()を持つ、これ以上分解されない効果）を対象
  // へ適用し、効果種別ごとの結果ログを1行積む。戦闘不能/蘇生の判定は
  // 呼び出し側（resolveMainAction）で行動全体につき1回だけ済ませてある
  // 前提 -- 複合スキルの途中のステップでも改めてはチェックしない。
  // 戻り値：このleafのapply()結果をそのまま返す（【エコロジー】のような
  // 「直前のステップの結果を次のステップのparamsが参照する」構成の
  // ためのフック -- runSteps側でlastResultとして次のstep.paramsに渡す。
  // 従来この関数はvoidだったが、呼び出し側は戻り値の有無を気にしない
  // ので影響は無い）。
  async function applyLeafModule(unit, targetUnit, module, params = {}) {
    let result;
    if (module.effect === "revive") {
      result = module.apply(unit, targetUnit);
      pushLog(
        result.applied
          ? `${targetUnit.displayName}が復活した！（HP：0 → ${result.healedHp}）`
          : `${unit.displayName}は敵陣営のため、効果は不発に終わった。`,
        unit.faction
      );
    } else if (module.effect === "stamina") {
      const before = targetUnit.stamina;
      result = module.apply(unit, targetUnit, params);
      const after = targetUnit.stamina;
      pushLog(`${targetUnit.displayName}の体幹：${before} → ${after}`, unit.faction);
    } else if (module.effect === "correction") {
      result = module.apply(unit, targetUnit, params);
      const statLabel = CHARACTER_STAT_FULL_LABELS[result.statKey];
      pushLog(
        result.applied
          ? `${targetUnit.displayName}の${statLabel}に${result.sign > 0 ? "+" : "-"}${result.n}の補正（${result.turns}ターン）！`
          : `${targetUnit.displayName}の${statLabel}への補正は不発（既存の補正 ${result.existingN} 以上ではない）`,
        unit.faction
      );
    } else if (module.effect === "continuous") {
      result = module.apply(unit, targetUnit, params);
      const effectLabel = continuousEffectLabel(result.type);
      pushLog(
        result.applied
          ? `${targetUnit.displayName}に${effectLabel} ${result.n}（${result.turns}ターン）！`
          : `${targetUnit.displayName}への${effectLabel}は不発（既存の効果 ${result.existingN} 以上ではない）`,
        unit.faction
      );
    } else {
      const beforeHp = targetUnit.character.currentHp;
      result = module.apply(unit, targetUnit, params);
      const afterHp = targetUnit.character.currentHp;
      pushLog(`${targetUnit.displayName}のHP：${beforeHp} → ${afterHp}（${result.label} ${result.magnitude}）`, unit.faction);
      // 変調：自分以外の隊員が戦闘不能になった時+1（この分岐に来た時点で
      // targetUnitは行動前は戦闘不能ではなかったので、ここで戦闘不能に
      // なっていれば「今まさに」なったということ）。
      if (isIncapacitated(targetUnit)) rippleIncapacitationCondition(targetUnit);
    }
    render();
    await sleep(ACTION_DELAY_MS);
    return result;
  }

  // step.target省略時の既定（スキル自身が解決したtargetUnitをそのまま
  // 引き継ぐ）以外の、ステップ単位での対象上書きルール。
  // "self"：行動主体自身に固定（【陰陽】の最適化、【衛星】の2回目の
  // 鼓舞のような「前のステップの対象とは無関係に自分を対象にする」構成
  // に使う）。
  // "opposingExcludingUsed"：相手陣営から、このスキル内で既に対象に
  // なったユニットを除いた中からランダムに1体（【漁火】の2回目の威圧の
  // ような「もう1体、別の相手を巻き込む」構成に使う）。候補が残って
  // いなければundefinedを返す（runSteps側で不発として扱う）。
  function resolveStepTarget(unit, targetUnit, step, usedTargets) {
    if (!step.target) return targetUnit;
    if (step.target === "self") return unit;
    if (step.target === "opposingExcludingUsed") {
      const candidates = opposingPoolFor(unit).filter((u) => !usedTargets.includes(u));
      return pickRandom(candidates);
    }
    return targetUnit;
  }

  // steps（葉モジュールidまたは他スキルidのリスト、{actionId, chance,
  // target, each}の形）を順番に適用する。registryはPREP_MODULES/
  // MAIN_MODULESのどちらか一方（Prepフェイズのスキルの中でMainフェイズ
  // のモジュールを使う、あるいはその逆は起こらないので、Prep/Mainで
  // レジストリが混ざることはない -- resolvePrepAction/resolveMainAction
  // がそれぞれ自分のフェイズのレジストリと葉モジュール適用関数を渡す）。
  // chance省略時は必ず発動、指定されていれば毎ステップその確率で判定
  // する（外れたステップは何も起きず次へ進む）。actionIdが複合スキル
  // （steps持ち）を指していれば、そのスキル自身の対象解決はスキップし
  // てそのまま解決済みの対象へ再帰する -- ネストしたスキルは自分では
  // 対象を選び直さない。
  // targetを省略した既定のステップは、スキル自身が解決したtargetUnitを
  // そのまま対象にする（従来通り）。target指定があれば
  // resolveStepTargetがそのステップ限りの対象を決める。
  // eachを指定したステップは対象候補の選択そのものを経由せず、
  // （"own"/"opposing"の）陣営の生存者全員に対して順番に同じ効果を
  // 適用する（【泥沼】のような「範囲」スキルに使う）。
  // usedTargetsは、このスキル呼び出し全体を通じて「これまでに対象に
  // なったユニット」を積み上げていく配列 -- opposingExcludingUsedの
  // 除外判定に使う（既定は最初のtargetUnit自身を1件目として開始）。
  // step.params：固定オブジェクト、または(unit, targetUnit, pools,
  // lastResult) => オブジェクトの関数（【団結】のような動的な強さに使う。
  // poolsは{ownPoolFor, opposingPoolFor, turn} -- トップレベルの
  // モジュール定義から見えないBattleScene内クロージャを、この形でだけ
  // 渡す（turnは【アラート】のような「現在のターン数」を参照するスキル
  // 用、呼び出しの都度その時点の値を読む）。
  // lastResult：直前のleafステップのapply()戻り値（【エコロジー】の
  // ような「プロテクトで増えた体幹の量をそのまま次のステップのnに使う」
  // 構成のためのフック -- スキルの最初のステップではundefined）。
  // 省略時は{}（各モジュールのapply側の既定値がそのまま使われる）。
  function resolveStepParams(unit, targetUnit, step, lastResult) {
    if (!step.params) return {};
    return typeof step.params === "function"
      ? step.params(unit, targetUnit, { ownPoolFor, opposingPoolFor, turn }, lastResult)
      : step.params;
  }

  // 属性を持つモンスターが使うスキルの中に「攻撃」モジュール（id:
  // "attack"）が現れた場合、それがどのスキルの何ステップ目であっても
  // 自動的に属性攻撃（attack本体＋レベル依存の状態異常）へ置き換える。
  // 貫通攻撃は対象外（貫通攻撃そのものが大抵の属性攻撃より強いため、
  // という設計判断）。Mainフェイズのモジュールにしか存在しない概念な
  // ので、Prep側のregistry（PREP_MODULES）では常に素通しする。属性
  // 攻撃への置き換え時は戻り値を持たない（lastResultとしては何も渡らず、
  // 次のステップは無指定として扱われる -- 現状これを参照するスキルは
  // 無い）。
  async function applyLeafWithAttributeSwap(registry, applyLeaf, unit, target, action, params) {
    if (registry === MAIN_MODULES && action.id === "attack" && unit.character.attribute) {
      await applyAttributeAttack(unit, target, unit.character.attribute, params);
      return undefined;
    }
    return await applyLeaf(unit, target, action, params);
  }

  // leafIds：実際に適用された葉アクション（action.steps持ちの複合スキル
  // ではなく、apply()を持つ末端そのもの）のidを積み上げる配列 --
  // 【サニーサイドアップ】のrequiresPriorActionIds判定のためだけに使う
  // （resolveMainAction側がunit.lastLeafActionIdsをそのまま渡し、この
  // 関数が中身を書き換える）。省略時は使い捨ての空配列。
  async function runSteps(registry, applyLeaf, unit, targetUnit, steps, usedTargets = [targetUnit], leafIds = []) {
    let lastResult;
    for (const step of steps) {
      if (step.chance !== undefined) {
        const chance = typeof step.chance === "function" ? step.chance(unit, targetUnit) : step.chance;
        if (Math.random() >= chance) continue;
      }
      const action = registry[step.actionId];

      if (step.each) {
        const pool =
          step.each === "own"
            ? ownPoolFor(unit)
            : step.each === "ownExcludingSelf"
              ? ownPoolFor(unit).filter((u) => u !== unit)
              : opposingPoolFor(unit);
        for (const t of pool) {
          usedTargets.push(t);
          if (action.steps) await runSteps(registry, applyLeaf, unit, t, action.steps, usedTargets, leafIds);
          else {
            leafIds.push(action.id);
            lastResult = await applyLeafWithAttributeSwap(registry, applyLeaf, unit, t, action, resolveStepParams(unit, t, step, lastResult));
          }
        }
        continue;
      }

      const stepTarget = resolveStepTarget(unit, targetUnit, step, usedTargets);
      if (!stepTarget) {
        pushLog(`${unit.displayName}は他に対象がいないため、「${action.label}」は不発に終わった。`, unit.faction);
        render();
        await sleep(ACTION_DELAY_MS);
        continue;
      }
      usedTargets.push(stepTarget);
      if (action.steps) await runSteps(registry, applyLeaf, unit, stepTarget, action.steps, usedTargets, leafIds);
      else {
        leafIds.push(action.id);
        lastResult = await applyLeafWithAttributeSwap(registry, applyLeaf, unit, stepTarget, action, resolveStepParams(unit, stepTarget, step, lastResult));
      }
    }
  }

  // module.attribute持ちの属性攻撃：steps/runStepsの汎用エンジンではなく
  // 専用の処理を持つ（理由はMAIN_MODULESの属性攻撃エントリのコメント
  // 参照）。まず素の「攻撃」を必ず1回行い、対象が戦闘不能にならなければ
  // actorのレベル依存の確率（attributeProcChance）で状態異常を追加付与
  // する。汚染だけは1つに決まらず、候補6種類から重複なく2つを毎回選び
  // 直して両方付与する。paramsは攻撃本体の能動/受動能力値の上書き
  // （【ティック】のような、attribute置き換え元のスキル自身が指定した
  // ものをそのまま引き継ぐ -- applyLeafWithAttributeSwap参照）。
  async function applyAttributeAttack(unit, targetUnit, attribute, params = {}) {
    await applyLeafModule(unit, targetUnit, MAIN_MODULES.attack, params);
    if (isIncapacitated(targetUnit)) return;
    if (Math.random() >= attributeProcChance(unit)) return;
    const keys = attribute === "contamination" ? shuffleInPlace([...CONTAMINATION_DEBUFF_KEYS]).slice(0, 2) : [attribute];
    for (const key of keys) {
      await applyLeafModule(unit, targetUnit, ATTRIBUTE_DEBUFF_MODULES[key]);
    }
  }

  // 【バウンス】専用の解決関数：自身のINの符号によって強化魔法(破壊力)
  // /強化魔法(防御力)のどちらを自分にかけるかが変わる（既存のsteps
  // エンジンは「対象候補選択の結果」でしか分岐できず、「actorのIN値」
  // というactor自身の生の状態では分岐できないため、tasteTestと同じ
  // custom resolverの形を取る）。IN=0は不発（選べるが何も起きない --
  // ユーザー指示によりバウンス/ブレンドはこの方式に統一）。
  async function resolveBounce(unit) {
    if (unit.in >= 1) {
      await applyLeafModule(unit, unit, MAIN_MODULES.enhanceDestruction, { n: unit.in });
    } else if (unit.in <= -1) {
      await applyLeafModule(unit, unit, MAIN_MODULES.enhanceDefense, { n: -unit.in });
    } else {
      pushLog(`${unit.displayName}はIN（行動値）が0のため、「バウンス」は不発に終わった。`, unit.faction);
      render();
      await sleep(ACTION_DELAY_MS);
    }
  }

  // 【シェアカット】専用の解決関数：使用者の5能力値（補正なし/rawStat）
  // の中で最も高い値に並んでいる個数をXとし、相手陣営の生存者から
  // 毎回改めてランダムに選んだ対象へX回「攻撃」を行う（重複・除外なし
  // -- ユーザー指示により対象選択の候補管理は行わない簡略版）。相手
  // 陣営が全滅するなどして候補がいなくなった時点で打ち切る。
  async function resolveShareCut(unit) {
    const statKeys = ["attack", "defense", "destruction", "wisdom", "coordination"];
    const values = statKeys.map((key) => rawStat(unit, key));
    const max = Math.max(...values);
    const hitCount = values.filter((v) => v === max).length;
    for (let i = 0; i < hitCount; i++) {
      const pool = opposingPoolFor(unit);
      if (pool.length === 0) break;
      const target = pickRandom(pool);
      await applyLeafModule(unit, target, MAIN_MODULES.attack, {});
    }
  }

  // 【アレンジ】専用の解決関数：対象の継続回復⇔継続ダメージの交換
  // （継続割合ダメージは対象外、ユーザー指示の説明範囲外のため据え置
  // き）／全ての能力値補正のバフ⇔デバフ反転／体幹への-1倍、という
  // 複数フィールドにまたがる処理を一括で行う。既存のeffect種別
  // （hp/stamina/correction/continuous）のどれにも当てはまらないため
  // custom resolverとして直接対象を書き換える。何も変化しなかった
  // 場合（継続効果なし・補正なし・体幹0）はその旨を1行だけログする。
  async function resolveArrange(unit, targetUnit) {
    let changed = false;
    if (targetUnit.continuousHp && (targetUnit.continuousHp.type === "heal" || targetUnit.continuousHp.type === "damage")) {
      const beforeLabel = continuousEffectLabel(targetUnit.continuousHp.type);
      targetUnit.continuousHp.type = targetUnit.continuousHp.type === "heal" ? "damage" : "heal";
      const afterLabel = continuousEffectLabel(targetUnit.continuousHp.type);
      pushLog(`${targetUnit.displayName}の${beforeLabel}が${afterLabel}に変わった！`, unit.faction);
      changed = true;
    }
    for (const statKey of ["attack", "defense", "destruction", "wisdom", "coordination"]) {
      const correction = targetUnit.corrections[statKey];
      if (!correction) continue;
      correction.sign *= -1;
      const statLabel = CHARACTER_STAT_FULL_LABELS[statKey];
      pushLog(`${targetUnit.displayName}の${statLabel}の補正が反転した（${correction.sign > 0 ? "+" : "-"}${correction.n}）！`, unit.faction);
      changed = true;
    }
    if (targetUnit.stamina !== 0) {
      const before = targetUnit.stamina;
      targetUnit.stamina *= -1;
      pushLog(`${targetUnit.displayName}の体幹：${before} → ${targetUnit.stamina}`, unit.faction);
      changed = true;
    }
    if (!changed) {
      pushLog(`${targetUnit.displayName}には特に変化がなかった。`, unit.faction);
    }
    render();
    await sleep(ACTION_DELAY_MS);
  }

  // Mainフェイズ用のカスタム解決関数レジストリ：resolvePrepActionの
  // module.custom === "tasteTest"分岐と対になる仕組み。stepsの汎用
  // エンジン（固定回数・固定候補）では表現しづらいスキルを、
  // module.custom: "<key>"で対応するresolverへ振り分ける。
  const MAIN_CUSTOM_RESOLVERS = {
    bounce: resolveBounce,
    shareCut: resolveShareCut,
    arrange: resolveArrange,
  };

  // Mainフェイズの1ユニット分。葉モジュール・複合スキルのどちらも
  // 同じ入口を通る：宣言ログ→変調加算→（複合スキルのみ）PTコスト確認
  // ・支払い→蘇生/戦闘不能の判定（行動全体につき1回）→steps実行（また
  // はカスタム解決）。葉モジュールは実質「自分自身1個だけのsteps」と
  // して扱う。
  async function resolveMainAction(unit) {
    const { moduleId, targetUnit } = unit.action;
    const module = MAIN_MODULES[moduleId];
    const declaredTargets = declaredTargetsFor(unit, module);
    activeArrow = declaredTargets ? { actor: unit, targets: declaredTargets } : { actor: unit, target: targetUnit };
    pushLog(declarationLine(unit, module, targetUnit), unit.faction);
    // 変調：隊員が行動を行った時+1、隊員がモンスターの行動の対象になった
    // 時+1（成否・不発を問わず、行動の宣言時点で発生する）。
    if (unit.faction === "ally") increaseCondition(unit.character, 1);
    if (unit.faction === "enemy" && targetUnit.faction === "ally") increaseCondition(targetUnit.character, 1);
    render();
    await sleep(ACTION_DELAY_MS);

    if (module.cost === "all") {
      // 残りコスト全消費：PT不足による不発判定は行わず（0でも成立する）、
      // その時点の残りPT全額を支払う。支払った量はunit.lastActionCostに
      // 記録し、【処方箋】のようなparams関数から参照できるようにする。
      unit.lastActionCost = unit.pt.current;
      unit.pt.current = 0;
    } else if (module.cost) {
      if (unit.pt.current < module.cost) {
        pushLog(`${unit.displayName}はPTが足りず、「${module.label}」は不発に終わった。`, unit.faction);
        render();
        await sleep(ACTION_DELAY_MS);
        return;
      }
      unit.pt.current -= module.cost;
      unit.lastActionCost = module.cost;
    }

    // コストの支払いまで進んだ（＝実際にこの技を使った）時点で、まず
    // 葉アクション一覧を空にリセットする（属性攻撃/カスタム解決/蘇生/
    // 対象戦闘不能で不発の各分岐は下のrunStepsを通らないので、これらの
    // 直後はrequiresPriorActionIds持ちのスキルが選べなくなる、という
    // 素直な結果になる）。実際のsteps実行がある場合のみ、下のrunSteps
    // 呼び出しがこの配列に葉アクションのidを積んでいく。
    unit.lastLeafActionIds = [];

    // 蘇生は戦闘不能のユニットを対象にすることが前提の効果なので、
    // 「対象が戦闘不能なら不発」という下の汎用ガードより先に判定する。
    if (module.effect === "revive") {
      await applyLeafModule(unit, targetUnit, module);
      return;
    }
    if (isIncapacitated(targetUnit)) {
      pushLog(`${targetUnit.displayName}は戦闘不能のため、効果は不発に終わった。`, unit.faction);
      render();
      await sleep(ACTION_DELAY_MS);
      return;
    }

    if (module.attribute) {
      await applyAttributeAttack(unit, targetUnit, module.attribute);
      return;
    }

    if (module.custom) {
      await MAIN_CUSTOM_RESOLVERS[module.custom](unit, targetUnit);
      return;
    }

    await runSteps(MAIN_MODULES, applyLeafModule, unit, targetUnit, module.steps ?? [{ actionId: module.id }], [targetUnit], unit.lastLeafActionIds);
  }

  // 継続回復/継続ダメージ/継続割合ダメージを持つ全ユニットについて、
  // Mainフェイズの終わりに一度だけHPを増減させ、残りターン数を1減らす。
  // 継続割合ダメージだけは量の出し方が違う（変調減少後最大HP×n÷10を
  // 切り上げ、他2つはnD6合計÷2を切り上げ）他は同じ扱い。0になったら
  // そのユニットの継続効果枠を解除する。既に戦闘不能のユニットはスキ
  // ップする -- そうしないと、このターン中の行動で倒された後でも、
  // 倒れる前からかかっていた継続回復がHPを0より上に戻してしまい、実質
  // 的に蘇生になってしまう。
  async function applyContinuousHpTicks() {
    for (const unit of [...allyUnits, ...enemyUnits]) {
      const c = unit.continuousHp;
      if (!c || isIncapacitated(unit)) continue;
      const amount =
        c.type === "ratioDamage" ? Math.ceil((computeEffectiveMaxHp(unit.character) * c.n) / 10) : Math.ceil(rollSum(c.n) / 2);
      const before = unit.character.currentHp;
      if (c.type === "heal") applyHpHeal(unit.character, amount);
      else applyHpDamage(unit.character, amount);
      const after = unit.character.currentHp;
      const effectLabel = continuousEffectLabel(c.type);
      pushLog(`${unit.displayName}のHP：${before} → ${after}（${effectLabel} ${amount}）`, unit.faction);
      // 変調：自分以外の隊員が戦闘不能になった時+1（このループはすでに
      // 戦闘不能なユニットをcontinueで飛ばしているので、ここに来た時点で
      // 判定すれば「今まさに」なったかどうかを正しく検出できる）。
      if (isIncapacitated(unit)) rippleIncapacitationCondition(unit);
      render();
      await sleep(ACTION_DELAY_MS);
      c.turnsRemaining -= 1;
      if (c.turnsRemaining <= 0) unit.continuousHp = null;
    }
  }

  // 全ユニットの能力値補正について、毎ターン終了時に残りターン数を1
  // 減らし、0になったものは解除する。
  function applyEndOfTurnCorrectionDecay() {
    for (const unit of [...allyUnits, ...enemyUnits]) {
      for (const key of BATTLE_STAT_ORDER) {
        const c = unit.corrections[key];
        if (!c) continue;
        c.turnsRemaining -= 1;
        if (c.turnsRemaining <= 0) unit.corrections[key] = null;
      }
    }
  }

  // Prepフェイズの順次処理が終わったら、Mainフェイズへ切り替える：味方
  // ・敵とも選択を空に戻し、行動順(mainOrder)をこのフェイズの間だけ
  // 固定して先頭からのカーソル(mainCursor)を0に戻し、見出し＋敵HP一覧
  // をログに出す。ここではまだ誰の行動も実行しない -- advanceMainPhase
  // が呼ばれて初めて、先頭から敵の自動行動→最初の味方の選択待ちへと
  // 進む。
  function startMainPhase() {
    phase = "main";
    mainOrder = buildMainOrder();
    mainCursor = 0;
    for (const unit of [...allyUnits, ...enemyUnits]) unit.action = null;
    prepTargetPickingActor = null;
    pushPhaseHeader("メインディッシュ！");
  }

  async function runPrepExecution() {
    executing = true;
    render();

    for (const unit of buildAlternatingOrder()) {
      await resolvePrepAction(unit);
    }

    activeArrow = null;
    startMainPhase();
    render();
    await sleep(MAIN_PHASE_WAIT_MS);
    await advanceMainPhase();
  }

  // Mainフェイズのユニット送り：mainOrderを先頭（または前回止まった
  // 位置）から見て、戦闘不能なユニットはスキップ、敵はCPUがPTの続く
  // 限り連続実行、味方は「今すぐ選べる行動が1つも無い」間だけスキップ
  // する。選べる行動が残っている味方に行き当たったら、そこでmainCursor
  // を進めずに停止し（unit.actionは既にnull）、プレイヤーの選択を待つ
  // -- 次に「行動実行！」が押された時、同じユニットの手番として再開
  // する（まだ行動が残っていれば止まり、無くなっていれば次へ進む）。
  // 行動順を最後まで見終えたらターン終了処理を行い、次のPrepフェイズ
  // へ切り替える。
  async function advanceMainPhase() {
    while (mainCursor < mainOrder.length) {
      const unit = mainOrder[mainCursor];
      // 同じフェイズ内で自分より先に動いた誰かに倒されていたら、この
      // ユニットの番はスキップする（行動順はフェイズ開始時点の生存者
      // で組んでいるため、途中で戦闘不能になることがある）。
      if (isIncapacitated(unit)) {
        mainCursor += 1;
        continue;
      }
      // モンスターはPTが支払える限り連続でスキルを使用できる（隊員は
      // プレイヤーが選んだ1回だけ）-- resolveMonsterMainTurn参照。
      if (unit.faction === "enemy") {
        await resolveMonsterMainTurn(unit);
        const outcome = checkBattleEnd();
        if (outcome) {
          activeArrow = null;
          concludeBattle(outcome);
          return;
        }
        mainCursor += 1;
        continue;
      }
      if (viableMainModuleIds(unit).length === 0) {
        mainCursor += 1;
        continue;
      }
      // 行動内容・行動対象がどちらも自動で埋まる場合（選べる選択肢が
      // 1つしかない等）は、プレイヤーへの要求をせずそのまま即実行する
      // -- 続けて同じユニットにまだ使える行動があるかを再評価するため
      // mainCursorは進めず、whileループの先頭からやり直す。
      autoFillSelection(unit, viableMainModuleIds(unit));
      if (unit.action && unit.action.targetUnit) {
        if (await executeUnitAction(unit)) return;
        continue;
      }
      // プレイヤーの選択待ちで停止する時点では、直前の行動（自分より
      // 前に自動実行された敵・味方の分）の矢印はもう用済みなので消して
      // おく。消さないと、statusCardClass側の「矢印表示中は行動対象の
      // クリック指定枠を出さない」という排他判定に引っかかり、対象候補
      // が点線にならずクリック指定ができなくなってしまう。
      activeArrow = null;
      executing = false;
      render();
      return;
    }

    activeArrow = null;
    await applyContinuousHpTicks();
    const tickOutcome = checkBattleEnd();
    if (tickOutcome) {
      concludeBattle(tickOutcome);
      return;
    }

    applyEndOfTurnStaminaDecay();
    applyEndOfTurnCorrectionDecay();
    // 変調：毎ターン終了時+1（全味方、戦闘不能かどうかは問わない）。
    for (const unit of allyUnits) increaseCondition(unit.character, 1);
    turn += 1;
    phase = "prep";
    resetForNewPrepPhase();
    executing = false;
    pushPhaseHeader("オードブル！");
    render();
  }

  // 現在選択済みの行動を1つ実行する。勝敗が決していればconcludeBattle
  // して打ち切りの合図としてtrueを返す。そうでなければ行動を空に戻して
  // falseを返す（呼び出し側が次の手番へ進める）。runMainStep（プレイ
  // ヤーのボタン操作、または選択完了による即時実行）とadvanceMainPhase
  // （行動内容・行動対象がどちらも自動で埋まった場合の即時実行）の
  // 両方から共有される。
  async function executeUnitAction(unit) {
    await resolveMainAction(unit);
    const outcome = checkBattleEnd();
    if (outcome) {
      activeArrow = null;
      concludeBattle(outcome);
      return true;
    }
    unit.action = null;
    return false;
  }

  // Mainフェイズの「行動実行！」ボタン（および行動内容・行動対象が
  // どちらも確定した瞬間のmaybeAutoExecuteMain経由の自動呼び出し）：
  // 現在の手番ユニット（必ず味方、mainOrder[mainCursor]）が選択済みの
  // 1行動だけを実行し、その後の手番送りはadvanceMainPhaseに委ねる
  // （同じユニットにまだ使える行動が残っていれば、advanceMainPhase側の
  // 判定でそのまま同じユニットの手番として止まる）。
  async function runMainStep() {
    executing = true;
    render();
    const unit = mainOrder[mainCursor];
    if (await executeUnitAction(unit)) return;
    await advanceMainPhase();
  }

  // Prep/Mainどちらも「今選べる行動」（viableModuleIdsFor）だけを表示
  // する -- 選んでも不発になるだけの選択肢（対象無し、Mainならさらに
  // PT不足も）は最初から出さない。選べる行動が1つも無ければドロップ
  // ダウン自体をグレーアウトする。
  function moduleSelectFor(unit) {
    const options = viableModuleIdsFor(unit).map((id) => currentModules()[id]);
    const select = h(
      "select",
      {
        class: "battle-action-select__dropdown",
        disabled: !isInteractive() || !isActingNow(unit) || options.length === 0,
        onChange: (e) => handleModuleChange(unit, e.target.value),
      },
      [h("option", { value: "", text: "－" }), ...options.map((m) => h("option", { value: m.id, text: m.label }))]
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
        disabled: !isInteractive() || !isActingNow(unit) || !moduleId,
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
      h("div", { class: "battle-action-select__row" }, [moduleSelectFor(unit)]),
      h("div", { class: "battle-action-select__row" }, [targetSelectFor(unit)]),
    ]);
  }

  // ワイドモードの専用列に並ぶ、隊員名付きの版。味方ステータス列とは
  // 別列で独立に積み上がるため、行の高さがずれても誰の枠か分かるよう
  // 名前を添えている。行動内容・行動対象のどちらかが未確定の間はハイ
  // ライトし、両方確定すると解除する。順次処理中、Mainフェイズで今の
  // 手番でないユニット、および選べる行動が1つも無いユニットは一律
  // グレーアウト。
  function actionSelectBox(unit) {
    if (isIncapacitated(unit)) {
      return h("div", { class: "battle-action-select battle-action-select--down" }, [
        h("p", { class: "battle-action-select__name", text: firstName(unit.displayName) }),
        h("p", { class: "battle-action-select__down-label", text: "戦闘不能" }),
      ]);
    }
    const inactive = executing || !isActingNow(unit) || viableModuleIdsFor(unit).length === 0;
    const modifier = inactive ? " battle-action-select--disabled" : !(unit.action && unit.action.targetUnit) ? " battle-action-select--pending" : "";
    return h("div", { class: `battle-action-select${modifier}` }, [h("p", { class: "battle-action-select__name", text: firstName(unit.displayName) }), actionSelectFields(unit)]);
  }

  function battleLog() {
    return h(
      "div",
      { class: "battle-log" },
      logLines.map((line) => h("p", { class: `battle-log__line battle-log__line--${line.kind}`, text: line.text }))
    );
  }

  // 携帯モードでもワイドモードでも共通の、テキストログ直下の実行ボタン。
  // Prepフェイズは全味方の行動内容・行動対象が確定するまで、Main
  // フェイズは今の手番ユニット1人分が確定するまで無効（処理中も無効）。
  // Prep/Mainどちらのフェイズ中かで実行する処理を切り替える -- Prepは
  // 従来通り全員分を一括実行、Mainは手番ユニット1人分だけを実行して
  // 手番送りする。
  function actionExecuteButton() {
    return h("button", {
      class: "btn btn--primary battle-execute-btn",
      disabled: !isInteractive() || (phase === "prep" ? !allAlliesReady() : !mainActorReady()),
      onClick: phase === "prep" ? runPrepExecution : runMainStep,
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

  // 戦闘不能ならグレーアウト、それに加えて矢印表示中はその行動主体・
  // 行動対象のステータス枠を、そうでなく行動対象選択中はクリックで
  // 指定できる枠を、それぞれ追加クラスで示す（後者2つは時間的に排他
  // なので競合しない）。
  function statusCardClass(unit) {
    const classes = [];
    if (isIncapacitated(unit)) classes.push("battle-unit--down");
    if (activeArrow) {
      if (unit === activeArrow.actor) classes.push("battle-unit--actor");
      else if (activeArrow.targets ? activeArrow.targets.includes(unit) : unit === activeArrow.target) classes.push("battle-unit--target");
    } else {
      // Prepフェイズで「この隊員の行動対象を選ぶ」モード中のその隊員
      // 自身も、矢印表示中の行動主体と同じ見た目でハイライトする。
      if (phase === "prep" && unit === prepTargetPickingActor) classes.push("battle-unit--actor");
      if (isClickableAsTarget(unit)) classes.push("battle-unit--clickable-target");
    }
    return classes.length ? classes.join(" ") : null;
  }

  // ワイドモード：味方の行動選択列（左端）／味方ステータス列／中央情報
  // ／敵ステータス列、の4列。矢印は各ステータス枠の中央側の辺を実測し
  // て描く1枚のオーバーレイSVG（アリーナ全体に重ねる）で、中央の
  // フェイズ表示や「vs」の上を横切ることもある。ステータス枠は行動対象
  // 選択中、直接クリックすることでも指定できる（ワイドモード限定）。
  function battleArena() {
    return h("div", { class: "battle-arena" }, [
      h("div", { class: "battle-column battle-column--action" }, allyUnits.map(actionSelectBox)),
      h(
        "div",
        { class: "battle-column battle-column--ally" },
        allyUnits.map((u) => battleUnitCard(u, statusCardClass(u), () => handleStatusCardClick(u)))
      ),
      battleCenter(),
      h(
        "div",
        { class: "battle-column battle-column--enemy" },
        enemyUnits.map((u) => battleUnitCard(u, statusCardClass(u), () => handleStatusCardClick(u)))
      ),
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

    const arenaRect = arenaEl.getBoundingClientRect();
    if (!arenaRect.width || !arenaRect.height) return; // 携帯モードでアリーナ自体が非表示の間は何もしない
    overlay.setAttribute("viewBox", `0 0 ${arenaRect.width} ${arenaRect.height}`);

    // ユニットのステータス枠の「中央側の辺」の中点をDOM実測する。枠が
    // 見つからない（携帯モードなど）場合はnullを返す。
    function unitEdge(unit) {
      const el = arenaEl.querySelector(`[data-unit-id="${unit.character.id}"]`);
      if (!el) return null;
      return edgePoint(el.getBoundingClientRect(), arenaRect, unit.faction);
    }

    // (1) 釘付けの薄い赤矢印：Mainフェイズのみ、釘付けた側・られた側の
    // どちらも戦闘不能でない場合のみ描く。
    if (phase === "main") {
      for (const unit of [...allyUnits, ...enemyUnits]) {
        if (!unit.pinnedBy || isIncapacitated(unit) || isIncapacitated(unit.pinnedBy)) continue;
        const a = unitEdge(unit.pinnedBy);
        const b = unitEdge(unit);
        if (!a || !b) continue;
        for (const el of crossArrowElements(a, b, "pin")) overlay.appendChild(el);
      }
    }

    // (2) 隠密の薄い青バツ印：Mainフェイズのみ、戦闘不能でない場合のみ。
    if (phase === "main") {
      for (const unit of [...allyUnits, ...enemyUnits]) {
        if (!unit.stealthed || isIncapacitated(unit)) continue;
        const edge = unitEdge(unit);
        if (!edge) continue;
        for (const el of stealthMarkElements(edge, unit.faction)) overlay.appendChild(el);
      }
    }

    // (3) 警護の薄い青いコの字矢印：Mainフェイズのみ、警護した側・
    // された側のどちらも戦闘不能でない場合のみ描く（同陣営同士のため
    // コの字表示）。
    if (phase === "main") {
      for (const unit of [...allyUnits, ...enemyUnits]) {
        if (!unit.guardedBy || isIncapacitated(unit) || isIncapacitated(unit.guardedBy)) continue;
        const a = unitEdge(unit.guardedBy);
        const b = unitEdge(unit);
        if (!a || !b) continue;
        for (const el of loopArrowElements(a.x, a.y, b.y, unit.faction, false, "guard")) overlay.appendChild(el);
      }
    }

    // (4) 順次処理の一時的な矢印。上記3つより後に追加することで、常に
    // それらより表側（手前）に描かれる。陣営全体を対象に取るスキル
    // （activeArrow.targets配列がある場合）は、実際に効果が及ぶ全員へ
    // 向けた矢印を同時に1本ずつ描く（自分自身へのコの字矢印1本で代用
    // しない）。
    if (activeArrow?.targets) {
      const a = unitEdge(activeArrow.actor);
      if (a) {
        for (const target of activeArrow.targets) {
          const b = unitEdge(target);
          if (!b) continue;
          const elements =
            activeArrow.actor.faction !== target.faction
              ? crossArrowElements(a, b)
              : loopArrowElements(a.x, a.y, b.y, activeArrow.actor.faction, activeArrow.actor === target);
          for (const el of elements) overlay.appendChild(el);
        }
      }
    } else if (activeArrow) {
      const a = unitEdge(activeArrow.actor);
      const b = unitEdge(activeArrow.target);
      if (a && b) {
        const elements =
          activeArrow.actor.faction !== activeArrow.target.faction
            ? crossArrowElements(a, b)
            : loopArrowElements(a.x, a.y, b.y, activeArrow.actor.faction, activeArrow.actor === activeArrow.target);
        for (const el of elements) overlay.appendChild(el);
      }
    }
  }

  // 携帯モード：視覚的な戦場が非表示になる代わりに、隊員ごとの名前・HP
  // ・行動選択プルダウンだけの縦並びリストを出す。Mainフェイズで今の
  // 手番でないユニット、および選べる行動が1つも無いユニットは薄く
  // グレーアウトする（プルダウン自体はmoduleSelectFor/targetSelectFor
  // 側で既に無効化されている）。
  function mobileUnitRow(unit) {
    if (isIncapacitated(unit)) {
      return h("div", { class: "battle-mobile-unit battle-mobile-unit--down" }, [
        h("p", { class: "battle-mobile-unit__name", text: firstName(unit.displayName) }),
        battleHpGauge(unit),
        h("p", { class: "battle-action-select__down-label", text: "戦闘不能" }),
      ]);
    }
    const waiting = (phase === "main" && !isActingNow(unit)) || viableModuleIdsFor(unit).length === 0;
    return h("div", { class: `battle-mobile-unit${waiting ? " battle-mobile-unit--waiting" : ""}` }, [
      h("div", { class: "battle-mobile-unit__head" }, [h("p", { class: "battle-mobile-unit__name", text: firstName(unit.displayName) }), conditionBadge(unit)]),
      battleHpGauge(unit),
      actionSelectFields(unit),
    ]);
  }

  function battleMobileRoster() {
    return h("div", { class: "battle-mobile-roster" }, allyUnits.map(mobileUnitRow));
  }

  // 勝敗が決するまではポーズだけ、決した後は「戦闘を終える」1つだけに
  // 差し替える（自動遷移はしない -- 実際の遷移はhandleBattleEndButton）。
  function battleActions() {
    const skipButton = button("スキップ（テスト用）", { variant: "ghost", onClick: () => api.closeScene() });
    const speedButton = button("倍速", {
      variant: state.battleDoubleSpeed ? "primary" : "ghost",
      onClick: () => {
        setBattleDoubleSpeed(!state.battleDoubleSpeed);
        render();
      },
    });
    if (battleOutcome) return [button("戦闘を終える", { variant: "primary", onClick: handleBattleEndButton }), skipButton, speedButton];
    return [skipButton, speedButton];
  }

  function render() {
    renderScreen(container, {
      eyebrow: mode === "boss" ? "BATTLE / BOSS" : "BATTLE",
      title: mode === "boss" ? "戦闘（ボス戦）" : "戦闘",
      body: [battleLog(), actionExecuteButton(), battleArena(), battleMobileRoster()],
      onPause: battleOutcome ? undefined : () => api.callScene("pause"),
      actions: battleActions(),
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

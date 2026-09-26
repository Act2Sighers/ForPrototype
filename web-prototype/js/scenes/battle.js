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

// モジュール設計（2026-09時点の見直し）で新たに導入された固定係数。
// 体幹軽減係数だけはstate.battleTuning.staminaCorrectionMultiplier
// （オプション画面から調整可能、既定値はstate.js参照）に統合済みで、
// ここには含めない。
const PENETRATION_COEFFICIENT = 3; // 貫通係数：貫通攻撃/割合貫通攻撃の受動側ダイス数を割る
const REVIVE_DIFFICULTY = 5; // 蘇生難易度：蘇生の割合回復量を割る
const RATIO_DIFFICULTY = 3; // 割合系難易度：割合攻撃/割合貫通攻撃/割合回復を割る
const CONTINUOUS_DIFFICULTY = 2; // 継続系難易度：継続回復/継続ダメージの毎ターン量を割る
const CONTINUOUS_RATIO_DIFFICULTY = 6; // 継続割合系難易度：継続割合回復/継続割合ダメージの毎ターン量を割る
const STATUS_AILMENT_COEFFICIENT = 3; // 状態異常係数：属性攻撃の状態異常発動確率＝使用者レベル×この値(%)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms / (state.battleDoubleSpeed ? 2 : 1)));
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// 「Bd6合計」のB（ボーナス）が負の値になり得る箇所（例：【処方箋】の
// 「消費したPT-3」）で使う符号付き版。負ならその絶対値ぶんダイスを
// 振って合計し、符号を反転する（rollSum(負の数)はダイス0個扱いに
// なって単に0を返してしまい、減算として機能しないため）。
function signedRollSum(count) {
  return count >= 0 ? rollSum(count) : -rollSum(-count);
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
  // 【通さない！】：ついて来て！の警護対象を2体に増やした成長後スキル。
  // 警護は自分以外が前提の効果なので、2体目の選出はownExcludingUsedで
  // はなくownExcludingSelfAndUsedを使う（自分自身が2体目候補に紛れ
  // 込まないようにする）。
  noPassing: {
    id: "noPassing",
    label: "通さない！",
    targetFaction: "ownExcludingSelf",
    allyOnly: true,
    shortNotation: "P/警護+",
    steps: [{ actionId: "guard" }, { actionId: "guard", target: "ownExcludingSelfAndUsed" }],
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
  // 【誘導】：牽制した後、（前ステップの対象とは無関係に）自身を対象に
  // 最適化を行う -- 構造は陰陽と同一の、モジュール一覧に載る汎用版。
  guidance: {
    id: "guidance",
    label: "誘導",
    targetFaction: "opposing",
    shortNotation: "P/誘導",
    steps: [{ actionId: "restrain" }, { actionId: "optimize", target: "self" }],
  },
  // 【奪取】：威圧した後、（前ステップの対象とは無関係に）自身を対象に
  // 鼓舞を行う -- 構造は【チェック】（フローレス・ノーカラーの初期修得
  // スキル）と同一の、モジュール一覧に載る汎用版。
  steal: {
    id: "steal",
    label: "奪取",
    targetFaction: "opposing",
    shortNotation: "P/奪取",
    steps: [{ actionId: "intimidate" }, { actionId: "inspire", target: "self" }],
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
    shortNotation: "P/牽制t",
    steps: [{ actionId: "restrain" }],
  },
  staticCling: {
    id: "staticCling",
    label: "静電気",
    targetFaction: "none",
    monsterOnly: true,
    shortNotation: "P/最適化u*",
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
    shortNotation: "P/{鼓舞1,威圧1,威圧2}t",
    custom: "tasteTest",
  },
  // 【噛み合わせ】：牽制した後、（前ステップの対象とは無関係に）自身を
  // 対象に最適化を行う -- 構造は誘導と同一（誘導(1)そのもの）。
  biteMesh: {
    id: "biteMesh",
    label: "噛み合わせ",
    targetFaction: "opposing",
    monsterOnly: true,
    shortNotation: "P/誘導t",
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
    shortNotation: "P/最適化[自陣営生存者数]s",
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
    shortNotation: "P/牽制2t",
    steps: [{ actionId: "restrain", params: { n: 2 } }],
  },
  glare: {
    id: "glare",
    label: "凝視",
    targetFaction: "opposing",
    monsterOnly: true,
    shortNotation: "P/牽制3t",
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
    shortNotation: "P/警護e",
    steps: [{ actionId: "guard" }],
  },
  // 【一途】：警護した後、（前ステップの対象と）同じ対象に鼓舞(1)を行う。
  devotion: {
    id: "devotion",
    label: "一途",
    targetFaction: "ownExcludingSelf",
    monsterOnly: true,
    shortNotation: "P/警護e+鼓舞c",
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
    shortNotation: "P/威圧t+鼓舞2s",
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
    shortNotation: "P/威圧2t+鼓舞3s",
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
    shortNotation: "P/牽制t(2)",
    steps: [{ actionId: "restrain" }, { actionId: "restrain", target: "opposingExcludingUsed" }],
  },
  gridlock: {
    id: "gridlock",
    label: "大渋滞",
    targetFaction: "none",
    monsterOnly: true,
    shortNotation: "P/牽制t*",
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
    shortNotation: "P/最適化3u*",
    steps: [{ actionId: "optimize", each: "own", params: { n: 3 } }],
  },
  // フルーツリー系統の上位個体用スキル。全個体がサイコロ判定持ちという
  // 一貫したコンセプト（食べ比べと同じcustom分岐の仕組みを使う。steps
  // では出目ごとの分岐を表現できないため）。
  // 【摘み食い】【摘み採り】共通：出目が大きいほど鼓舞/威圧の強さは
  // 弱まるが、その代わり自傷（自身の最大HP比割合ダメージ）も軽くなる
  // -- resolveDiceRiskyBuff参照。
  nibble: {
    id: "nibble",
    label: "摘み食い",
    targetFaction: "ownExcludingSelf",
    monsterOnly: true,
    shortNotation: "P/鼓舞{3,2,1}e+[HP減少]?c",
    custom: "nibble",
  },
  pluck: {
    id: "pluck",
    label: "摘み採り",
    targetFaction: "opposing",
    monsterOnly: true,
    shortNotation: "P/威圧{3,2,1}t+[HP減少]?c",
    custom: "pluck",
  },
  // 【あべこべ】：相手陣営全員へ、対象ごとに独立した1D6判定で牽制(1~3)/
  // 威圧(1~3)のいずれかを個別に適用する。泥沼のstep.each:"opposing"は
  // 陣営全員へ同じ効果を適用するだけで対象ごとの分岐はできないため、
  // 食べ比べのcustom分岐の仕組みを陣営全体向けに拡張する -- resolveTopsyTurvy参照。
  topsyTurvy: {
    id: "topsyTurvy",
    label: "あべこべ",
    targetFaction: "none",
    monsterOnly: true,
    shortNotation: "P/{牽制{1,2,3},威圧{1,2,3}}t*",
    custom: "topsyTurvy",
  },
  // チューイング・マシン系統の上位個体用スキル。【噛み合わせ】(牽制(1)
  // 相手陣営1体+最適化(1)自身)の強さ違い。
  combination: {
    id: "combination",
    label: "組み合わせ",
    targetFaction: "opposing",
    monsterOnly: true,
    shortNotation: "P/誘導3t+奪取c",
    steps: [
      { actionId: "restrain", params: { n: 3 } },
      { actionId: "intimidate", params: { n: 1 } },
      { actionId: "optimize", params: { n: 3 }, target: "self" },
      { actionId: "inspire", params: { n: 1 }, target: "self" },
    ],
  },
  interweaving: {
    id: "interweaving",
    label: "編み合わせ",
    targetFaction: "opposing",
    monsterOnly: true,
    shortNotation: "P/誘導10t+奪取3c",
    steps: [
      { actionId: "restrain", params: { n: 10 } },
      { actionId: "intimidate", params: { n: 3 } },
      { actionId: "optimize", params: { n: 10 }, target: "self" },
      { actionId: "inspire", params: { n: 3 }, target: "self" },
    ],
  },
  // 電気ゼリー系統の上位個体用スキル。【静電気】(最適化(1)自陣営全員)と
  // 同じ「陣営全体、対象選択不要」構成の変種（対象陣営と効果が違う）。
  spark: {
    id: "spark",
    label: "火の粉",
    targetFaction: "none",
    monsterOnly: true,
    shortNotation: "P/牽制t*",
    steps: [{ actionId: "restrain", each: "opposing" }],
  },
  mirage: {
    id: "mirage",
    label: "蜃気楼",
    targetFaction: "none",
    monsterOnly: true,
    shortNotation: "P/鼓舞u*",
    steps: [{ actionId: "inspire", each: "own" }],
  },
  sandThrow: {
    id: "sandThrow",
    label: "砂かけ",
    targetFaction: "none",
    monsterOnly: true,
    shortNotation: "P/威圧t*",
    steps: [{ actionId: "intimidate", each: "opposing" }],
  },
  // タケニニテイル系統（ボス）の上位個体用スキル。【要塞】(鼓舞(3)自身)
  // の強さ違い -- 超純粋強化路線。
  greatFortress: {
    id: "greatFortress",
    label: "大要塞",
    targetFaction: "self",
    monsterOnly: true,
    shortNotation: "P/鼓舞4s",
    steps: [{ actionId: "inspire", params: { n: 4 } }],
  },
  giantFortress: {
    id: "giantFortress",
    label: "巨大要塞",
    targetFaction: "self",
    monsterOnly: true,
    shortNotation: "P/鼓舞5s",
    steps: [{ actionId: "inspire", params: { n: 5 } }],
  },
});

// 平凡スキル・Prepフェイズ。mediocreOnly:trueでisModuleAvailableForが
// 常に不可としているため、現時点ではどのユニットからも選べない --
// 平凡個体自体が未実装（MONSTER_DATA/CHARACTER_DATAどちらにも
// dataId「平凡個体」は無い）なので、データを登録するだけに留める。
Object.assign(PREP_MODULES, {
  step: {
    id: "step",
    label: "ステップ",
    targetFaction: "own",
    mediocreOnly: true,
    shortNotation: "P/最適化u",
    steps: [{ actionId: "optimize" }],
  },
  trap: {
    id: "trap",
    label: "トラップ",
    targetFaction: "opposing",
    mediocreOnly: true,
    shortNotation: "P/牽制t",
    steps: [{ actionId: "restrain" }],
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
  // 【逃がさない！】：下がって！（挑発）の対象数を2体に増やした成長後
  // スキル。opposingExcludingUsedで既存の1体とは別の相手陣営1体を選ぶ。
  neverLetGo: {
    id: "neverLetGo",
    label: "逃がさない！",
    targetFaction: "opposing",
    allyOnly: true,
    shortNotation: "P/挑発+",
    steps: [{ actionId: "provoke" }, { actionId: "provoke", target: "opposingExcludingUsed" }],
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
  // 【お祭りのススメ】：お祭りのヨカンの強さ違い（鼓舞2、最適化4）。
  festivalAdvice: {
    id: "festivalAdvice",
    label: "お祭りのススメ",
    targetFaction: "self",
    allyOnly: true,
    shortNotation: "P/鼓舞2s+",
    steps: [{ actionId: "inspire", params: { n: 2 } }, { actionId: "optimize", params: { n: 4 } }],
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
  // 【日陰者のツトメ】：自身以外の自陣営1体に隠密を行わせた後、自身も
  // 隠密を行う。隠密のapply()は対象を問わず機能する（自分専用の効果
  // ではない）ため、そのまま他者向けに流用できる。
  shadowJusticeDuty: {
    id: "shadowJusticeDuty",
    label: "日陰者のツトメ",
    targetFaction: "ownExcludingSelf",
    allyOnly: true,
    shortNotation: "P/隠密+s",
    steps: [{ actionId: "stealth" }, { actionId: "stealth", target: "self" }],
  },
  // 【お姉ちゃん頑張れ〜】：自陣営全員（自身を含む）に鼓舞(1)。ただし
  // 自陣営で行動可能なのが自身しかいなければ不発（警護/挑発/隠密と
  // 同じisSoleSurvivorの判定）。「自身を含む全員」への一括判定はstepsの
  // 汎用each機構（対象ごとの分岐はできない）では表現できないため、
  // 食べ比べ系と同じcustom resolver（resolveSisterCheer）に振り分ける。
  sisterCheer: {
    id: "sisterCheer",
    label: "お姉ちゃん頑張れ〜",
    targetFaction: "none",
    allyOnly: true,
    shortNotation: "P/鼓舞*",
    custom: "sisterCheer",
  },
  // 【流石だよ、お姉ちゃん！】：お姉ちゃん頑張れ〜の強さ違い（鼓舞2）。
  sisterCheerUpgrade: {
    id: "sisterCheerUpgrade",
    label: "流石だよ、お姉ちゃん！",
    targetFaction: "none",
    allyOnly: true,
    shortNotation: "P/鼓舞2*",
    custom: "sisterCheerUpgrade",
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
  // 【ダブルチェック】：チェックの相手陣営対象を2体に増やし、自身への
  // 鼓舞も2に強化。
  doubleCheck: {
    id: "doubleCheck",
    label: "ダブルチェック",
    targetFaction: "opposing",
    allyOnly: true,
    shortNotation: "P/威圧+*2",
    steps: [
      { actionId: "intimidate", params: { n: 1 } },
      { actionId: "intimidate", target: "opposingExcludingUsed", params: { n: 1 } },
      { actionId: "inspire", target: "self", params: { n: 2 } },
    ],
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
  // 【ハイ・ベット】：ハイ・プロットのIN⇔PTトレードオフを自身1人から
  // 自陣営全員に拡張した成長後スキル（強さは自身分だけ抑えて3/1に）。
  highBet: {
    id: "highBet",
    label: "ハイ・ベット",
    targetFaction: "none",
    allyOnly: true,
    shortNotation: "P/最適化3*+",
    steps: [
      { actionId: "optimize", each: "own", params: { n: 3 } },
      { actionId: "intimidate", each: "own", params: { n: 1 } },
    ],
  },
  lowPlot: {
    id: "lowPlot",
    label: "ロー・プロット",
    targetFaction: "self",
    allyOnly: true,
    shortNotation: "P/牽制5s+",
    steps: [{ actionId: "restrain", params: { n: 5 } }, { actionId: "inspire", params: { n: 2 } }],
  },
  // 【ロー・ベット】：ロー・プロットの自陣営全員版（強さは3/1に抑制）。
  lowBet: {
    id: "lowBet",
    label: "ロー・ベット",
    targetFaction: "none",
    allyOnly: true,
    shortNotation: "P/牽制3*+",
    steps: [
      { actionId: "restrain", each: "own", params: { n: 3 } },
      { actionId: "inspire", each: "own", params: { n: 1 } },
    ],
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
    shortNotation: "P/最適化2u*",
    steps: [{ actionId: "optimize", each: "own", params: { n: 2 } }],
  },
  // 【チアーズ＋】：チアーズ（最適化(2)自陣営全員）に、自陣営全員への
  // 鼓舞(1)を追加した改良後スキル。ハイ・ベット/ロー・ベットと同じ
  // 「each:"own"の2ステップを続ける」構造。
  cheersPlus: {
    id: "cheersPlus",
    label: "チアーズ＋",
    targetFaction: "none",
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "P/最適化3u*+鼓舞c",
    steps: [
      { actionId: "optimize", each: "own", params: { n: 3 } },
      { actionId: "inspire", each: "own", params: { n: 1 } },
    ],
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
    shortNotation: "P/鼓舞3e+威圧2s",
    steps: [
      { actionId: "inspire", params: { n: 3 } },
      { actionId: "intimidate", target: "self", params: { n: 2 } },
    ],
  },
  // 【ピクルス＋】：鼓舞の対象数を自身以外の自陣営3体に拡張した改良後
  // スキル（守りの原点のownExcludingSelfAndUsedを2回使う対象拡張と
  // 同じ構造）。自身への威圧(2)は据え置き。
  picklesPlus: {
    id: "picklesPlus",
    label: "ピクルス＋",
    targetFaction: "ownExcludingSelf",
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "P/鼓舞2e(3)+威圧2s",
    steps: [
      { actionId: "inspire", params: { n: 2 } },
      { actionId: "inspire", target: "ownExcludingSelfAndUsed", params: { n: 2 } },
      { actionId: "inspire", target: "ownExcludingSelfAndUsed", params: { n: 2 } },
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
  // 平凡スキル：平凡個体自体がまだ未実装（MONSTER_DATA/CHARACTER_DATAの
  // どちらにも「平凡個体」というdataIdは存在しない）ため、通常の行動
  // 選択肢には常に出さない。データ登録のみが目的で、実際の使用は平凡
  // 個体の実装時に別途対応する。
  if (module.mediocreOnly) return false;
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

// 補正なしの素の能力値（隊員本体のcomputeStatsの値そのまま）。上昇/
// 低下モジュール自身の判定用ダイス数（AおよびD）は必ずこちらを使う
// （補正の乗った能力値をさらに上昇/低下の強さに使うと、正の
// フィードバックループが起きてしまうため）。
function rawStat(unit, key) {
  return computeStats(unit.character)[key];
}

// 実効能力値：unit.correctionsに補正がかかっていればそれを加味した値。
// 上昇/低下モジュール自身の判定以外の全モジュール（攻撃/貫通攻撃/
// 回復/プロテクト/スマッシュ/継続回復/継続ダメージのダイス数）は
// こちらを使う。0未満にはしない（攻撃力だけは0だと成立しなくなって
// しまうため、最低値を1にする）。
function correctedStat(unit, key) {
  const c = unit.corrections[key];
  const floor = key === "attack" ? 1 : 0;
  return Math.max(floor, rawStat(unit, key) + (c ? c.sign * c.n : 0));
}

const BATTLE_STAT_KEYS = ["attack", "defence", "power", "wisdom", "sociality"];

// 5能力値の平均値（切り上げ、実効能力値ベース）。回復/割合回復/蘇生の
// 受動能力値（既定Mean）に使う。
function meanStat(unit) {
  return Math.ceil(BATTLE_STAT_KEYS.reduce((sum, key) => sum + correctedStat(unit, key), 0) / BATTLE_STAT_KEYS.length);
}

// 「NΔ」（三角数変換）: dice.jsのsuccessCountToRそのもの。名前の対応が
// 分かりにくいため、Δの意味で使う箇所はこちらのエイリアスを通す。
const triangular = successCountToR;

// 上昇/低下・プロテクト/スマッシュが共通して使う合成式：reversed=true
// （上昇・プロテクトなど支援系）は「a×(a+d)/a」、reversed=false（低下・
// スマッシュなど攻撃系）は「a×a/(a+d)」。aが0の時は式全体を0として扱う
// （0除算を避けつつ、「Aが0なら効果も0」という設計意図をそのまま表す）。
function correctionMagnitude(a, d, reversed) {
  if (a === 0) return 0;
  return reversed ? (a * (a + d)) / a : (a * a) / (a + d);
}

// 継続回復/継続ダメージ/継続割合回復/継続割合ダメージが共通して使う
// カスケード：AD（reversed=trueの継続回復系はA×(A+D)/A、falseの継続
// ダメージ系はA×A/(A+D)、切り上げ、Aが0なら0）はA/Dそのもの（ダイスを
// 振らない実効値）から求める。H＝Δ(ADのぶんd6を振った成功数)（下限1、
// これが持続ターン数）。h＝(H+bonus)d6合計（これが毎ターンの増減量の
// 元になる、対象のHPを「h/難易度」だけ動かす -- 呼び出し側で行う）。
function continuousCascade(actorValue, targetValue, reversed, bonus = 0) {
  const ad = actorValue === 0 ? 0 : reversed ? (actorValue * (actorValue + targetValue)) / actorValue : (actorValue * actorValue) / (actorValue + targetValue);
  const turns = triangular(rollJudgement(Math.max(0, Math.ceil(ad))).successCount);
  const magnitude = rollSum(Math.max(0, turns + bonus));
  return { turns, magnitude };
}

// 能力値補正の適用：同じ能力値に既存の補正があれば、強さ(n)を比較して
// n以上なら上書き、n未満なら不発（既存の補正はそのまま残る）。
function applyCorrection(target, statKey, n, sign, turns) {
  const existing = target.corrections[statKey];
  if (existing && n < existing.n) return { applied: false, statKey, n, sign, turns, existingN: existing.n };
  target.corrections[statKey] = { n, sign, turnsRemaining: turns };
  return { applied: true, statKey, n, sign, turns };
}

// 継続回復/継続ダメージ/継続割合回復/継続割合ダメージの適用：対象の
// HP継続効果は共有の単一枠なので、既存の効果（種別を問わず）と強さ
// (n)を比較して同じルールで上書きするか不発にする。
function applyContinuousStatus(target, n, type, turns) {
  const existing = target.continuousHp;
  if (existing && n < existing.n) return { applied: false, n, type, turns, existingN: existing.n };
  target.continuousHp = { n, type, turnsRemaining: turns };
  return { applied: true, n, type, turns };
}

const CONTINUOUS_EFFECT_LABELS = {
  heal: "継続回復",
  ratioHeal: "継続割合回復",
  damage: "継続ダメージ",
  ratioDamage: "継続割合ダメージ",
};
function continuousEffectLabel(type) {
  return CONTINUOUS_EFFECT_LABELS[type];
}

// 上昇/低下（旧・強化魔法/弱体化魔法）を対象ステータスごとに生成する
// ファクトリ。能動能力値(A)は常にその上昇/低下の対象と同じ能力値、
// 受動能力値(D)は上昇なら対象の協調性、低下なら対象の賢さに固定（どち
// らも必ずrawStat=補正なしを使う）。a=Δ(Ad6成功数)、d=Δ(Dd6成功数)、
// 「AD＝上昇ならa×(a+d)/a、低下ならa×a/(a+d)（切り上げ・下限1）」
// ターンの間、対象の能力値をN（既定1、ダイスは振らない）だけ上昇/
// 低下させる。params.aStat/dStatでスキル側が判定に使う能力値を上書き
// できる（例：ロリポップ・スパイラルの【安心のサポート】は判定を協調性
// で行う）。
function createCorrectionModule(id, label, statKey, sign, resistanceStatKey, shortNotation) {
  const reversed = sign > 0;
  return {
    id,
    label,
    targetFaction: sign > 0 ? "own" : "opposing",
    effect: "correction",
    shortNotation,
    // params.aValue：能動能力値を指定した数値に固定する（平凡スキルの
    // 「A:0」用 -- rawStat参照の代わりにこの数値をそのままダイス数に使う）。
    apply: (actor, target, params = {}) => {
      const { n = 1, aStat, dStat, aValue } = params;
      const a = triangular(rollJudgement(aValue ?? rawStat(actor, aStat ?? statKey)).successCount);
      const d = triangular(rollJudgement(rawStat(target, dStat ?? resistanceStatKey)).successCount);
      const turns = Math.max(1, Math.ceil(correctionMagnitude(a, d, reversed)));
      return applyCorrection(target, statKey, n, sign, turns);
    },
  };
}

const CORRECTION_MODULE_DEFS = [
  { statKey: "attack", statLabel: "攻撃力", shortStat: "攻", enhanceId: "enhanceAttack", weakenId: "weakenAttack" },
  { statKey: "defence", statLabel: "防御力", shortStat: "防", enhanceId: "enhanceDefence", weakenId: "weakenDefence" },
  { statKey: "power", statLabel: "破壊力", shortStat: "破", enhanceId: "enhancePower", weakenId: "weakenPower" },
  { statKey: "wisdom", statLabel: "賢さ", shortStat: "賢", enhanceId: "enhanceWisdom", weakenId: "weakenWisdom" },
  { statKey: "sociality", statLabel: "協調性", shortStat: "協", enhanceId: "enhanceSociality", weakenId: "weakenSociality" },
];

const CORRECTION_MODULES = {};
for (const { statKey, statLabel, shortStat, enhanceId, weakenId } of CORRECTION_MODULE_DEFS) {
  CORRECTION_MODULES[enhanceId] = createCorrectionModule(enhanceId, `${statLabel}上昇`, statKey, 1, "sociality", `M/${shortStat}∧`);
  CORRECTION_MODULES[weakenId] = createCorrectionModule(weakenId, `${statLabel}低下`, statKey, -1, "wisdom", `M/${shortStat}∨`);
}
// 【全能力値上昇】/【全能力値低下】：5種の上昇/低下を同じ対象へ順番に
// 適用する複合モジュール。対象選択はこのスキル自身の1回だけ（内部の
// 5ステップは対象未指定＝前と同じ対象を再利用する）。
CORRECTION_MODULES.enhanceAllStats = {
  id: "enhanceAllStats",
  label: "全能力値上昇",
  targetFaction: "own",
  shortNotation: "M/全能力∧",
  steps: CORRECTION_MODULE_DEFS.map(({ enhanceId }) => ({ actionId: enhanceId })),
};
CORRECTION_MODULES.weakenAllStats = {
  id: "weakenAllStats",
  label: "全能力値低下",
  targetFaction: "opposing",
  shortNotation: "M/全能力∨",
  steps: CORRECTION_MODULE_DEFS.map(({ weakenId }) => ({ actionId: weakenId })),
};

// 属性攻撃が付与する状態異常（強さ・発動確率）：モンスターのレベルに
// 応じて決まる（プレイヤーが直接選ぶ上昇/低下とは別枠 -- あちらはN=1
// 固定・発動確率100%のプレイヤー操作、こちらはモンスターのレベル依存
// で毎回変わる）。強さ=レベル÷10切り上げ、発動確率=レベル×状態異常
// 係数%（上限100%）。
function attributeDebuffN(actor) {
  return Math.ceil(actor.character.level / 10);
}
function attributeProcChance(actor) {
  return Math.min(1, (actor.character.level * STATUS_AILMENT_COEFFICIENT) / 100);
}

// 5能力値の属性攻撃デバフ（浸水～高温）：低下（createCorrectionModule）
// と全く同じ判定式（A=使用者自身の同名能力値、D=対象の賢さ、どちらも
// 補正なし・a×a/(a+d)の通常形）を使うが、強さ(n)は固定1ではなく
// attributeDebuffNから取る専用の葉モジュール。MAIN_MODULESには登録
// しない（プレイヤーが直接選べる項目ではなく、属性攻撃スキルの内部
// でだけ使うため）。
const ATTRIBUTE_STAT_KEYS = { soak: "attack", humidity: "defence", cold: "power", dry: "wisdom", heat: "sociality" };
function createAttributeStatDebuff(statKey) {
  return {
    effect: "correction",
    apply: (actor, target) => {
      const a = triangular(rollJudgement(rawStat(actor, statKey)).successCount);
      const d = triangular(rollJudgement(rawStat(target, "wisdom")).successCount);
      const turns = Math.max(1, Math.ceil(correctionMagnitude(a, d, false)));
      return applyCorrection(target, statKey, attributeDebuffN(actor), -1, turns);
    },
  };
}

// 時間(継続ダメージ)/腐敗(継続割合ダメージ)の属性攻撃デバフ。既存の
// dot/continuousRatioDamageと同じカスケード（continuousCascade、判定は
// actorの賢さ×対象の賢さ）を使うが、毎ターンの量(n)は固定パラメータ
// ではなくattributeDebuffNから取る。
function createAttributeContinuousDebuff(type) {
  return {
    effect: "continuous",
    apply: (actor, target) => {
      const turns = continuousCascade(correctedStat(actor, "wisdom"), correctedStat(target, "wisdom"), false);
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
    // params.aStat/dStat：能動/受動能力値の上書き（既定attack/defence）。
    // params.aValue：能動能力値そのものをrawStat参照ではなく指定した
    // 数値に固定する（平凡スキルの「A:0」用 -- 能力値に関係なく常に
    // その数値をダイス数として使う）。params.b：ボーナス（既定0）、
    // Bd6合計として攻撃力にそのまま加算。
    apply: (actor, target, params = {}) => {
      const a = rollSum(params.aValue ?? correctedStat(actor, params.aStat ?? "attack"));
      const d = rollSum(correctedStat(target, params.dStat ?? "defence"));
      const b = signedRollSum(params.b ?? 0);
      const c = Math.pow(state.battleTuning.staminaCorrectionMultiplier, -1 * target.stamina);
      const damage = Math.ceil(((a * a) / (a + d)) * c + b);
      applyHpDamage(target.character, damage);
      return { magnitude: damage, label: "ダメージ" };
    },
  },
  ratioAttack: {
    id: "ratioAttack",
    label: "割合攻撃",
    targetFaction: "opposing",
    effect: "hp",
    shortNotation: "M/割合攻撃",
    // 攻撃と同じ式で求めた値iを、対象の実効最大HPに対する「i/割合系
    // 難易度」%として減少させる（下限0）。
    apply: (actor, target, params = {}) => {
      const a = rollSum(correctedStat(actor, params.aStat ?? "attack"));
      const d = rollSum(correctedStat(target, params.dStat ?? "defence"));
      const b = signedRollSum(params.b ?? 0);
      const c = Math.pow(state.battleTuning.staminaCorrectionMultiplier, -1 * target.stamina);
      const i = ((a * a) / (a + d)) * c + b;
      const percent = Math.ceil(i / RATIO_DIFFICULTY);
      const damage = Math.ceil((computeEffectiveMaxHp(target.character) * percent) / 100);
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
    // params.aStat：能動能力値の上書き（既定attack）。params.dStat：
    // 受動能力値の上書き（既定attack -- 攻撃と違い、対象の防御力では
    // なく攻撃力に対して判定する）。受動側のダイス数は貫通係数で割る
    // （切り捨てず割り算の結果をそのまま使う。攻撃と同じ丸めは最後の
    // 切り上げでまとめて行う）。
    apply: (actor, target, params = {}) => {
      const a = rollSum(correctedStat(actor, params.aStat ?? "attack"));
      const d = rollSum(correctedStat(target, params.dStat ?? "attack"));
      const b = signedRollSum(params.b ?? 0);
      const c = Math.pow(state.battleTuning.staminaCorrectionMultiplier, -1 * target.stamina);
      const damage = Math.ceil(((a * a) / (a + d / PENETRATION_COEFFICIENT)) * c + b);
      applyHpDamage(target.character, damage);
      return { magnitude: damage, label: "ダメージ" };
    },
  },
  ratioPierceAttack: {
    id: "ratioPierceAttack",
    label: "割合貫通攻撃",
    targetFaction: "opposing",
    effect: "hp",
    shortNotation: "M/割合貫通攻撃",
    apply: (actor, target, params = {}) => {
      const a = rollSum(correctedStat(actor, params.aStat ?? "attack"));
      const d = rollSum(correctedStat(target, params.dStat ?? "attack"));
      const b = signedRollSum(params.b ?? 0);
      const c = Math.pow(state.battleTuning.staminaCorrectionMultiplier, -1 * target.stamina);
      const i = ((a * a) / (a + d / PENETRATION_COEFFICIENT)) * c + b;
      const percent = Math.ceil(i / RATIO_DIFFICULTY);
      const damage = Math.ceil((computeEffectiveMaxHp(target.character) * percent) / 100);
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
    // params.aStat：能動能力値の上書き（既定sociality）。params.dStat：
    // 受動能力値の上書き（既定Mean=対象の5能力値平均）。params.b：
    // ボーナス（既定0）、Bd6合計として回復力にそのまま加算 --【処方箋】
    // のような「回復力そのものを動的に増減させる」スキルが使う。
    // a×(a+d)/aは反転形なので、aが0（使用者の協調性が0）なら式全体を
    // 0として扱う（0除算を避けつつ、設計意図をそのまま表す）。
    apply: (actor, target, params = {}) => {
      const a = rollSum(correctedStat(actor, params.aStat ?? "sociality"));
      const d = rollSum(params.dStat ? correctedStat(target, params.dStat) : meanStat(target));
      const b = signedRollSum(params.b ?? 0);
      const healAmount = Math.max(0, Math.ceil((a === 0 ? 0 : (a * (a + d)) / a) + b));
      applyHpHeal(target.character, healAmount);
      return { magnitude: healAmount, label: "回復" };
    },
  },
  ratioHeal: {
    id: "ratioHeal",
    label: "割合回復",
    targetFaction: "own",
    effect: "hp",
    shortNotation: "M/割合回復",
    apply: (actor, target, params = {}) => {
      const a = rollSum(correctedStat(actor, params.aStat ?? "sociality"));
      const d = rollSum(params.dStat ? correctedStat(target, params.dStat) : meanStat(target));
      const b = signedRollSum(params.b ?? 0);
      const h = a === 0 ? 0 : (a * (a + d)) / a + b;
      const percent = Math.ceil(h / RATIO_DIFFICULTY);
      const healAmount = Math.ceil((computeEffectiveMaxHp(target.character) * percent) / 100);
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
    // params.aStat/dStat：能動/受動能力値の上書き（既定defence/defence）。
    // params.nb：数値ボーナス（既定0、ダイスは振らず結果にそのまま
    // 加算）。戻り値のmagnitudeは体幹の増加量（成功度合いそのもの）--
    // 【エコロジー】のような「直前のステップの結果を次のステップの
    // paramsが参照する」構成のために持たせる。
    // params.aValue：能動能力値を指定した数値に固定する（平凡スキルの
    // 「A:0」用）。
    apply: (actor, target, params = {}) => {
      const a = triangular(rollJudgement(params.aValue ?? correctedStat(actor, params.aStat ?? "defence")).successCount);
      const d = triangular(rollJudgement(correctedStat(target, params.dStat ?? "defence")).successCount);
      const x = Math.ceil(correctionMagnitude(a, d, true) + (params.nb ?? 0));
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
    // params.aStat/dStat：能動/受動能力値の上書き（既定power/power）。
    // params.aValue：能動能力値を指定した数値に固定する（平凡スキルの
    // 「A:0」用）。params.nb：数値ボーナス（既定0、ダイスは振らず結果に
    // そのまま加算）。戻り値のmagnitudeは体幹の減少量（プロテクトと同じ
    // 理由で持たせる）。
    apply: (actor, target, params = {}) => {
      const a = triangular(rollJudgement(params.aValue ?? correctedStat(actor, params.aStat ?? "power")).successCount);
      const d = triangular(rollJudgement(correctedStat(target, params.dStat ?? "power")).successCount);
      const x = Math.ceil(correctionMagnitude(a, d, false) + (params.nb ?? 0));
      target.stamina = clampStamina(target.stamina - x);
      return { magnitude: x, label: "体幹低下" };
    },
  },
  ...CORRECTION_MODULES,
  // 継続回復/継続ダメージ/継続割合回復/継続割合ダメージ共通：params.b
  // はボーナス（既定0、Hに足してh=(H+b)d6合計のダイス数に使う）。旧
  // 設計のparams.n（毎ターンの量を直接指定する固定値）を渡すスキルが
  // まだ残っているため、bが無ければnをボーナスとして扱う後方互換を
  // 残す（新規スキルはbだけを使えばよい）。
  // params.aValue：能動能力値を指定した数値に固定する（平凡スキルの
  // 「A:0」用）。
  regen: {
    id: "regen",
    label: "継続回復",
    targetFaction: "own",
    effect: "continuous",
    shortNotation: "M/継続回復",
    apply: (actor, target, params = {}) => {
      const { turns, magnitude } = continuousCascade(
        params.aValue ?? correctedStat(actor, params.aStat ?? "sociality"),
        correctedStat(target, params.dStat ?? "sociality"),
        true,
        params.b ?? params.n ?? 0
      );
      return applyContinuousStatus(target, magnitude, "heal", turns);
    },
  },
  ratioRegen: {
    id: "ratioRegen",
    label: "継続割合回復",
    targetFaction: "own",
    effect: "continuous",
    shortNotation: "M/継続割合回復",
    apply: (actor, target, params = {}) => {
      const { turns, magnitude } = continuousCascade(
        correctedStat(actor, params.aStat ?? "sociality"),
        correctedStat(target, params.dStat ?? "sociality"),
        true,
        params.b ?? params.n ?? 0
      );
      return applyContinuousStatus(target, magnitude, "ratioHeal", turns);
    },
  },
  revive: {
    id: "revive",
    label: "蘇生",
    targetFaction: "ownIncapacitated",
    effect: "revive",
    shortNotation: "M/蘇生",
    // A={User,Wisdom}、D={Target,Mean}の回復と同じh＝a×(a+d)/a+b
    // カスケード（aが0なら式全体を0）で求めた値の「h/蘇生難易度」%を
    // 実効最大HP基準で回復させ、戦闘不能から復帰させる。
    apply: (actor, target, params = {}) => {
      if (actor.faction === "enemy") return { applied: false };
      const a = rollSum(correctedStat(actor, params.aStat ?? "wisdom"));
      const d = rollSum(params.dStat ? correctedStat(target, params.dStat) : meanStat(target));
      const b = signedRollSum(params.b ?? 0);
      const h = a === 0 ? 0 : (a * (a + d)) / a + b;
      const percent = Math.ceil(h / REVIVE_DIFFICULTY);
      const healedHp = Math.min(computeEffectiveMaxHp(target.character), Math.ceil((computeEffectiveMaxHp(target.character) * percent) / 100));
      target.character.currentHp = healedHp;
      return { applied: true, healedHp };
    },
  },
  // params.aValue：能動能力値を指定した数値に固定する（平凡スキルの
  // 「A:0」用）。
  dot: {
    id: "dot",
    label: "継続ダメージ",
    targetFaction: "opposing",
    effect: "continuous",
    shortNotation: "M/継続ダメ",
    apply: (actor, target, params = {}) => {
      const { turns, magnitude } = continuousCascade(
        params.aValue ?? correctedStat(actor, params.aStat ?? "wisdom"),
        correctedStat(target, params.dStat ?? "wisdom"),
        false,
        params.b ?? params.n ?? 0
      );
      return applyContinuousStatus(target, magnitude, "damage", turns);
    },
  },
  continuousRatioDamage: {
    id: "continuousRatioDamage",
    label: "継続割合ダメージ",
    targetFaction: "opposing",
    effect: "continuous",
    shortNotation: "M/継続割合ダメ",
    apply: (actor, target, params = {}) => {
      const { turns, magnitude } = continuousCascade(
        correctedStat(actor, params.aStat ?? "wisdom"),
        correctedStat(target, params.dStat ?? "wisdom"),
        false,
        params.b ?? params.n ?? 0
      );
      return applyContinuousStatus(target, magnitude, "ratioDamage", turns);
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
    shortNotation: "M/2/攻撃t",
    steps: [{ actionId: "attack" }],
  },
  cry: {
    id: "cry",
    label: "鳴き声",
    targetFaction: "opposing",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/攻撃∨1t",
    steps: [{ actionId: "weakenAttack" }],
  },
  harden: {
    id: "harden",
    label: "固める",
    targetFaction: "self",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/防御∧1s",
    steps: [{ actionId: "enhanceDefence" }],
  },
  scratch: {
    id: "scratch",
    label: "引っ掻き",
    targetFaction: "opposing",
    cost: 2,
    monsterOnly: true,
    shortNotation: "M/2/貫通攻撃t",
    steps: [{ actionId: "pierceAttack" }],
  },
  electrocute: {
    id: "electrocute",
    label: "感電",
    targetFaction: "opposing",
    cost: 3,
    monsterOnly: true,
    shortNotation: "M/3/攻撃t+スマッシュc+破壊∨2c",
    steps: [{ actionId: "attack" }, { actionId: "smash" }, { actionId: "weakenPower", params: { n: 2 } }],
  },
  discharge: {
    id: "discharge",
    label: "放電",
    targetFaction: "opposing",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/破壊∨1t",
    steps: [{ actionId: "weakenPower" }],
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
    shortNotation: "M/2/継続回復2wu",
    steps: [{ actionId: "regen", params: { n: 2 } }],
  },
  // 【酸っぱい果実】：残りHPが最少の相手陣営1体を対象にする（甘い果実と
  // 同じhealTargetフラグを相手陣営側で使う -- 酸っぱい結実と同じ考え方）。
  sourFruit: {
    id: "sourFruit",
    label: "酸っぱい果実",
    targetFaction: "opposing",
    cost: 2,
    monsterOnly: true,
    healTarget: true,
    shortNotation: "M/2/継続ダメ2wt",
    steps: [{ actionId: "dot", params: { n: 2 } }],
  },
  tick: {
    id: "tick",
    label: "ティック",
    targetFaction: "opposing",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/攻撃t/賢/賢",
    steps: [{ actionId: "attack", params: { aStat: "wisdom", dStat: "wisdom" } }],
  },
  charge: {
    id: "charge",
    label: "突撃",
    targetFaction: "opposing",
    cost: 2,
    monsterOnly: true,
    shortNotation: "M/2/スマッシュt+攻撃c",
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
    shortNotation: "M/3/スマッシュt*",
    steps: [{ actionId: "smash", each: "opposing" }],
  },
  slam: {
    id: "slam",
    label: "スラム",
    targetFaction: "opposing",
    cost: 3,
    monsterOnly: true,
    shortNotation: "M/3/攻撃t+スマッシュc",
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
    shortNotation: "M/3/攻撃t(2)",
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
    shortNotation: "M/2/攻撃t#1",
    steps: [{ actionId: "attack" }, { actionId: "attack" }],
  },
  // 【見回り】：ラッシュと同じ構造（別対象へ2連続攻撃）だがコスト2。
  patrol: {
    id: "patrol",
    label: "見回り",
    targetFaction: "opposing",
    cost: 2,
    monsterOnly: true,
    shortNotation: "M/2/攻撃t(2)",
    steps: [{ actionId: "attack" }, { actionId: "attack", target: "opposingExcludingUsed" }],
  },
  // 【大回り】：見回りをさらに1体分延長し、計3体に順番に攻撃する。
  grandPatrol: {
    id: "grandPatrol",
    label: "大回り",
    targetFaction: "opposing",
    cost: 2,
    monsterOnly: true,
    shortNotation: "M/2/攻撃t(3)",
    steps: [
      { actionId: "attack" },
      { actionId: "attack", target: "opposingExcludingUsed" },
      { actionId: "attack", target: "opposingExcludingUsed" },
    ],
  },
  // 【泣き声】：【鳴き声】(攻撃力低下(1))の強さ違い。
  whimper: {
    id: "whimper",
    label: "泣き声",
    targetFaction: "opposing",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/攻撃∨2t",
    steps: [{ actionId: "weakenAttack", params: { n: 2 } }],
  },
  // 【懐き声】：相手陣営1体に防御力低下(2)をかける。
  fawn: {
    id: "fawn",
    label: "懐き声",
    targetFaction: "opposing",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/防御∨2t",
    steps: [{ actionId: "weakenDefence", params: { n: 2 } }],
  },
  // 【遠吠え】：自陣営1体に攻撃力上昇(2)をかける。
  howl: {
    id: "howl",
    label: "遠吠え",
    targetFaction: "own",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/攻撃∧2u",
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
    shortNotation: "M/2/貫通攻撃t(2)",
    steps: [{ actionId: "pierceAttack" }, { actionId: "pierceAttack", target: "opposingExcludingUsed" }],
  },
  // 【歌い声】/【招き声】：攻撃力低下をかけた後、自身に攻撃力上昇を
  // かける。
  serenade: {
    id: "serenade",
    label: "歌い声",
    targetFaction: "opposing",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/攻撃∨2t+攻撃∧1s",
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
    shortNotation: "M/2/攻撃∨3t+攻撃∧2s",
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
    shortNotation: "M/1/スマッシュt",
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
    shortNotation: "M/1/[体幹-2]t+[体幹+2]s",
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
    shortNotation: "M/2/攻撃t+スマッシュc",
    steps: [{ actionId: "attack" }, { actionId: "smash" }],
  },
  headOnCollision: {
    id: "headOnCollision",
    label: "正面衝突",
    targetFaction: "opposing",
    cost: 2,
    monsterOnly: true,
    shortNotation: "M/2/攻撃t+スマッシュc#1",
    steps: [{ actionId: "attack" }, { actionId: "smash" }, { actionId: "smash" }],
  },
  fortify: {
    id: "fortify",
    label: "固め上げる",
    targetFaction: "ownExcludingSelf",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/防御∧2es",
    steps: [
      { actionId: "enhanceDefence", params: { n: 2 } },
      { actionId: "enhanceDefence", params: { n: 2 }, target: "self" },
    ],
  },
  // 【固め連ねる】：自陣営全員に防御力上昇(3)。スプレッドシートの最短
  // 表記は「M/2/防御∧3u」（末尾の全員マーカー*が抜けている）だが、詳細
  // 文が明確に「自陣営全員」としているため、他の全員対象スキルと同じ
  // *付きの表記に揃えている（ユーザーへの確認事項）。
  fortifyAll: {
    id: "fortifyAll",
    label: "固め連ねる",
    targetFaction: "none",
    cost: 2,
    monsterOnly: true,
    shortNotation: "M/2/防御∧3u*",
    steps: [{ actionId: "enhanceDefence", params: { n: 3 }, each: "own" }],
  },
  // ユキドケイ系統の上位個体用スキル。
  avalanche: {
    id: "avalanche",
    label: "雪崩",
    targetFaction: "none",
    cost: 2,
    monsterOnly: true,
    shortNotation: "M/2/スマッシュt*",
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
    shortNotation: "M/1/継続ダメ[ターン/2]t*",
    steps: [{ actionId: "dot", each: "opposing", params: (unit, targetUnit, pools) => ({ n: Math.ceil(pools.turn / 2) }) }],
  },
  countUp: {
    id: "countUp",
    label: "カウントアップ",
    targetFaction: "none",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/継続回復[ターン/3]u*",
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
    shortNotation: "M/3/スマッシュt(2)+攻撃c",
    steps: [{ actionId: "charge" }, { actionId: "charge", target: "opposingExcludingUsed" }],
  },
  // 【呪詛】：相手陣営1体に賢さ低下(3)、協調性低下(3)を順にかける
  // （同一対象）。
  curse: {
    id: "curse",
    label: "呪詛",
    targetFaction: "opposing",
    cost: 3,
    monsterOnly: true,
    shortNotation: "M/3/賢さ∨3t+協調∨3c",
    steps: [
      { actionId: "weakenWisdom", params: { n: 3 } },
      { actionId: "weakenSociality", params: { n: 3 } },
    ],
  },
  // 【当身】：素のスマッシュをコスト1で使う。
  counterStrike: {
    id: "counterStrike",
    label: "当身",
    targetFaction: "opposing",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/スマッシュt",
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
    shortNotation: "M/2/プロテクトes",
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
    shortNotation: "M/2/回復wu#1",
    steps: [{ actionId: "heal" }, { actionId: "heal" }],
  },
  // 【補給】：自陣営全員に継続回復(3)を付与する。
  supply: {
    id: "supply",
    label: "補給",
    targetFaction: "none",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/継続回復3u*",
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
    shortNotation: "M/3/[高い能力値を強化]5e",
    apply: (actor, target, params = {}) => {
      const { n = 5 } = params;
      const statKeys = ["attack", "defence", "power", "wisdom", "sociality"];
      const values = statKeys.map((key) => rawStat(target, key));
      const max = Math.max(...values);
      const tied = statKeys.filter((key, i) => values[i] === max);
      const statKey = pickRandom(tied);
      const { successCount } = rollJudgement(rawStat(actor, "sociality"));
      const turns = successCountToR(successCount);
      return applyCorrection(target, statKey, n, 1, turns);
    },
  },
  // フルーツリー系統の上位個体用スキル。
  // 【甘い結実】【酸っぱい結実】：甘い果実/酸っぱい果実（継続効果）の
  // 単発版。healTargetは対象を残りHPが最も少ない1体に固定するフラグ
  // （酸っぱい結実は相手陣営に対して使うが、フラグ自体はcandidateUnits
  // の絞り込み結果から最小HPを選ぶだけで陣営を問わないため、そのまま
  // 流用できる）。
  sweetFruition: {
    id: "sweetFruition",
    label: "甘い結実",
    targetFaction: "own",
    cost: 1,
    monsterOnly: true,
    healTarget: true,
    shortNotation: "M/1/回復wu",
    steps: [{ actionId: "heal" }],
  },
  sourFruition: {
    id: "sourFruition",
    label: "酸っぱい結実",
    targetFaction: "opposing",
    cost: 1,
    monsterOnly: true,
    healTarget: true,
    shortNotation: "M/1/攻撃wt",
    steps: [{ actionId: "attack" }],
  },
  // 【熟れすぎた結末】：相手陣営1体に5能力値すべての弱体化魔法(3)を
  // 順にかける。
  overripeEnd: {
    id: "overripeEnd",
    label: "熟れすぎた結末",
    targetFaction: "opposing",
    cost: 3,
    monsterOnly: true,
    shortNotation: "M/3/全能力∨3t",
    steps: [
      { actionId: "weakenAttack", params: { n: 3 } },
      { actionId: "weakenDefence", params: { n: 3 } },
      { actionId: "weakenPower", params: { n: 3 } },
      { actionId: "weakenWisdom", params: { n: 3 } },
      { actionId: "weakenSociality", params: { n: 3 } },
    ],
  },
  // 【虫の湧いた結末】：相手陣営1体に継続ダメージ(6)を付与した後、
  // （別の）相手陣営2体にも順に継続ダメージ(6)を付与する。
  infestedEnd: {
    id: "infestedEnd",
    label: "虫の湧いた結末",
    targetFaction: "opposing",
    cost: 3,
    monsterOnly: true,
    shortNotation: "M/3/継続ダメ6t(3)",
    steps: [
      { actionId: "dot", params: { n: 6 } },
      { actionId: "dot", params: { n: 6 }, target: "opposingExcludingUsed" },
      { actionId: "dot", params: { n: 6 }, target: "opposingExcludingUsed" },
    ],
  },
  // 【腐りかけの結末】：相手陣営1体に攻撃を4回連続で行う（ロッテンツリー
  // は属性：腐敗を持つため、既存のattributeAttack_decay差し替えにより
  // 実際には腐敗属性の攻撃4回になる -- 電気ゼリー等と同じ既存の属性攻撃
  // 差し替え機構をそのまま使う。runSteps内のapplyLeafWithAttributeSwap参照）。
  rottingEnd: {
    id: "rottingEnd",
    label: "腐りかけの結末",
    targetFaction: "opposing",
    cost: 3,
    monsterOnly: true,
    shortNotation: "M/3/攻撃t#3",
    steps: [{ actionId: "attack" }, { actionId: "attack" }, { actionId: "attack" }, { actionId: "attack" }],
  },
  // チューイング・マシン系統の上位個体用スキル。【ティック】→【タック】
  // →【トー】の順にしか使えない前提スキル。requiresPriorActionIdsは
  // サニーサイドアップと同じ仕組みで、「直前に自分が使った技の中に
  // 含まれていた葉アクションid」を見る -- 【タック】はティックの葉
  // アクション（攻撃、id:"attack"）の直後だけ、【トー】はタックの葉
  // アクション（スマッシュ、id:"smash"）の直後だけ選択可能になる。
  // ただしこのゲート自体はisModuleAvailableFor（隊員のプレイヤー選択
  // 用）にしか元々存在しなかったため、モンスターの所持スキル選択
  // （chooseMonsterSkillEntry）側にも同じゲートを追加する必要がある
  // -- そちらを参照。
  tack: {
    id: "tack",
    label: "タック",
    targetFaction: "opposing",
    cost: 1,
    monsterOnly: true,
    requiresPriorActionIds: ["attack"],
    shortNotation: "M/1/?スマッシュt/賢/賢",
    steps: [{ actionId: "smash", params: { aStat: "wisdom", dStat: "wisdom" } }],
  },
  toh: {
    id: "toh",
    label: "トー",
    targetFaction: "opposing",
    cost: 1,
    monsterOnly: true,
    requiresPriorActionIds: ["smash"],
    shortNotation: "M/1/?貫通攻撃t#1/賢/賢",
    steps: [
      { actionId: "pierceAttack", params: { aStat: "wisdom", dStat: "wisdom" } },
      { actionId: "pierceAttack", params: { aStat: "wisdom", dStat: "wisdom" } },
    ],
  },
  // 電気ゼリー系統の上位個体用スキル。【感電】(攻撃+スマッシュ+弱体化魔法
  // (破壊力)(2))の弱体化対象違い。
  pillarOfFire: {
    id: "pillarOfFire",
    label: "火柱",
    targetFaction: "opposing",
    cost: 3,
    monsterOnly: true,
    shortNotation: "M/3/攻撃t+スマッシュc+協調∨2c",
    steps: [{ actionId: "attack" }, { actionId: "smash" }, { actionId: "weakenSociality", params: { n: 2 } }],
  },
  cumulus: {
    id: "cumulus",
    label: "積雲",
    targetFaction: "opposing",
    cost: 3,
    monsterOnly: true,
    shortNotation: "M/3/攻撃t+スマッシュc+防御∨4c",
    steps: [{ actionId: "attack" }, { actionId: "smash" }, { actionId: "weakenDefence", params: { n: 4 } }],
  },
  sandstorm: {
    id: "sandstorm",
    label: "砂嵐",
    targetFaction: "opposing",
    cost: 3,
    monsterOnly: true,
    shortNotation: "M/3/攻撃t+スマッシュc+賢さ∨4c",
    steps: [{ actionId: "attack" }, { actionId: "smash" }, { actionId: "weakenWisdom", params: { n: 4 } }],
  },
  // 【放電】(破壊力低下(1))の弱体化対象違い。
  residualHeat: {
    id: "residualHeat",
    label: "余熱",
    targetFaction: "opposing",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/協調∨1t",
    steps: [{ actionId: "weakenSociality" }],
  },
  cottonCloud: {
    id: "cottonCloud",
    label: "綿雲",
    targetFaction: "opposing",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/防御∨2t",
    steps: [{ actionId: "weakenDefence", params: { n: 2 } }],
  },
  sandDust: {
    id: "sandDust",
    label: "砂埃",
    targetFaction: "opposing",
    cost: 1,
    monsterOnly: true,
    shortNotation: "M/1/賢さ∨2t",
    steps: [{ actionId: "weakenWisdom", params: { n: 2 } }],
  },
  // タケニニテイル系統（ボス）の上位個体用スキル。超純粋強化路線 --
  // 【スラム】/【ラッシュ】の規模を大きくしただけ。
  // 【ビッグスラム】【グランドスラム】：スラム(攻撃+スマッシュ)にスマッ
  // シュを1回・2回追加した強さ違い。
  bigSlam: {
    id: "bigSlam",
    label: "ビッグスラム",
    targetFaction: "opposing",
    cost: 3,
    monsterOnly: true,
    shortNotation: "M/3/攻撃t+スマッシュc#1",
    steps: [{ actionId: "attack" }, { actionId: "smash" }, { actionId: "smash" }],
  },
  grandSlam: {
    id: "grandSlam",
    label: "グランドスラム",
    targetFaction: "opposing",
    cost: 4,
    monsterOnly: true,
    shortNotation: "M/4/攻撃t+スマッシュc#2",
    steps: [{ actionId: "attack" }, { actionId: "smash" }, { actionId: "smash" }, { actionId: "smash" }],
  },
  // 【スーパーラッシュ】：ラッシュ(攻撃を対象違いで2回)の対象数を4体に
  // 増やした強さ違い（相手陣営の生存数がそれ未満なら、対象が尽きた
  // ステップ以降は不発になる -- opposingExcludingUsedの既存の挙動通り）。
  superRush: {
    id: "superRush",
    label: "スーパーラッシュ",
    targetFaction: "opposing",
    cost: 4,
    monsterOnly: true,
    shortNotation: "M/4/攻撃t(4)",
    steps: [
      { actionId: "attack" },
      { actionId: "attack", target: "opposingExcludingUsed" },
      { actionId: "attack", target: "opposingExcludingUsed" },
      { actionId: "attack", target: "opposingExcludingUsed" },
    ],
  },
  // 【ハイパーラッシュ】：コスト全消費。まず選択した相手陣営1体に攻撃を
  // 行い、その後「このスキルに使った残りPT全額-1」回、その都度ランダム
  // に選び直した相手陣営1体へ攻撃を繰り返す。攻撃回数自体が実行時の
  // 残りPTという実行時の値で決まり、固定回数のstepsでは表現できないため
  // custom resolver（resolveHyperRush）で処理する -- シェアカットと同じ
  // 「毎回選び直す、対象の除外管理はしない」簡略版。
  hyperRush: {
    id: "hyperRush",
    label: "ハイパーラッシュ",
    targetFaction: "opposing",
    cost: "all",
    monsterOnly: true,
    shortNotation: "M/r/攻撃0?(r)",
    custom: "hyperRush",
  },
});

// 平凡スキル・Mainフェイズ。全て「A:0」（能動能力値をrawStat/corrected
// Stat参照ではなく数値0に固定する）を使う -- 対応するleafモジュール
// 側にparams.aValueという専用の上書き経路を用意した（attack/protect/
// smash/dot/regen/createCorrectionModule参照）。mediocreOnly:trueで
// isModuleAvailableForが常に不可としているため、現時点ではどのユニット
// からも選べない（Prep側の【ステップ】【トラップ】と同じ理由）。
Object.assign(MAIN_MODULES, {
  mediocreAttack: {
    id: "mediocreAttack",
    label: "アタック",
    targetFaction: "opposing",
    cost: 1,
    mediocreOnly: true,
    shortNotation: "M/攻撃1t/0",
    steps: [{ actionId: "attack", params: { aValue: 0, b: 1 } }],
  },
  mediocreGuard: {
    id: "mediocreGuard",
    label: "ガード",
    targetFaction: "self",
    cost: 1,
    mediocreOnly: true,
    shortNotation: "M/プロテクト1s/0",
    steps: [{ actionId: "protect", params: { aValue: 0, nb: 1 } }],
  },
  mediocreBreak: {
    id: "mediocreBreak",
    label: "ブレイク",
    targetFaction: "opposing",
    cost: 1,
    mediocreOnly: true,
    shortNotation: "M/スマッシュ1t/0",
    steps: [{ actionId: "smash", params: { aValue: 0, nb: 1 } }],
  },
  mediocrePot: {
    id: "mediocrePot",
    label: "ポット",
    targetFaction: "opposing",
    cost: 1,
    mediocreOnly: true,
    shortNotation: "M/継続ダメ1t/0",
    steps: [{ actionId: "dot", params: { aValue: 0, b: 1 } }],
  },
  mediocreHeal: {
    id: "mediocreHeal",
    label: "ヒール",
    targetFaction: "own",
    cost: 1,
    mediocreOnly: true,
    shortNotation: "M/継続回復1u/0",
    steps: [{ actionId: "regen", params: { aValue: 0, b: 1 } }],
  },
  attackRaise: {
    id: "attackRaise",
    label: "トウドレイズ",
    targetFaction: "own",
    cost: 1,
    mediocreOnly: true,
    shortNotation: "M/攻撃∧1u/0",
    steps: [{ actionId: "enhanceAttack", params: { aValue: 0, n: 1 } }],
  },
  defenceRaise: {
    id: "defenceRaise",
    label: "ヒフクレイズ",
    targetFaction: "own",
    cost: 1,
    mediocreOnly: true,
    shortNotation: "M/防御∧1u/0",
    steps: [{ actionId: "enhanceDefence", params: { aValue: 0, n: 1 } }],
  },
  powerRaise: {
    id: "powerRaise",
    label: "シゲキレイズ",
    targetFaction: "own",
    cost: 1,
    mediocreOnly: true,
    shortNotation: "M/破壊∧1u/0",
    steps: [{ actionId: "enhancePower", params: { aValue: 0, n: 1 } }],
  },
  wisdomRaise: {
    id: "wisdomRaise",
    label: "フクミレイズ",
    targetFaction: "own",
    cost: 1,
    mediocreOnly: true,
    shortNotation: "M/賢さ∧1u/0",
    steps: [{ actionId: "enhanceWisdom", params: { aValue: 0, n: 1 } }],
  },
  socialityRaise: {
    id: "socialityRaise",
    label: "カオリレイズ",
    targetFaction: "own",
    cost: 1,
    mediocreOnly: true,
    shortNotation: "M/協調∧1u/0",
    steps: [{ actionId: "enhanceSociality", params: { aValue: 0, n: 1 } }],
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
      const d = rollSum(correctedStat(target, params.dStat ?? "defence"));
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
    steps: [{ actionId: "protect" }, { actionId: "enhanceDefence", params: { n: 2 } }],
  },
  // 【守りの掟】：守りの手（プロテクト+強化魔法(防御力)(2)）を自身以外
  // の自陣営1体に行った後、自身にも同じく行う。守りの手自体をnested
  // reference（【鉄槌】と同じ構造）として2回使うことで、「1つの対象に
  // まとめて2効果」を1ステップで済ませる -- 守りの手自身のcostはここ
  // では参照されない。
  protectiveCode: {
    id: "protectiveCode",
    label: "守りの掟",
    targetFaction: "ownExcludingSelf",
    cost: 2,
    allyOnly: true,
    shortNotation: "M/2/プロテクト+*2",
    steps: [{ actionId: "guardingHand" }, { actionId: "guardingHand", target: "self" }],
  },
  // 【守りの原点】：守りの手を自身以外の自陣営2体（ownExcludingSelfAndUsed
  // で2体目を選出）に行った後、自身にはプロテクトを2回、強化魔法(防御力)
  // (4)を1回行う（自身の分だけ守りの手と異なる配分のため、こちらは
  // nested referenceを使わず葉アクションを直接並べる）。
  protectiveOrigin: {
    id: "protectiveOrigin",
    label: "守りの原点",
    targetFaction: "ownExcludingSelf",
    cost: 3,
    allyOnly: true,
    shortNotation: "M/3/プロテクト+*3",
    steps: [
      { actionId: "guardingHand" },
      { actionId: "guardingHand", target: "ownExcludingSelfAndUsed" },
      { actionId: "protect", target: "self" },
      { actionId: "protect", target: "self" },
      { actionId: "enhanceDefence", params: { n: 4 }, target: "self" },
    ],
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
  // 【攻めの術】：攻めの手の「釘付けなら追加」を貫通攻撃2回に強化。
  attackingArt: {
    id: "attackingArt",
    label: "攻めの術",
    targetFaction: "opposing",
    cost: 2,
    allyOnly: true,
    shortNotation: "M/2/攻撃++",
    steps: [
      { actionId: "attack" },
      { actionId: "pierceAttack", chance: (unit, targetUnit) => (targetUnit.pinnedBy ? 1 : 0) },
      { actionId: "pierceAttack", chance: (unit, targetUnit) => (targetUnit.pinnedBy ? 1 : 0) },
    ],
  },
  // 【攻めの最果】：攻めの術（攻撃+釘付け時貫通攻撃2回）を別々の相手
  // 陣営2体に対して行う。nested referenceで2回使う -- 2回目は
  // opposingExcludingUsedで別対象を選び、そのchance判定もnested先の
  // targetUnit（=このステップで選ばれた対象）を正しく参照する。
  attackingFrontier: {
    id: "attackingFrontier",
    label: "攻めの最果",
    targetFaction: "opposing",
    cost: 3,
    allyOnly: true,
    shortNotation: "M/3/攻撃++*2",
    steps: [{ actionId: "attackingArt" }, { actionId: "attackingArt", target: "opposingExcludingUsed" }],
  },
  // 【ハニービート】：相手陣営1体にスマッシュ、攻撃を順に行う（ハニー
  // ビービートの弱化版、成長前の初期修得スキル）。
  honeyBeat: {
    id: "honeyBeat",
    label: "ハニービート",
    targetFaction: "opposing",
    cost: 2,
    allyOnly: true,
    shortNotation: "M/2/スマッシュ+",
    steps: [{ actionId: "smash" }, { actionId: "attack" }],
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
  // 【ハニービーストビート】：コスト全消費。相手陣営1体に、スマッシュを
  // 「消費したPT-1」回行い、その後同じ対象に攻撃を行う。回数自体が
  // 実行時の支払いPT（unit.lastActionCost）という値で決まり、固定回数
  // のstepsでは表現できないためcustom resolver（resolveHoneyBeastBeat）
  // で処理する。スマッシュは体幹のみを操作しHPを減らさないため、途中で
  // 対象が戦闘不能になる心配はない。
  honeyBeastBeat: {
    id: "honeyBeastBeat",
    label: "ハニービーストビート",
    targetFaction: "opposing",
    cost: "all",
    allyOnly: true,
    shortNotation: "M/r/スマッシュ*r+攻撃",
    custom: "honeyBeastBeat",
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
  // 【ミルクフィール】/【ホワイトフィール】：ビターフィールの成長後
  // スキル、賢さ<協調性の場合の分岐先。相手ではなく自陣営1体に継続
  // 回復をかける（狙いを攻撃から支援へ転換）。自身への継続ダメージの
  // 自傷は据え置き。この賢さ/協調性による分岐そのものは、今はまだ実装
  // しないレベルアップ時のスキル習得システム側の仕事（ここではどちらの
  // 系列も等しくデータとして登録するだけ）。
  milkFeel: {
    id: "milkFeel",
    label: "ミルクフィール",
    targetFaction: "own",
    cost: 2,
    allyOnly: true,
    shortNotation: "M/2/継続回復8+",
    steps: [{ actionId: "regen", params: { n: 8 } }, { actionId: "dot", target: "self", params: { n: 4 } }],
  },
  whiteFeel: {
    id: "whiteFeel",
    label: "ホワイトフィール",
    targetFaction: "own",
    cost: 3,
    allyOnly: true,
    shortNotation: "M/3/継続回復12+",
    steps: [{ actionId: "regen", params: { n: 12 } }, { actionId: "dot", target: "self", params: { n: 6 } }],
  },
  // 【カカオフィール】/【ブラックフィール】：ビターフィールの成長後
  // スキル、賢さ≧協調性の場合の分岐先。相手陣営への継続ダメージ路線を
  // そのまま強化する。
  cacaoFeel: {
    id: "cacaoFeel",
    label: "カカオフィール",
    targetFaction: "opposing",
    cost: 2,
    allyOnly: true,
    shortNotation: "M/2/継続ダメ8+",
    steps: [{ actionId: "dot", params: { n: 8 } }, { actionId: "dot", target: "self", params: { n: 4 } }],
  },
  blackFeel: {
    id: "blackFeel",
    label: "ブラックフィール",
    targetFaction: "opposing",
    cost: 3,
    allyOnly: true,
    shortNotation: "M/3/継続ダメ12+",
    steps: [{ actionId: "dot", params: { n: 12 } }, { actionId: "dot", target: "self", params: { n: 6 } }],
  },
  // 【安心のサポート】：完璧なサポートの弱化版（成長前の初期修得
  // スキル）。判定に使う能動能力値を協調性に上書きする点は同じ。
  supportComfort: {
    id: "supportComfort",
    label: "安心のサポート",
    targetFaction: "opposing",
    cost: 2,
    allyOnly: true,
    shortNotation: "M/2/弱体化(攻防)2/協",
    steps: [
      { actionId: "weakenAttack", params: { n: 2, aStat: "sociality" } },
      { actionId: "weakenDefence", params: { n: 2, aStat: "sociality" } },
    ],
  },
  // 【完璧なサポート】：相手陣営1体に弱体化魔法(攻撃力)(4)、
  // 弱体化魔法(防御力)(4)を順に行う。判定に使う能動能力値は（弱体化
  // 魔法の既定である賢さではなく）協調性に上書きする -- ロリポップ・
  // スパイラルの課題（協調性の成長が彼女の技のどれからも参照されて
  // いなかった）への回答として、Stage0のcreateCorrectionModule.
  // params.aStat拡張をそのまま使う。安心のサポートが初期修得スキルへ
  // 降格したのに伴い、n:3→4に微強化。
  perfectSupport: {
    id: "perfectSupport",
    label: "完璧なサポート",
    targetFaction: "opposing",
    cost: 3,
    allyOnly: true,
    shortNotation: "M/3/弱体化(攻防)4/協",
    steps: [
      { actionId: "weakenAttack", params: { n: 4, aStat: "sociality" } },
      { actionId: "weakenDefence", params: { n: 4, aStat: "sociality" } },
    ],
  },
  // 【伝説のサポート】：完璧なサポートのさらなる強さ違い（n:7）。
  legendarySupport: {
    id: "legendarySupport",
    label: "伝説のサポート",
    targetFaction: "opposing",
    cost: 4,
    allyOnly: true,
    shortNotation: "M/4/弱体化(攻防)7/協",
    steps: [
      { actionId: "weakenAttack", params: { n: 7, aStat: "sociality" } },
      { actionId: "weakenDefence", params: { n: 7, aStat: "sociality" } },
    ],
  },
  // 【フラッシュ】：相手陣営1体に攻撃を行った後、他の相手陣営2体に
  // それぞれ攻撃を行い、最後に自身にも攻撃を行う（反動ダメージ）。
  // 旧来のフラッシュ（相手陣営全員+自身）はＳ・フラッシュ（ストレート
  // フラッシュ、id:straightFlush）へ格上げされ、代わりにこちらが初期
  // 修得スキルとして弱体化（全員ではなく固定3体）した版になった。
  // 読み方に合わせて、フラッシュ系統3体のidはトランプ役と同じ
  // flush/straightFlush/royalStraightFlushで揃えている。
  flush: {
    id: "flush",
    label: "フラッシュ",
    targetFaction: "opposing",
    cost: 4,
    allyOnly: true,
    shortNotation: "M/4/攻撃3+s",
    steps: [
      { actionId: "attack" },
      { actionId: "attack", target: "opposingExcludingUsed" },
      { actionId: "attack", target: "opposingExcludingUsed" },
      { actionId: "attack", target: "self" },
    ],
  },
  // 【Ｓ・フラッシュ】（ストレートフラッシュ）：旧来のフラッシュの効果
  // そのもの（相手陣営全員に攻撃した後、自身にも攻撃）。
  // targetFaction:"none"のため対象候補の選択自体が不要 -- 最初のstepの
  // each:"opposing"が相手陣営全員を、2番目のstepは（何も指定しなくても
  // 既にactor自身を指す既定のtargetUnitのまま）自身を対象にする。
  straightFlush: {
    id: "straightFlush",
    label: "Ｓ・フラッシュ",
    targetFaction: "none",
    cost: 4,
    allyOnly: true,
    shortNotation: "M/4/攻撃*+s",
    steps: [{ actionId: "attack", each: "opposing" }, { actionId: "attack" }],
  },
  // 【Ｒ・Ｓ・フラッシュ】（ロイヤルストレートフラッシュ）：Ｓ・
  // フラッシュの全員攻撃・自傷をそれぞれ2回に強化。
  royalStraightFlush: {
    id: "royalStraightFlush",
    label: "Ｒ・Ｓ・フラッシュ",
    targetFaction: "none",
    cost: 5,
    allyOnly: true,
    shortNotation: "M/5/攻撃*2+s2",
    steps: [
      { actionId: "attack", each: "opposing" },
      { actionId: "attack", each: "opposing" },
      { actionId: "attack" },
      { actionId: "attack" },
    ],
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
  // 【処方論】：処方箋の回復対象を自陣営2体に増やす。2体目はownExcludingUsed
  // （自分自身も、まだ使われていなければ引き続き候補になり得る）。
  // 2体それぞれが独立に「消費したPT-3」の恩恵を受ける（PT自体は最初の
  // 支払いで1回しか消費しないので、回復力の加算だけが2体ぶん効く）。
  prescriptionTheory: {
    id: "prescriptionTheory",
    label: "処方論",
    targetFaction: "own",
    cost: "all",
    allyOnly: true,
    shortNotation: "M/r/回復r+",
    steps: [
      { actionId: "heal", params: (unit) => ({ b: unit.lastActionCost - 3 }) },
      { actionId: "heal", target: "ownExcludingUsed", params: (unit) => ({ b: unit.lastActionCost - 3 }) },
    ],
  },
  // 【証明】：処方論の回復対象を自陣営全員に拡張。全員が同じ動的な
  // 加算を受けるだけなので、こちらは素直にeach:"own"で表現できる。
  proof: {
    id: "proof",
    label: "証明",
    targetFaction: "none",
    cost: "all",
    allyOnly: true,
    shortNotation: "M/r/回復r*",
    steps: [{ actionId: "heal", each: "own", params: (unit) => ({ b: unit.lastActionCost - 3 }) }],
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
  // weakenAttack/weakenPower/weakenDefenceそれぞれの既定（賢さ）
  // のまま上書きしない。
  hornBreak: {
    id: "hornBreak",
    label: "ホーンブレイク",
    targetFaction: "opposing",
    cost: "all",
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "M/r/攻撃t+攻撃∨rc",
    steps: [{ actionId: "attack" }, { actionId: "weakenAttack", params: (unit) => ({ n: unit.lastActionCost }) }],
  },
  // 【ホーンブレイク＋】：固定コスト2に変わり、攻撃・攻撃力低下(5)
  // どちらの判定もA/D両方を攻撃力に上書きする（能動側は元々攻撃力の
  // ままだが、受動側の防御力/賢さもここでは攻撃力に変える -- 相手の
  // 攻撃力そのものと殴り合う専門特化）。
  hornBreakPlus: {
    id: "hornBreakPlus",
    label: "ホーンブレイク＋",
    targetFaction: "opposing",
    cost: 2,
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "M/2/攻撃t+攻撃∨5c/攻/攻",
    steps: [
      { actionId: "attack", params: { aStat: "attack", dStat: "attack" } },
      { actionId: "weakenAttack", params: { n: 5, aStat: "attack", dStat: "attack" } },
    ],
  },
  iceBreak: {
    id: "iceBreak",
    label: "アイスブレイク",
    targetFaction: "opposing",
    cost: "all",
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "M/r/攻撃t+破壊∨rc",
    steps: [{ actionId: "attack" }, { actionId: "weakenPower", params: (unit) => ({ n: unit.lastActionCost }) }],
  },
  iceBreakPlus: {
    id: "iceBreakPlus",
    label: "アイスブレイク＋",
    targetFaction: "opposing",
    cost: 2,
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "M/2/攻撃t+破壊∨5c/破/破",
    steps: [
      { actionId: "attack", params: { aStat: "power", dStat: "power" } },
      { actionId: "weakenPower", params: { n: 5, aStat: "power", dStat: "power" } },
    ],
  },
  shellBreak: {
    id: "shellBreak",
    label: "シェルブレイク",
    targetFaction: "opposing",
    cost: "all",
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "M/r/攻撃t+防御∨rc",
    steps: [{ actionId: "attack" }, { actionId: "weakenDefence", params: (unit) => ({ n: unit.lastActionCost }) }],
  },
  shellBreakPlus: {
    id: "shellBreakPlus",
    label: "シェルブレイク＋",
    targetFaction: "opposing",
    cost: 2,
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "M/2/攻撃t+防御∨5c/防/防",
    steps: [
      { actionId: "attack", params: { aStat: "defence", dStat: "defence" } },
      { actionId: "weakenDefence", params: { n: 5, aStat: "defence", dStat: "defence" } },
    ],
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
    shortNotation: "M/2/攻撃t/協",
    steps: [{ actionId: "attack", params: { aStat: "sociality" } }],
  },
  // 【サプライズ＋】：受動能力値も協調性に上書きし（対象の協調性で
  // 受け止める）、さらにボーナス+3を乗せた強化版。
  surprisePlus: {
    id: "surprisePlus",
    label: "サプライズ＋",
    targetFaction: "opposing",
    cost: 2,
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "M/2/攻撃3t/協/協",
    steps: [{ actionId: "attack", params: { b: 3, aStat: "sociality", dStat: "sociality" } }],
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
    shortNotation: "M/1/?{破壊,防御}∧?s",
    custom: "bounce",
  },
  // 【バウンス＋】：バウンスの分岐に、破壊力/協調性（B>0側）または
  // 防御力/賢さ（B<0側）の同時上昇を追加した改良後スキル。
  bouncePlus: {
    id: "bouncePlus",
    label: "バウンス＋",
    targetFaction: "self",
    cost: 1,
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "M/1/?{[破+協],[防+賢]}∧?s",
    custom: "bouncePlus",
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
    shortNotation: "M/1/?回復2u",
    steps: [{ actionId: "heal", params: { b: 2 } }],
  },
  sunnySideUpPlus: {
    id: "sunnySideUpPlus",
    label: "サニーサイドアップ＋",
    targetFaction: "own",
    cost: 1,
    allyOnly: true,
    weaponOnly: true,
    requiresPriorActionIds: ["smash", "protect"],
    shortNotation: "M/1/?回復5u",
    steps: [{ actionId: "heal", params: { b: 5 } }],
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
    shortNotation: "M/1/継続ダメ[ターン/2]t",
    steps: [{ actionId: "dot", params: (unit, targetUnit, pools) => ({ n: Math.ceil(pools.turn / 2) }) }],
  },
  // 【アラート＋】：÷2切り上げの弱体化を外し、現在のターン数をそのまま
  // 使う強化版。
  alertPlus: {
    id: "alertPlus",
    label: "アラート＋",
    targetFaction: "opposing",
    cost: 1,
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "M/1/継続ダメ[ターン]t",
    steps: [{ actionId: "dot", params: (unit, targetUnit, pools) => ({ n: pools.turn }) }],
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
    shortNotation: "M/2/プロテクトs+継続回復c/防",
    steps: [
      { actionId: "protect" },
      { actionId: "regen", params: (unit, targetUnit, pools, lastResult) => ({ n: lastResult?.magnitude ?? 0, aStat: "defence" }) },
    ],
  },
  // 【エコロジー＋】：プロテクト/継続回復のステップ間参照（前ステップの
  // 結果をnに使う）を外し、それぞれ固定のnb/bを持つ独立した強化版に
  // なった（改良後スキルはほとんどが単純な数値強化、という方針通り）。
  ecologyPlus: {
    id: "ecologyPlus",
    label: "エコロジー＋",
    targetFaction: "self",
    cost: 2,
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "M/2/プロテクト2s+継続回復3c/防",
    steps: [
      { actionId: "protect", params: { nb: 2 } },
      { actionId: "regen", params: { b: 3, aStat: "defence" } },
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
    shortNotation: "M/2/攻撃0?({0,1,3,6,10})",
    custom: "shareCut",
  },
  // 【シェアカット＋】：回数の算出方法が無印と変わる（唯一の例外）。
  // 「使用者の能力値のうち実効値が最も低いものと同じ値」がそのまま
  // 回数になる（実効値0の能力値があれば不発）。
  shareCutPlus: {
    id: "shareCutPlus",
    label: "シェアカット＋",
    targetFaction: "none",
    cost: 2,
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "M/2/攻撃0?([能力値の最低値])",
    custom: "shareCutPlus",
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
    shortNotation: "M/1/[バフ/デバフ&体幹全て反転]a",
    custom: "arrange",
  },
  // 【アレンジ＋】：反転が無条件（バフ・デバフ両方、体幹は符号反転）
  // だった無印から、対象の陣営に応じて「自陣営ならデバフだけ反転して
  // 体幹を絶対値化（有利な方へ）、相手陣営ならバフだけ反転して体幹を
  // -絶対値化（不利な方へ）」という選択的な反転に変わった改良後版。
  // 継続回復⇔継続ダメージの交換は含まれない（詳細文に記載が無いため）。
  arrangePlus: {
    id: "arrangePlus",
    label: "アレンジ＋",
    targetFaction: "any",
    cost: 1,
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "M/1/[バフ/デバフ&体幹選択反転]a",
    custom: "arrangePlus",
  },
  // 【ピール】（スライサー）：相手陣営全員の体幹を1減少（下限は体幹
  // 下限）させ、HPを固定8削る（peelHitが葉、each:"opposing"がラップ
  // する）。
  peel: {
    id: "peel",
    label: "ピール",
    targetFaction: "none",
    cost: 2,
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "M/2/[体幹-1,HP-8]t*",
    steps: [{ actionId: "peelHit", each: "opposing" }],
  },
  peelHit: {
    id: "peelHit",
    label: "ピール",
    targetFaction: "opposing",
    effect: "hp",
    apply: (actor, target) => {
      target.stamina = clampStamina(target.stamina - 1);
      applyHpDamage(target.character, 8);
      return { magnitude: 8, label: "ダメージ" };
    },
  },
  peelPlus: {
    id: "peelPlus",
    label: "ピール＋",
    targetFaction: "none",
    cost: 2,
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "M/2/[体幹-2,HP-16]t*",
    steps: [{ actionId: "peelHitPlus", each: "opposing" }],
  },
  // weaponOnly:trueだが、どの武器のskillIdもpeelHitPlus自身とは一致
  // させない（peelPlusのstepsからだけ参照させ、単独では絶対に選ばせない
  // ための「隠す」用途 -- 警護(guard)がmonsterOnly:trueを同じ目的で
  // 使っているのと同じ考え方）。
  peelHitPlus: {
    id: "peelHitPlus",
    label: "ピール＋",
    targetFaction: "opposing",
    effect: "hp",
    weaponOnly: true,
    apply: (actor, target) => {
      target.stamina = clampStamina(target.stamina - 2);
      applyHpDamage(target.character, 16);
      return { magnitude: 16, label: "ダメージ" };
    },
  },
  // 【ブレンド】（ミキサー）：相手陣営1体を選んで使う（不発ありの方式
  // --「選べるが不発」に統一するユーザー指示に従う）。C=対象のIN。
  // C<0の時だけ、その負のIN分だけ「-8×C」の固定ダメージを与え体幹を
  // 0に戻す。C>=0の相手には何も起きない。単体のleafモジュールとして、
  // 自分自身がsteps無しでapplyを直接持つ（quickAttackなどと同じ形）。
  blend: {
    id: "blend",
    label: "ブレンド",
    targetFaction: "opposing",
    effect: "hp",
    cost: 2,
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "M/2/?[HP-消費脆弱×8]t",
    apply: (actor, target) => {
      if (target.in >= 0) return { magnitude: 0, label: "ダメージ" };
      const damage = -8 * target.in;
      target.stamina = 0;
      applyHpDamage(target.character, damage);
      return { magnitude: damage, label: "ダメージ" };
    },
  },
  // 【ブレンド＋】：C<0はダメージ倍率が16倍に強化。C>=0でも無印のような
  // 完全な不発ではなく、代わりに体幹を2減少させる（下限は体幹下限）--
  // 効果種別がhp/staminaで分かれるため、bounceと同じcustom resolver
  // （resolveBlendPlus）で適切な葉モジュールへ振り分ける。
  // weaponOnly:true（peelHitPlusと同じ「単独選択を隠す」用途 -- 一致
  // するskillIdを持つ武器が無いため実質常に不可になる）。
  blendPlusDamage: {
    id: "blendPlusDamage",
    label: "ブレンド＋",
    targetFaction: "opposing",
    effect: "hp",
    weaponOnly: true,
    apply: (actor, target) => {
      const damage = -16 * target.in;
      target.stamina = 0;
      applyHpDamage(target.character, damage);
      return { magnitude: damage, label: "ダメージ" };
    },
  },
  blendPlus: {
    id: "blendPlus",
    label: "ブレンド＋",
    targetFaction: "opposing",
    cost: 2,
    allyOnly: true,
    weaponOnly: true,
    shortNotation: "M/2/{[HP-消費脆弱×16],[体幹-2]}t",
    custom: "blendPlus",
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
      { moduleId: "electrocute", chance: 0.8 },
      { moduleId: "discharge", chance: 0.2 },
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
  // フルーツリーの上位個体（中盤2体＋終盤1体）。ELITE_MONSTER_DATA参照
  // （成長値は個体ごとに異なる。フルーツリーとは属性も異なる個体がいる
  // -- ロッテンツリーは属性：腐敗）。
  sweetOne: {
    prep: [{ moduleId: "nibble", chance: 1 }],
    main: [{ moduleId: "sweetFruition", chance: 1 }],
  },
  sourOne: {
    prep: [{ moduleId: "pluck", chance: 1 }],
    main: [{ moduleId: "sourFruition", chance: 1 }],
  },
  rottenTree: {
    prep: [{ moduleId: "topsyTurvy", chance: 1 }],
    main: [
      { moduleId: "overripeEnd", chance: 0.3 },
      { moduleId: "infestedEnd", chance: 0.3 },
      { moduleId: "rottingEnd", chance: 0.4 },
    ],
  },
  // チューイング・マシンの上位個体（中盤1体＋終盤1体）。ELITE_MONSTER_DATA
  // 参照。mainのchanceは【ティック】→【タック】→【トー】の順で使わせる
  // ための値 -- タック/トーはrequiresPriorActionIdsで前提技を満たすまで
  // 選択候補自体に入らないため、実際の発生順はこの前提技ゲートと
  // カスケード方式の組み合わせで決まる（chooseMonsterSkillEntry参照）。
  chewingRobot: {
    prep: [{ moduleId: "combination", chance: 1 }],
    main: [
      { moduleId: "tick", chance: 0.01 },
      { moduleId: "tack", chance: 0.99 },
    ],
  },
  chewingComputer: {
    prep: [{ moduleId: "interweaving", chance: 1 }],
    main: [
      { moduleId: "tick", chance: 0.01 },
      { moduleId: "tack", chance: 0.01 },
      { moduleId: "toh", chance: 0.98 },
    ],
  },
  // 電気ゼリーの上位個体（中盤1体＋終盤2体）。ELITE_MONSTER_DATA参照
  // （水平展開 -- 電気ゼリー本体を強化するのではなく、同格の別属性
  // 個体を追加する形）。
  fireJelly: {
    prep: [{ moduleId: "spark", chance: 1 }],
    main: [
      { moduleId: "pillarOfFire", chance: 0.8 },
      { moduleId: "residualHeat", chance: 0.2 },
    ],
  },
  whiteCloudJelly: {
    prep: [{ moduleId: "mirage", chance: 1 }],
    main: [
      { moduleId: "cumulus", chance: 0.8 },
      { moduleId: "cottonCloud", chance: 0.2 },
    ],
  },
  sandDustJelly: {
    prep: [{ moduleId: "sandThrow", chance: 1 }],
    main: [
      { moduleId: "sandstorm", chance: 0.8 },
      { moduleId: "sandDust", chance: 0.2 },
    ],
  },
  // タケニニテイル（ボス）の上位個体（ノーマル/ハード難易度用）。
  // ELITE_BOSS_MONSTER_DATA参照。成長値はタケニニテイル本体と完全に
  // 同一の超純粋強化路線。
  takesugiteiru: {
    prep: [{ moduleId: "greatFortress", chance: 1 }],
    main: [
      { moduleId: "bigSlam", chance: 0.5 },
      { moduleId: "superRush", chance: 0.5 },
    ],
  },
  takedaketeiru: {
    prep: [{ moduleId: "giantFortress", chance: 1 }],
    main: [
      { moduleId: "grandSlam", chance: 0.5 },
      { moduleId: "hyperRush", chance: 0.5 },
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
  flakeSugar: ["guardAlly", "quickAttack", "firstAid", "guardingHand"],
  cubeSugar: ["retreatCall", "quickAttack", "firstAid", "attackingHand"],
  honeyScrew: ["festivalHunch", "quickAttack", "firstAid", "honeyBeat"],
  chocolatBitterTaste: ["shadowJustice", "quickAttack", "firstAid", "bitterFeel"],
  lollipopSpiral: ["sisterCheer", "quickAttack", "firstAid", "supportComfort"],
  flawlessNoColor: ["check", "quickAttack", "firstAid", "flush"],
  sunlightSaccharum: ["highPlot", "lowPlot", "quickAttack", "firstAid", "prescription"],
};

// 隊員のレベルアップに伴うスキル成長ツリー（データのみ）。所持スキルが
// 一定のキリのいいレベルに達すると自動修得し、修得と同時に成長前の
// スキルは失われる想定だが、その「いつ・どう修得させるか」という習得
// システム自体はまだ実装しない（このデータを後から参照する形で別途
// 組み込む）。各キャラクターの配列は{from, to}の連なりで、fromに
// 挙げたモジュールidがtoへ丸ごと置き換わる（PREP_MODULES/MAIN_MODULES
// どちらのidかは各モジュール定義側を参照すればよく、ここでは区別しない）。
// ショコラ・ビターテイストのビターフィールだけは単一のtoではなくbranch
// を持つ -- 修得時点のそのキャラクターの賢さ・協調性を比較し、
// 条件に応じてカカオフィール系/ミルクフィール系のどちらか一方だけを
// 修得する（比較条件そのものの評価はここでは行わない、習得システム側
// の仕事）。
// 即席攻撃・応急手当にはあえて成長後スキルを設けていない（現状は
// 前者だけ・後者だけを持つ隊員がいるが、将来的に全員が両方を持つよう
// 改修する予定で、その改修が済むまでは成長対象にしない）。
export const CHARACTER_SKILL_GROWTH = {
  flakeSugar: [
    { from: "guardAlly", to: "noPassing" },
    { from: "guardingHand", to: "protectiveCode" },
    { from: "protectiveCode", to: "protectiveOrigin" },
  ],
  cubeSugar: [
    { from: "retreatCall", to: "neverLetGo" },
    { from: "attackingHand", to: "attackingArt" },
    { from: "attackingArt", to: "attackingFrontier" },
  ],
  honeyScrew: [
    { from: "festivalHunch", to: "festivalAdvice" },
    // 【ハニービート】は今回新設した弱化版の初期修得スキル。既存の
    // 【ハニービービート】（従来は初期修得スキルだった）はその成長後
    // スキルへ格上げになった。
    { from: "honeyBeat", to: "honeyBeeBeat" },
    { from: "honeyBeeBeat", to: "honeyBeastBeat" },
  ],
  chocolatBitterTaste: [
    { from: "shadowJustice", to: "shadowJusticeDuty" },
    {
      from: "bitterFeel",
      branch: [
        { to: "cacaoFeel", condition: "wisdomGteSociality" },
        { to: "milkFeel", condition: "wisdomLtSociality" },
      ],
    },
    { from: "cacaoFeel", to: "blackFeel" },
    { from: "milkFeel", to: "whiteFeel" },
  ],
  lollipopSpiral: [
    { from: "sisterCheer", to: "sisterCheerUpgrade" },
    // 【安心のサポート】は今回新設した弱化版の初期修得スキル。既存の
    // 【完璧なサポート】（従来は初期修得スキルだった）はその成長後
    // スキルへ格上げになり、新設に伴って微強化もされている
    // （n:3→4、MAIN_MODULES.perfectSupport参照）。
    { from: "supportComfort", to: "perfectSupport" },
    { from: "perfectSupport", to: "legendarySupport" },
  ],
  flawlessNoColor: [
    { from: "check", to: "doubleCheck" },
    // 【フラッシュ】は効果をナーフした上で初期修得スキルの名前を維持、
    // 旧来の効果（相手陣営全員+自身）は【Ｓ・フラッシュ】（ストレート
    // フラッシュ）として成長後スキルへ格上げになった。トランプ役の
    // 読み方に合わせ、idはflush/straightFlush/royalStraightFlushで揃える。
    { from: "flush", to: "straightFlush" },
    { from: "straightFlush", to: "royalStraightFlush" },
  ],
  sunlightSaccharum: [
    { from: "highPlot", to: "highBet" },
    { from: "lowPlot", to: "lowBet" },
    { from: "prescription", to: "prescriptionTheory" },
    { from: "prescriptionTheory", to: "proof" },
  ],
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
    corrections: { attack: null, defence: null, power: null, wisdom: null, sociality: null },
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

const BATTLE_STAT_ORDER = ["attack", "defence", "power", "wisdom", "sociality"];
const BATTLE_STAT_ABBR = { attack: "攻", defence: "防", power: "破", wisdom: "賢", sociality: "協" };

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
  // を持つもの。straightFlush/quagmire/staticClingなど）は、宣言の
  // 時点で実際に効果が及ぶ全ユニットが確定しているので、それを返す。
  // 単体対象のスキルはnull（呼び出し側は従来通り単一のtarget表示に
  // フォールバックする）。あべこべ（custom:"topsyTurvy"）はsteps自体を
  // 持たないcustom分岐スキルだが、実際に効果が及ぶのはquagmireと同じ
  // 相手陣営全員なので、ここで直接拾う。
  function declaredTargetsFor(unit, module) {
    if (module.custom === "topsyTurvy") return opposingPoolFor(unit);
    // 【お姉ちゃん頑張れ〜】【流石だよ、お姉ちゃん！】もsteps自体を
    // 持たないcustom分岐スキルだが、成立時に効果が及ぶのは自陣営全員
    // （自身を含む）なので、あべこべと同じくここで直接拾う。
    if (module.custom === "sisterCheer" || module.custom === "sisterCheerUpgrade") return ownPoolFor(unit);
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
      // 前提技制限：isModuleAvailableFor（隊員のプレイヤー選択用）と同じ
      // ゲートをモンスター側にも適用する（【タック】【トー】--
      // チューイング・マシン系統上位個体参照）。元々このゲートは
      // isModuleAvailableFor側にしかなく、モンスターの所持スキル選択は
      // それを経由しないため、ここで改めてチェックする必要がある。
      if (module.requiresPriorActionIds && !module.requiresPriorActionIds.some((id) => (unit.lastLeafActionIds ?? []).includes(id))) return false;
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

  // 【摘み食い】【摘み採り】共通の土台：1D6を振り、出目1が最も強い
  // 鼓舞/威圧（n=3）の代わりに最も重い自傷（最大HPの25%）、出目6が
  // 最も弱い鼓舞/威圧（n=1）の代わりに最も軽い自傷（最大HPの5%）、
  // その中間（出目2～5）はn=2/自傷15%で固定 -- 強さと自傷が常に連動
  // する。leafModuleは鼓舞（摘み食い、自陣営向け）/威圧（摘み採り、
  // 相手陣営向け）のどちらか一方を渡す。自傷はPrepフェイズの通常の
  // 葉モジュール適用（applyLeafPrepModule、statusLabel/stat限定）では
  // 表現できないHP増減のため、attack/heal等のMainフェイズと同じHP
  // ログ書式をここで直接組み立てる。
  async function resolveDiceRiskyBuff(unit, targetUnit, leafModule) {
    const roll = rollD6();
    const { n, pct } = roll === 1 ? { n: 3, pct: 0.25 } : roll <= 5 ? { n: 2, pct: 0.15 } : { n: 1, pct: 0.05 };
    await applyLeafPrepModule(unit, targetUnit, leafModule, { n });
    const maxHp = computeEffectiveMaxHp(unit.character);
    const magnitude = Math.ceil(maxHp * pct);
    const before = unit.character.currentHp ?? maxHp;
    applyHpDamage(unit.character, magnitude);
    const after = unit.character.currentHp;
    pushLog(`${unit.displayName}のHP：${before} → ${after}（ダメージ ${magnitude}）`, unit.faction);
    render();
    await sleep(ACTION_DELAY_MS);
  }

  // 【あべこべ】専用の処理：相手陣営の生存者全員に対して、対象ごとに
  // 独立した1D6判定で牽制(1~3)/威圧(1~3)のいずれかを個別に適用する。
  async function resolveTopsyTurvy(unit) {
    for (const target of opposingPoolFor(unit)) {
      const roll = rollD6();
      if (roll <= 3) await applyLeafPrepModule(unit, target, PREP_MODULES.restrain, { n: roll });
      else await applyLeafPrepModule(unit, target, PREP_MODULES.intimidate, { n: roll - 3 });
    }
  }

  // 【お姉ちゃん頑張れ〜】【流石だよ、お姉ちゃん！】専用の処理：自陣営
  // 全員（自身を含む）に鼓舞(n)を行うが、自陣営で行動可能なのが自身
  // しかいなければ、警護/挑発/隠密と同じisSoleSurvivorの判定で不発に
  // 終わる。「自身を含む全員に同じ効果、ただし特定の条件で全体が丸ごと
  // 不発」という構成はstepsの汎用each機構では表現できないため、custom
  // resolverにする。
  async function resolveSisterCheer(unit, n) {
    if (isSoleSurvivor(unit, allyUnits, enemyUnits)) {
      pushLog(`${unit.displayName}以外に自陣営の行動可能なユニットがいないため、効果は不発に終わった。`, unit.faction);
      render();
      await sleep(ACTION_DELAY_MS);
      return;
    }
    for (const target of ownPoolFor(unit)) {
      await applyLeafPrepModule(unit, target, PREP_MODULES.inspire, { n });
    }
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
    if (module.custom === "nibble") {
      await resolveDiceRiskyBuff(unit, targetUnit, PREP_MODULES.inspire);
      return;
    }
    if (module.custom === "pluck") {
      await resolveDiceRiskyBuff(unit, targetUnit, PREP_MODULES.intimidate);
      return;
    }
    if (module.custom === "topsyTurvy") {
      await resolveTopsyTurvy(unit);
      return;
    }
    if (module.custom === "sisterCheer") {
      await resolveSisterCheer(unit, 1);
      return;
    }
    if (module.custom === "sisterCheerUpgrade") {
      await resolveSisterCheer(unit, 2);
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
    // "ownExcludingUsed"：自陣営から、このスキル内で既に対象になった
    // ユニットを除いた中からランダムに1体（opposingExcludingUsedの
    // 自陣営版）。自分自身は既に使われていない限り候補に残る（【処方論】
    // 【証明】のような「もう1人、別の味方に回復」構成向け -- 自分を
    // 含めてよい）。
    if (step.target === "ownExcludingUsed") {
      const candidates = ownPoolFor(unit).filter((u) => !usedTargets.includes(u));
      return pickRandom(candidates);
    }
    // "ownExcludingSelfAndUsed"：上と同じだが、自分自身は常に除外する
    // （【通さない！】【守りの原点】のような、警護のように「対象は必ず
    // 自分以外」を前提とする効果を2回以上使うスキル向け）。
    if (step.target === "ownExcludingSelfAndUsed") {
      const candidates = ownPoolFor(unit).filter((u) => !usedTargets.includes(u) && u !== unit);
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
      await applyLeafModule(unit, unit, MAIN_MODULES.enhancePower, { n: unit.in });
    } else if (unit.in <= -1) {
      await applyLeafModule(unit, unit, MAIN_MODULES.enhanceDefence, { n: -unit.in });
    } else {
      pushLog(`${unit.displayName}はIN（行動値）が0のため、「バウンス」は不発に終わった。`, unit.faction);
      render();
      await sleep(ACTION_DELAY_MS);
    }
  }

  // 【バウンス＋】：バウンスと同じB=IN分岐に、破壊力上昇と同時に協調性
  // 上昇（B>0側）、または防御力上昇と同時に賢さ上昇（B<0側）を追加する。
  async function resolveBouncePlus(unit) {
    if (unit.in >= 1) {
      await applyLeafModule(unit, unit, MAIN_MODULES.enhancePower, { n: unit.in });
      await applyLeafModule(unit, unit, MAIN_MODULES.enhanceSociality, { n: unit.in });
    } else if (unit.in <= -1) {
      await applyLeafModule(unit, unit, MAIN_MODULES.enhanceDefence, { n: -unit.in });
      await applyLeafModule(unit, unit, MAIN_MODULES.enhanceWisdom, { n: -unit.in });
    } else {
      pushLog(`${unit.displayName}はIN（行動値）が0のため、「バウンス＋」は不発に終わった。`, unit.faction);
      render();
      await sleep(ACTION_DELAY_MS);
    }
  }

  // 【シェアカット】専用の解決関数：使用者の5能力値（補正なし/rawStat）
  // のうち、最も高い値に並んでいる個数kから作れるペアの数C(k,2)をXと
  // し、相手陣営の生存者から毎回改めてランダムに選んだ対象へX回
  // 「攻撃」を行う（重複・除外なし -- ユーザー指示により対象選択の
  // 候補管理は行わない簡略版）。相手陣営が全滅するなどして候補がいなく
  // なった時点で打ち切る。Xが取り得る値は{0,1,3,6,10}（k=0~5に対応）。
  function shareCutTiedPairCount(unit) {
    const statKeys = ["attack", "defence", "power", "wisdom", "sociality"];
    const values = statKeys.map((key) => rawStat(unit, key));
    const max = Math.max(...values);
    const k = values.filter((v) => v === max).length;
    return (k * (k - 1)) / 2;
  }
  async function resolveShareCut(unit) {
    const hitCount = shareCutTiedPairCount(unit);
    for (let i = 0; i < hitCount; i++) {
      const pool = opposingPoolFor(unit);
      if (pool.length === 0) break;
      const target = pickRandom(pool);
      await applyLeafModule(unit, target, MAIN_MODULES.attack, {});
    }
  }

  // 【シェアカット＋】：回数の算出方法が無印と異なる（改良後スキルの
  // 中で唯一、単純な数値強化ではない）。使用者の5能力値（補正なし）の
  // うち最も低い値そのものをXとする -- 0ならその時点で不発。
  async function resolveShareCutPlus(unit) {
    const statKeys = ["attack", "defence", "power", "wisdom", "sociality"];
    const values = statKeys.map((key) => rawStat(unit, key));
    const hitCount = Math.min(...values);
    for (let i = 0; i < hitCount; i++) {
      const pool = opposingPoolFor(unit);
      if (pool.length === 0) break;
      const target = pickRandom(pool);
      await applyLeafModule(unit, target, MAIN_MODULES.attack, {});
    }
  }

  // 【ハイパーラッシュ】専用の解決関数：まず選択した相手陣営1体（宣言
  // 済みのtargetUnit）に攻撃し、その後「このスキルに使った残りPT全額-1」
  // 回、その都度ランダムに選び直した相手陣営1体へ攻撃を繰り返す --
  // シェアカットと同じ「毎回選び直す、対象の除外管理はしない」簡略版。
  // 攻撃回数自体がcost:"all"で支払った量（unit.lastActionCost、
  // resolveMainAction側で設定済み）という実行時の値で決まり、固定回数
  // のstepsでは表現できないためcustom resolverにする。
  async function resolveHyperRush(unit, targetUnit) {
    await applyLeafModule(unit, targetUnit, MAIN_MODULES.attack, {});
    const extraHits = unit.lastActionCost - 1;
    for (let i = 0; i < extraHits; i++) {
      const pool = opposingPoolFor(unit);
      if (pool.length === 0) break;
      const target = pickRandom(pool);
      await applyLeafModule(unit, target, MAIN_MODULES.attack, {});
    }
  }

  // 【ハニービーストビート】専用の解決関数：選択した相手陣営1体（宣言
  // 済みのtargetUnit）に、支払ったPT全額-1回スマッシュを行い、最後に
  // 同じ対象へ攻撃を1回行う。ハイパーラッシュと違い対象は最初から
  // 固定（毎回選び直さない）で、スマッシュは体幹のみを操作しHPを減らさ
  // ないため対象が途中で戦闘不能になる心配もない。回数自体が実行時の
  // 支払いPTという値で決まるため、固定回数のstepsでは表現できず
  // custom resolverにする。
  async function resolveHoneyBeastBeat(unit, targetUnit) {
    const smashCount = unit.lastActionCost - 1;
    for (let i = 0; i < smashCount; i++) {
      await applyLeafModule(unit, targetUnit, MAIN_MODULES.smash, {});
    }
    await applyLeafModule(unit, targetUnit, MAIN_MODULES.attack, {});
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
    for (const statKey of ["attack", "defence", "power", "wisdom", "sociality"]) {
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

  // 【アレンジ＋】専用の解決関数：無印の「バフ・デバフ両方／体幹の符号
  // 反転」という無条件の反転から、対象の陣営（使用者から見て自陣営か
  // 相手陣営か）に応じた選択的な反転に変わった。自陣営の対象は
  // デバフだけを反転し、体幹は絶対値化（不利な状態を有利な方へ）。
  // 相手陣営の対象はバフだけを反転し、体幹は-絶対値化する。継続回復
  // ⇔継続ダメージの交換は詳細文に記載が無いため据え置かない（含めない）。
  async function resolveArrangePlus(unit, targetUnit) {
    let changed = false;
    const isOwn = targetUnit.faction === unit.faction;
    for (const statKey of ["attack", "defence", "power", "wisdom", "sociality"]) {
      const correction = targetUnit.corrections[statKey];
      if (!correction) continue;
      if (isOwn && correction.sign > 0) continue;
      if (!isOwn && correction.sign < 0) continue;
      correction.sign *= -1;
      const statLabel = CHARACTER_STAT_FULL_LABELS[statKey];
      pushLog(`${targetUnit.displayName}の${statLabel}の補正が反転した（${correction.sign > 0 ? "+" : "-"}${correction.n}）！`, unit.faction);
      changed = true;
    }
    if (targetUnit.stamina !== 0) {
      const before = targetUnit.stamina;
      targetUnit.stamina = isOwn ? Math.abs(targetUnit.stamina) : -Math.abs(targetUnit.stamina);
      if (targetUnit.stamina !== before) {
        pushLog(`${targetUnit.displayName}の体幹：${before} → ${targetUnit.stamina}`, unit.faction);
        changed = true;
      }
    }
    if (!changed) {
      pushLog(`${targetUnit.displayName}には特に変化がなかった。`, unit.faction);
    }
    render();
    await sleep(ACTION_DELAY_MS);
  }

  // 【ブレンド＋】専用の解決関数：C（対象のIN）が負ならダメージ枠
  // （blendPlusDamage、effect:"hp"）、0以上なら体幹操作枠
  // （staminaShift、既存の【崇高】用の葉をそのまま流用）へ振り分ける
  // -- 効果種別が実行時の条件で変わるためbounceと同じ構造を取る。
  async function resolveBlendPlus(unit, targetUnit) {
    if (targetUnit.in < 0) {
      await applyLeafModule(unit, targetUnit, MAIN_MODULES.blendPlusDamage, {});
    } else {
      await applyLeafModule(unit, targetUnit, MAIN_MODULES.staminaShift, { n: -2 });
    }
  }

  // Mainフェイズ用のカスタム解決関数レジストリ：resolvePrepActionの
  // module.custom === "tasteTest"分岐と対になる仕組み。stepsの汎用
  // エンジン（固定回数・固定候補）では表現しづらいスキルを、
  // module.custom: "<key>"で対応するresolverへ振り分ける。
  const MAIN_CUSTOM_RESOLVERS = {
    bounce: resolveBounce,
    bouncePlus: resolveBouncePlus,
    shareCut: resolveShareCut,
    shareCutPlus: resolveShareCutPlus,
    arrange: resolveArrange,
    arrangePlus: resolveArrangePlus,
    blendPlus: resolveBlendPlus,
    hyperRush: resolveHyperRush,
    honeyBeastBeat: resolveHoneyBeastBeat,
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
      // c.nはモジュール適用時点で既に算出済みの「h」（(H+ボーナス)d6合計
      // の結果）。毎ターン振り直すのではなく、その固定値を難易度で割った
      // ものを繰り返し適用する。割合系（ratioDamage/ratioHeal）は
      // 「h/継続割合系難易度」%を実効最大HP基準で、それ以外（heal/
      // damage）は「h/継続系難易度」をそのまま量として使う。
      const isRatio = c.type === "ratioDamage" || c.type === "ratioHeal";
      const amount = isRatio
        ? Math.ceil((computeEffectiveMaxHp(unit.character) * Math.ceil(c.n / CONTINUOUS_RATIO_DIFFICULTY)) / 100)
        : Math.ceil(c.n / CONTINUOUS_DIFFICULTY);
      const before = unit.character.currentHp;
      if (c.type === "heal" || c.type === "ratioHeal") applyHpHeal(unit.character, amount);
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

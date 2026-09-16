import { renderScreen, button, h } from "../dom.js";
import state, { grantResource, grantTieredResource } from "../state.js";
import {
  computeStats,
  computeMaxHp,
  MONSTER_DATA,
  createMonsterFromData,
  applyHpDamage,
  applyHpHeal,
  CHARACTER_STAT_FULL_LABELS,
  computeBattleRewards,
  NATURAL_RESOURCES,
  RIGID_RESOURCES,
  NATURAL_QUALITY_LABELS,
  RIGID_QUALITY_LABELS,
} from "../data/resourceCatalog.js";
import { rollSum, rollJudgement, successCountToR } from "../dice.js";

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
function loopArrowElements(x, yStart, yEnd, faction, isSelf) {
  const outwardSign = faction === "ally" ? 1 : -1;
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
  provoke: {
    id: "provoke",
    label: "挑発",
    targetFaction: "opposing",
    statusLabel: "釘付け",
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
    apply: (t) => {
      t.pt.current = Math.max(1, t.pt.current - 1);
      t.pt.max = Math.max(1, t.pt.max - 1);
    },
  },
};

// 戦闘不能：HPが0以下になったユニット。行動できず、行動対象にも選べず、
// Main/Prepどちらの行動順からも除外される。
function isIncapacitated(unit) {
  return (unit.character.currentHp ?? computeMaxHp(unit.character.growth)) <= 0;
}

// 挑発/隠密の不発判定：自陣営で行動可能（戦闘不能になっていない）なのが
// 自分自身しかいない場合に真を返す共通ヘルパー。
function isSoleSurvivor(actor, allyUnits, enemyUnits) {
  const own = actor.faction === "ally" ? allyUnits : enemyUnits;
  return own.filter((u) => !isIncapacitated(u)).length <= 1;
}

// 補正なしの素の能力値（隊員本体のcomputeStatsの値そのまま）。強化魔法/
// 弱体化魔法自身の発動判定（X用ダイス数）だけはこちらを使う。
function rawStat(unit, key) {
  return computeStats(unit.character)[key];
}

// 実効能力値：unit.correctionsに補正がかかっていればそれを加味した値。
// 上記以外の全モジュール（攻撃/貫通攻撃/回復/プロテクト/スマッシュ/
// 継続回復/継続ダメージのダイス数）はこちらを使う。0未満にはしない。
function correctedStat(unit, key) {
  const c = unit.corrections[key];
  return Math.max(0, rawStat(unit, key) + (c ? c.sign * c.n : 0));
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

// Mainフェイズの行動。攻撃/貫通攻撃/回復（HP増減）、プロテクト/スマッシュ
// （体幹増減）、強化魔法/弱体化魔法（能力値補正）、継続回復/継続ダメージ
// （HP継続増減）の9種類。モジュール本来はPTを消費しない（消費するのは
// 将来の「スキル」側）ので、ここでも一切PTを扱わない。強化魔法/弱体化
// 魔法は本来t（対象の能力値）を指定するが、テスト用にt=攻撃力へ固定
// している。n（補正/効果の強さ）もUI未実装のため全モジュールでデフォ
// ルトの1を使う。
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
    apply: (actor, target) => {
      const a = rollSum(correctedStat(actor, "attack"));
      const d = rollSum(correctedStat(target, "defense"));
      const c = Math.pow(2, -0.5 * target.stamina);
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
    apply: (actor, target) => {
      const a = rollSum(correctedStat(actor, "attack"));
      const c = Math.pow(2, -0.5 * target.stamina);
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
    apply: (actor, target) => {
      const { successCount } = rollJudgement(correctedStat(actor, "coordination"));
      const healPower = successCountToR(successCount);
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
    apply: (actor, target) => {
      const { successCount } = rollJudgement(correctedStat(actor, "defense"));
      const x = successCountToR(successCount);
      target.stamina += x;
    },
  },
  smash: {
    id: "smash",
    label: "スマッシュ",
    targetFaction: "opposing",
    effect: "stamina",
    apply: (actor, target) => {
      const { successCount } = rollJudgement(correctedStat(actor, "destruction"));
      const x = successCountToR(successCount);
      target.stamina -= x;
    },
  },
  enhance: {
    id: "enhance",
    label: "強化魔法",
    targetFaction: "own",
    effect: "correction",
    apply: (actor, target) => {
      const { successCount } = rollJudgement(rawStat(actor, "coordination"));
      const turns = successCountToR(successCount);
      return applyCorrection(target, "attack", 1, 1, turns);
    },
  },
  weaken: {
    id: "weaken",
    label: "弱体化魔法",
    targetFaction: "opposing",
    effect: "correction",
    apply: (actor, target) => {
      const { successCount } = rollJudgement(rawStat(actor, "wisdom"));
      const turns = successCountToR(successCount);
      return applyCorrection(target, "attack", 1, -1, turns);
    },
  },
  regen: {
    id: "regen",
    label: "継続回復",
    targetFaction: "own",
    effect: "continuous",
    apply: (actor, target) => {
      const { successCount } = rollJudgement(correctedStat(actor, "coordination"));
      const turns = successCountToR(successCount);
      return applyContinuousStatus(target, 1, "heal", turns);
    },
  },
  revive: {
    id: "revive",
    label: "蘇生",
    targetFaction: "ownIncapacitated",
    effect: "revive",
    apply: (actor, target) => {
      if (actor.faction === "enemy") return { applied: false };
      const healedHp = correctedStat(actor, "coordination") * 2;
      target.character.currentHp = healedHp;
      return { applied: true, healedHp };
    },
  },
  dot: {
    id: "dot",
    label: "継続ダメージ",
    targetFaction: "opposing",
    effect: "continuous",
    apply: (actor, target) => {
      const { successCount } = rollJudgement(correctedStat(actor, "wisdom"));
      const turns = successCountToR(successCount);
      return applyContinuousStatus(target, 1, "damage", turns);
    },
  },
};

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
  const parts = ["能力値: [ "];
  BATTLE_STAT_ORDER.forEach((key, i) => {
    if (i > 0) parts.push(" / ");
    parts.push(statAbbrSpan(key, correctedStat(unit, key), getStatCorrection(unit, key)));
  });
  parts.push(" ]");
  return h("p", { class: "battle-unit__stats" }, parts);
}

// 体幹: 0 基準の正負整数。正なら「装甲」で青く、負なら「脆弱性」で
// 黄色く表示し、0（補正なし）はどちらのラベルも付けず素のまま表示する。
// 毎ターン終了時に0へ向けて1ずつ自然逓減する（applyEndOfTurnStaminaDecay）。
function staminaSpan(stamina) {
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
// のラベルにした専用版。継続回復/継続ダメージがかかっている間は、
// ラベルを「HP(↑n)」「HP(↓n)」に変えてその存在を示す。
function battleHpGauge(unit) {
  const character = unit.character;
  const maxHp = computeMaxHp(character.growth);
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
function battleUnitCard(unit, extraClass, onClick) {
  const classes = extraClass ? `battle-unit ${extraClass}` : "battle-unit";
  return h("div", { class: classes, "data-unit-id": unit.character.id, onClick }, [
    h("div", { class: "battle-unit__head" }, [
      h("span", { class: "battle-unit__name", text: unit.displayName }),
      isIncapacitated(unit) ? h("span", { class: "battle-unit__down-badge", text: "戦闘不能" }) : staminaSpan(unit.stamina),
    ]),
    battleHpGauge(unit),
    battleStatsLine(unit),
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
export function BattleScene(container, params, api) {
  const allyUnits = state.formationSlots.map((c) => createBattleUnit(c, "ally"));
  const monsterDataIds = Object.keys(MONSTER_DATA);
  const enemyUnits = Array.from({ length: allyUnits.length }, () => createBattleUnit(createMonsterFromData(pickRandom(monsterDataIds)), "enemy"));
  assignDisplayNames([...allyUnits, ...enemyUnits]);

  let turn = 1;
  let phase = "prep"; // "prep" | "main"
  let executing = false; // true for the whole duration of runPrepExecution/runMainExecution (blocks input)
  let activeArrow = null; // { actor, target } | null
  let battleOutcome = null; // "victory" | "defeat" | null -- once set, the action bar swaps to a single 戦闘を終える button
  const logLines = []; // { text, kind: "ally" | "enemy" | "phase" }

  function pushLog(text, kind = "phase") {
    logLines.push({ text, kind });
  }

  // 敵ユニットの残りHP一覧（携帯モードで戦場が見えなくても敵の状況が
  // 分かるように）。戦闘不能のユニットは省略する。
  function enemyHpRosterLine() {
    return enemyUnits
      .filter((u) => !isIncapacitated(u))
      .map((u) => `${u.displayName}: ${u.character.currentHp ?? computeMaxHp(u.character.growth)}/${computeMaxHp(u.character.growth)}`)
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

  function candidateUnits(actor, moduleId) {
    const module = currentModules()[moduleId];
    const own = actor.faction === "ally" ? allyUnits : enemyUnits;
    const opposing = actor.faction === "ally" ? enemyUnits : allyUnits;

    if (module.targetFaction === "self") return [actor];
    if (module.targetFaction === "ownIncapacitated") return own.filter(isIncapacitated);

    if (module.targetFaction === "own") return own.filter((u) => !isIncapacitated(u));

    // targetFaction === "opposing"：Mainフェイズに限り、釘付け（自身の
    // pinnedBy優先）・隠密（相手候補から除外）の制限がかかる。
    let pool = opposing.filter((u) => !isIncapacitated(u));
    if (phase === "main") {
      if (actor.pinnedBy) pool = pool.filter((u) => u === actor.pinnedBy);
      else pool = pool.filter((u) => !u.stealthed);
    }
    return pool;
  }

  function randomEnemyAction(unit) {
    const modules = currentModules();
    const viableModuleIds = Object.keys(modules).filter((id) => candidateUnits(unit, id).length > 0);
    const moduleId = pickRandom(viableModuleIds);
    const targetUnit = pickRandom(candidateUnits(unit, moduleId));
    return { moduleId, targetUnit };
  }

  // 毎ターンのPrepフェイズ開始時: 全ユニットのIN/PTをリセットし、味方の
  // 行動選択は空に、敵の行動選択はCPUがランダムに選び直す（非公開）。
  // 戦闘不能の敵には行動を割り当てない（動けないため）。
  function resetForNewPrepPhase() {
    for (const unit of [...allyUnits, ...enemyUnits]) {
      unit.in = 0;
      unit.pt = { current: PREP_START_PT, max: PREP_START_PT };
      unit.pinnedBy = null;
      unit.stealthed = false;
    }
    for (const unit of allyUnits) unit.action = null;
    for (const unit of enemyUnits) unit.action = isIncapacitated(unit) ? null : randomEnemyAction(unit);
  }

  for (const unit of enemyUnits) unit.action = randomEnemyAction(unit);
  pushPhaseHeader("オードブル！");

  // PrepフェイズもMainフェイズも同じ形（プレイヤー選択→行動実行）に
  // なったので、処理中でなければ常に操作可能。
  function isInteractive() {
    return !executing;
  }

  function allAlliesReady() {
    return allyUnits.filter((u) => !isIncapacitated(u)).every((u) => u.action && u.action.targetUnit);
  }

  function handleModuleChange(unit, moduleId) {
    unit.action = moduleId ? { moduleId, targetUnit: null } : null;
    render();
  }

  function handleTargetChange(unit, targetUnit) {
    if (unit.action) unit.action.targetUnit = targetUnit;
    render();
  }

  // 行動内容は確定済みだが行動対象が未確定な選択枠を全て返す。
  function pendingTargetUnits() {
    return allyUnits.filter((u) => u.action && !u.action.targetUnit);
  }

  // ワイドモード限定：ステータス枠を直接クリックした時の行動対象指定。
  // 行動対象未確定の選択枠のうち、そのユニットが候補に含まれるもの
  // 全てに同時に反映する（候補に無ければその枠には何もしない）。
  function handleStatusCardClick(clickedUnit) {
    if (!isInteractive()) return;
    let changed = false;
    for (const unit of pendingTargetUnits()) {
      if (candidateUnits(unit, unit.action.moduleId).includes(clickedUnit)) {
        unit.action.targetUnit = clickedUnit;
        changed = true;
      }
    }
    if (changed) render();
  }

  // このステータス枠をクリックすることで、行動対象未確定のどれかの
  // 選択枠に指定できるか（見た目の手がかり用。実際の判定は
  // handleStatusCardClick 内でも改めて行う）。
  function isClickableAsTarget(unit) {
    if (!isInteractive()) return false;
    return pendingTargetUnits().some((u) => candidateUnits(u, u.action.moduleId).includes(unit));
  }

  // Prepフェイズは常に「味方①→敵①→味方②→敵②→…」の固定順（この順序
  // 自体はMainフェイズと違い最初からの確定仕様で、以下の変更の対象外）。
  // 戦闘不能のユニットはここで除外し、行動順に含めない。
  function buildAlternatingOrder() {
    return allyUnits.flatMap((_, i) => [allyUnits[i], enemyUnits[i]]).filter((u) => !isIncapacitated(u));
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
    for (const unit of allyUnits) {
      if (!isIncapacitated(unit)) continue;
      const maxHp = computeMaxHp(unit.character.growth);
      unit.character.currentHp = Math.ceil(maxHp / 4);
    }
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

  // 全ユニットの体幹を、毎ターン終了時に0へ向けて1だけ自然逓減させる。
  function applyEndOfTurnStaminaDecay() {
    for (const unit of [...allyUnits, ...enemyUnits]) {
      if (unit.stamina > 0) unit.stamina -= 1;
      else if (unit.stamina < 0) unit.stamina += 1;
    }
  }

  // Prepフェイズの1ユニット分：宣言（矢印表示）→ウェイト→効果適用＋
  // 結果ログ→ウェイト。
  async function resolvePrepAction(unit) {
    const { moduleId, targetUnit } = unit.action;
    const module = PREP_MODULES[moduleId];
    activeArrow = { actor: unit, target: targetUnit };
    pushLog(`${unit.displayName}が「${module.label}」を${targetDisplayName(unit, targetUnit)}に使用！`, unit.faction);
    render();
    await sleep(ACTION_DELAY_MS);

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
      module.apply(targetUnit);
      const after = statSnapshotText(targetUnit, module.stat);
      pushLog(`${targetUnit.displayName}の${module.stat === "in" ? "IN" : "PT"}：${before} → ${after}`, unit.faction);
    }
    render();
    await sleep(ACTION_DELAY_MS);
  }

  // Mainフェイズの1ユニット分：Prepと同じ流れだが、効果の種類（HP増減/
  // 体幹増減/能力値補正/継続効果）で結果ログの組み立てが分岐する。
  async function resolveMainAction(unit) {
    const { moduleId, targetUnit } = unit.action;
    const module = MAIN_MODULES[moduleId];
    activeArrow = { actor: unit, target: targetUnit };
    pushLog(`${unit.displayName}が「${module.label}」を${targetDisplayName(unit, targetUnit)}に使用！`, unit.faction);
    render();
    await sleep(ACTION_DELAY_MS);

    // 蘇生は戦闘不能のユニットを対象にすることが前提の効果なので、
    // 「対象が戦闘不能なら不発」という下の汎用ガードより先に判定する。
    if (module.effect === "revive") {
      const result = module.apply(unit, targetUnit);
      pushLog(
        result.applied
          ? `${targetUnit.displayName}が復活した！（HP：0 → ${result.healedHp}）`
          : `${unit.displayName}は敵陣営のため、効果は不発に終わった。`,
        unit.faction
      );
    } else if (isIncapacitated(targetUnit)) {
      pushLog(`${targetUnit.displayName}は戦闘不能のため、効果は不発に終わった。`, unit.faction);
    } else if (module.effect === "stamina") {
      const before = targetUnit.stamina;
      module.apply(unit, targetUnit);
      const after = targetUnit.stamina;
      pushLog(`${targetUnit.displayName}の体幹：${before} → ${after}`, unit.faction);
    } else if (module.effect === "correction") {
      const result = module.apply(unit, targetUnit);
      const statLabel = CHARACTER_STAT_FULL_LABELS[result.statKey];
      pushLog(
        result.applied
          ? `${targetUnit.displayName}の${statLabel}に${result.sign > 0 ? "+" : "-"}${result.n}の補正（${result.turns}ターン）！`
          : `${targetUnit.displayName}の${statLabel}への補正は不発（既存の補正 ${result.existingN} 以上ではない）`,
        unit.faction
      );
    } else if (module.effect === "continuous") {
      const result = module.apply(unit, targetUnit);
      const effectLabel = result.type === "heal" ? "継続回復" : "継続ダメージ";
      pushLog(
        result.applied
          ? `${targetUnit.displayName}に${effectLabel} ${result.n}（${result.turns}ターン）！`
          : `${targetUnit.displayName}への${effectLabel}は不発（既存の効果 ${result.existingN} 以上ではない）`,
        unit.faction
      );
    } else {
      const beforeHp = targetUnit.character.currentHp;
      const { magnitude, label } = module.apply(unit, targetUnit);
      const afterHp = targetUnit.character.currentHp;
      pushLog(`${targetUnit.displayName}のHP：${beforeHp} → ${afterHp}（${label} ${magnitude}）`, unit.faction);
    }
    render();
    await sleep(ACTION_DELAY_MS);
  }

  // 継続回復/継続ダメージを持つ全ユニットについて、Mainフェイズの終わり
  // に一度だけHPを増減させ（n D6合計÷2 を切り上げ）、残りターン数を1
  // 減らす。0になったらそのユニットの継続効果枠を解除する。既に戦闘
  // 不能のユニットはスキップする -- そうしないと、このターン中の行動
  // で倒された後でも、倒れる前からかかっていた継続回復がHPを0より上に
  // 戻してしまい、実質的に蘇生になってしまう。
  async function applyContinuousHpTicks() {
    for (const unit of [...allyUnits, ...enemyUnits]) {
      const c = unit.continuousHp;
      if (!c || isIncapacitated(unit)) continue;
      const amount = Math.ceil(rollSum(c.n) / 2);
      const before = unit.character.currentHp;
      if (c.type === "heal") applyHpHeal(unit.character, amount);
      else applyHpDamage(unit.character, amount);
      const after = unit.character.currentHp;
      const effectLabel = c.type === "heal" ? "継続回復" : "継続ダメージ";
      pushLog(`${unit.displayName}のHP：${before} → ${after}（${effectLabel} ${amount}）`, unit.faction);
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

  // Prepフェイズの順次処理が終わったら、Mainフェイズへ切り替える：CPU
  // が敵の行動を選び直し（非公開、戦闘不能の敵は除く）、味方の選択は
  // 空に戻し、見出し＋敵HP一覧をログに出す。ここではまだ実行しない
  // （プレイヤーの選択待ち）。
  function startMainPhase() {
    phase = "main";
    for (const unit of allyUnits) unit.action = null;
    for (const unit of enemyUnits) unit.action = isIncapacitated(unit) ? null : randomEnemyAction(unit);
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
    executing = false;
    render();
  }

  async function runMainExecution() {
    executing = true;
    render();

    for (const unit of buildMainOrder()) {
      // 同じフェイズ内で自分より先に動いた誰かに倒されていたら、この
      // ユニットの番はスキップする（行動順はフェイズ開始時点の生存者
      // で組んでいるため、途中で戦闘不能になることがある）。
      if (isIncapacitated(unit)) continue;
      await resolveMainAction(unit);
      const outcome = checkBattleEnd();
      if (outcome) {
        activeArrow = null;
        concludeBattle(outcome);
        return;
      }
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
    turn += 1;
    phase = "prep";
    resetForNewPrepPhase();
    executing = false;
    pushPhaseHeader("オードブル！");
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
      [h("option", { value: "", text: "－" }), ...Object.values(currentModules()).map((m) => h("option", { value: m.id, text: m.label }))]
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
  // 名前を添えている。行動内容・行動対象のどちらかが未確定の間はハイ
  // ライトし、両方確定すると解除する。順次処理中は全て一律グレーアウト。
  function actionSelectBox(unit) {
    if (isIncapacitated(unit)) {
      return h("div", { class: "battle-action-select battle-action-select--down" }, [
        h("p", { class: "battle-action-select__name", text: unit.displayName }),
        h("p", { class: "battle-action-select__down-label", text: "戦闘不能" }),
      ]);
    }
    const modifier = executing ? " battle-action-select--disabled" : !(unit.action && unit.action.targetUnit) ? " battle-action-select--pending" : "";
    return h("div", { class: `battle-action-select${modifier}` }, [h("p", { class: "battle-action-select__name", text: unit.displayName }), actionSelectFields(unit)]);
  }

  function battleLog() {
    return h(
      "div",
      { class: "battle-log" },
      logLines.map((line) => h("p", { class: `battle-log__line battle-log__line--${line.kind}`, text: line.text }))
    );
  }

  // 携帯モードでもワイドモードでも共通の、テキストログ直下の実行ボタン。
  // 全味方の行動内容・行動対象が確定するまで、また処理中は無効。
  // Prep/Mainどちらのフェイズ中かで実行する処理を切り替える。
  function actionExecuteButton() {
    return h("button", {
      class: "btn btn--primary battle-execute-btn",
      disabled: !isInteractive() || !allAlliesReady(),
      onClick: phase === "prep" ? runPrepExecution : runMainExecution,
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
      else if (unit === activeArrow.target) classes.push("battle-unit--target");
    } else if (isClickableAsTarget(unit)) {
      classes.push("battle-unit--clickable-target");
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

    // (3) 順次処理の一時的な矢印。上記2つより後に追加することで、常に
    // それらより表側（手前）に描かれる。
    if (activeArrow) {
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
  // ・行動選択プルダウンだけの縦並びリストを出す。
  function mobileUnitRow(unit) {
    if (isIncapacitated(unit)) {
      return h("div", { class: "battle-mobile-unit battle-mobile-unit--down" }, [
        h("p", { class: "battle-mobile-unit__name", text: unit.displayName }),
        battleHpGauge(unit),
        h("p", { class: "battle-action-select__down-label", text: "戦闘不能" }),
      ]);
    }
    return h("div", { class: "battle-mobile-unit" }, [h("p", { class: "battle-mobile-unit__name", text: unit.displayName }), battleHpGauge(unit), actionSelectFields(unit)]);
  }

  function battleMobileRoster() {
    return h("div", { class: "battle-mobile-roster" }, allyUnits.map(mobileUnitRow));
  }

  // 勝敗が決するまではポーズだけ、決した後は「戦闘を終える」1つだけに
  // 差し替える（自動遷移はしない -- 実際の遷移はhandleBattleEndButton）。
  function battleActions() {
    if (battleOutcome) return [button("戦闘を終える", { variant: "primary", onClick: handleBattleEndButton })];
    return [button("ポーズ", { variant: "ghost", onClick: () => api.callScene("pause") })];
  }

  function render() {
    renderScreen(container, {
      eyebrow: "BATTLE",
      title: "戦闘",
      body: [battleLog(), actionExecuteButton(), battleArena(), battleMobileRoster()],
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

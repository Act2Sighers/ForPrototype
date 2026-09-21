// Shared 隊員情報 display, used wherever a character's (or hiring
// candidate's) full stat breakdown is shown: hiring.js's expanded
// candidate detail, gallery.js's expanded retired-character detail, and
// squadFormation.js's formation-row detail toggle. Split into pieces
// (characterHpGauge/characterStatLine/characterWeaponLine) rather than
// only the combined characterInfoCard, since squadFormation shows the HP
// gauge unconditionally but keeps the stat/weapon breakdown behind a
// 詳細表示 toggle.
import { h } from "./dom.js";
import {
  computeStats,
  computeEffectiveMaxHp,
  CHARACTER_STAT_LABELS,
  CHARACTER_STAT_FULL_LABELS,
  CHARACTER_STAT_BY_WEAPON_STAT,
  WEAPON_STAT_LABELS,
  WEAPON_TYPES,
  SYNERGIES,
  EQUIP_SLOTS,
  weaponStatRankLabel,
  getWeaponDisplayName,
} from "./data/resourceCatalog.js";
import { describeCharacterSkills, describeWeaponSkill } from "./scenes/battle.js";

// Split across two lines (rather than one 5-stat row) per the user's
// preference for readability: attack+defense, then the other three.
const STAT_LINE_1 = ["attack", "defense"];
// ギャラリー・雇用画面用：HPゲージの代わりに、カロリー(HP)も能力値の
// 一覧に含めて表示する（両画面とも表示される隊員は必ずHP全快のため、
// 最大HPさえ分かれば十分という判断 -- characterStatLineWithMaxHp参照）。
const STAT_LINE_1_WITH_HP = ["hp", "attack", "defense"];
const STAT_LINE_2 = ["destruction", "wisdom", "coordination"];
const FULL_WIDTH_SPACE = "　";

export function characterHpGauge(character) {
  const maxHp = computeEffectiveMaxHp(character);
  const currentHp = character.currentHp ?? maxHp;
  const pct = maxHp > 0 ? Math.max(0, Math.min(100, (currentHp / maxHp) * 100)) : 0;
  return h("div", { class: "hp-line" }, [
    h("span", { class: "hp-line__label stat-hp", text: `${CHARACTER_STAT_LABELS.hp}(${CHARACTER_STAT_FULL_LABELS.hp})` }),
    h("span", { class: "hp-line__value", text: `${currentHp} / ${maxHp}` }),
    h("div", { class: "hp-gauge" }, [h("div", { class: "hp-gauge__fill", style: `width:${pct}%` })]),
  ]);
}

function statSpan(key, s) {
  return h("span", { class: `stat-${key}`, text: `${CHARACTER_STAT_LABELS[key]}(${CHARACTER_STAT_FULL_LABELS[key]}): ${s[key]}` });
}

function statLineRow(keys, s) {
  const spans = [];
  keys.forEach((key, i) => {
    if (i > 0) spans.push(FULL_WIDTH_SPACE);
    spans.push(statSpan(key, s));
  });
  return h("p", { class: "character-card__stats" }, spans);
}

export function characterStatLine(character) {
  const s = computeStats(character);
  return h("div", { class: "character-card__stat-lines" }, [statLineRow(STAT_LINE_1, s), statLineRow(STAT_LINE_2, s)]);
}

// ギャラリー(退役隊員)・雇用(候補者)画面専用：どちらも表示される隊員は
// 必ずHP全快なので、専用のHPゲージ行は出さず、能力値の一覧の中にカロリー
// (HP)も混ぜて表示する。
export function characterStatLineWithMaxHp(character) {
  const s = computeStats(character);
  return h("div", { class: "character-card__stat-lines" }, [statLineRow(STAT_LINE_1_WITH_HP, s), statLineRow(STAT_LINE_2, s)]);
}

// 変調：隊員限定の常設パラメータ。部隊編成画面の各隊員枠、右上隅に
// 右揃えで表示する（戦闘画面のconditionBadgeと同じ見た目）。
export function characterConditionBadge(character) {
  return h("span", { class: "character-card__condition", text: `変調: ${character.condition ?? 0}` });
}

// シナジー(戦闘スタイル) a character carries -- see resourceCatalog.js's
// SYNERGIES/canEquip. `character.synergies` is expected to be set (see
// createCharacterFromData); callers building an ad-hoc display-only
// object (e.g. a 雇用画面 candidate preview) need to pass it through too.
export function characterSynergyLine(character) {
  const names = (character.synergies ?? []).map((id) => SYNERGIES[id].name).join(" / ");
  return h("p", { class: "character-card__synergy", text: `シナジー：${names || "なし"}` });
}

export function characterWeaponLine(character) {
  if (!character.weapon) {
    return h("p", { class: "character-card__weapon", text: "武器：なし" });
  }
  const weapon = character.weapon;
  const rankParts = [];
  Object.keys(WEAPON_STAT_LABELS).forEach((weaponKey, i) => {
    if (i > 0) rankParts.push("/");
    const charKey = CHARACTER_STAT_BY_WEAPON_STAT[weaponKey];
    rankParts.push(
      h("span", {
        class: `stat-${charKey}`,
        text: `${WEAPON_STAT_LABELS[weaponKey][0]}:${weaponStatRankLabel(weapon.stats[weaponKey])}`,
      })
    );
  });
  const weaponSynergyNames = WEAPON_TYPES[weapon.baseTypeId].synergies.map((id) => SYNERGIES[id].name).join("/");
  const weaponSkill = describeWeaponSkill(weapon);
  return h("p", { class: "character-card__weapon" }, [
    `武器：${getWeaponDisplayName(weapon)}［`,
    ...rankParts,
    `］（シナジー：${weaponSynergyNames}）${weaponSkill ? ` ${weaponSkill}` : ""}`,
  ]);
}

// キャラクター固有スキル（CHARACTER_SKILL_LOADOUTSに定義のあるキャラ
// のみ）。未実装分（定義の無いキャラ）は何も表示しない -- 固定の持ち
// スキルという概念自体が無いため。
export function characterSkillLine(character) {
  const text = describeCharacterSkills(character.dataId);
  if (!text) return null;
  return h("p", { class: "character-card__skills", text: `スキル：${text}` });
}

// 装備中の糖衣を、頭/肩/腕/胴/脚の順に「名前(熟練度)」で並べる簡易表示
// （部隊編成画面の詳細表示用）。1つも装備していなければ「なし」。
export function characterCoatingLine(character) {
  const equipped = EQUIP_SLOTS.map((slot) => character.equippedCoatings?.[slot]).filter(Boolean);
  const text = equipped.length ? equipped.map((c) => `${c.name}(${c.mastery})`).join(" / ") : "なし";
  return h("p", { class: "character-card__weapon", text: `糖衣：${text}` });
}

// ギャラリー(退役隊員)・雇用(候補者)画面専用の詳細カード。変調は表示
// しない（両画面とも表示対象は変調0・HP全快が前提のため）。HPゲージも
// 出さず、代わりにcharacterStatLineWithMaxHpの能力値一覧にカロリー(HP)
// を混ぜて表示する。
export function characterInfoCard(character) {
  return h("div", { class: "character-card" }, [
    h("div", { class: "character-card__head" }, [
      h("span", { class: "character-card__name", text: character.name }),
      h("span", { class: "character-card__level", text: `Lv.${character.level}` }),
    ]),
    characterSynergyLine(character),
    characterStatLineWithMaxHp(character),
    characterWeaponLine(character),
    characterSkillLine(character),
  ]);
}

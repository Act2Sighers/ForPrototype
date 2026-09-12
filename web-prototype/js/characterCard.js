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
  computeMaxHp,
  CHARACTER_STAT_LABELS,
  CHARACTER_STAT_FULL_LABELS,
  CHARACTER_STAT_BY_WEAPON_STAT,
  WEAPON_STAT_LABELS,
  weaponStatRankLabel,
  getWeaponDisplayName,
} from "./data/resourceCatalog.js";

const STAT_ORDER = ["attack", "defense", "destruction", "wisdom", "coordination"];
const FULL_WIDTH_SPACE = "　";

export function characterHpGauge(character) {
  const maxHp = computeMaxHp(character.growth);
  const currentHp = character.currentHp ?? maxHp;
  const pct = maxHp > 0 ? Math.max(0, Math.min(100, (currentHp / maxHp) * 100)) : 0;
  return h("div", { class: "hp-line" }, [
    h("span", { class: "hp-line__label stat-hp", text: `${CHARACTER_STAT_LABELS.hp}(${CHARACTER_STAT_FULL_LABELS.hp})` }),
    h("span", { class: "hp-line__value", text: `${currentHp} / ${maxHp}` }),
    h("div", { class: "hp-gauge" }, [h("div", { class: "hp-gauge__fill", style: `width:${pct}%` })]),
  ]);
}

export function characterStatLine(character) {
  const s = computeStats(character);
  const spans = [];
  STAT_ORDER.forEach((key, i) => {
    if (i > 0) spans.push(FULL_WIDTH_SPACE);
    spans.push(
      h("span", { class: `stat-${key}`, text: `${CHARACTER_STAT_LABELS[key]}(${CHARACTER_STAT_FULL_LABELS[key]}): ${s[key]}` })
    );
  });
  return h("p", { class: "character-card__stats" }, spans);
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
  return h("p", { class: "character-card__weapon" }, [`武器：${getWeaponDisplayName(weapon)}［`, ...rankParts, "］"]);
}

export function characterInfoCard(character) {
  return h("div", { class: "character-card" }, [
    h("div", { class: "character-card__head" }, [
      h("span", { class: "character-card__name", text: character.name }),
      h("span", { class: "character-card__level", text: `Lv.${character.level}` }),
    ]),
    characterHpGauge(character),
    characterStatLine(character),
    characterWeaponLine(character),
  ]);
}

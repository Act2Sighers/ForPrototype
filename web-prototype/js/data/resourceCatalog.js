// Catalog for the four resource kinds (隊員 / 武器 / 糖衣 / 資源).
// Only one species of each exists so far; this module holds their fixed
// data plus the small factory functions needed to create instances of
// them. state.js owns *where* instances live and how they're granted.

// ---------------------------------------------------------------------
// 隊員 (characters)
// ---------------------------------------------------------------------
// Every stat but HP is base + growth. Base values are shared by every
// character (attack 3, the other four stats 1); only growth differs
// per character. Max HP is the sum of the five non-HP growth values,
// times 12.

export const CHARACTER_BASE = { attack: 3, defense: 1, destruction: 1, wisdom: 1, coordination: 1 };

export const CHARACTER_STAT_LABELS = {
  hp: "カロリー",
  attack: "トウド",
  defense: "ヒフク",
  destruction: "シゲキ",
  wisdom: "フクミ",
  coordination: "カオリ",
};

export function computeMaxHp(growth) {
  const sum =
    growth.attack + growth.defense + growth.destruction + growth.wisdom + growth.coordination;
  return sum * 12;
}

export function computeStats(character) {
  const g = character.growth;
  return {
    hp: computeMaxHp(g),
    attack: CHARACTER_BASE.attack + g.attack,
    defense: CHARACTER_BASE.defense + g.defense,
    destruction: CHARACTER_BASE.destruction + g.destruction,
    wisdom: CHARACTER_BASE.wisdom + g.wisdom,
    coordination: CHARACTER_BASE.coordination + g.coordination,
  };
}

export function describeCharacter(character) {
  const s = computeStats(character);
  const statLine = ["hp", "attack", "defense", "destruction", "wisdom", "coordination"]
    .map((key) => `${CHARACTER_STAT_LABELS[key]}${s[key]}`)
    .join(" ");
  const weaponPart = character.weapon ? `武器: ${character.weapon.name}` : "武器: なし";
  return `Lv.${character.level} / ${statLine} / ${weaponPart}`;
}

function createCharacter({ id, name, growth, level = 1 }) {
  return { id, name, level, growth: { ...growth }, skills: [], weapon: null };
}

export function createBiscuitBaker() {
  // growth 1 across the board -> HP 60, attack 4, and 2 each for
  // defense/destruction/wisdom/coordination, matching the design doc.
  // Granted fresh every run (see state.js's grantStartReward), so each
  // instance gets its own id -- "biscuit-baker" names the template, not
  // a specific individual.
  return createCharacter({
    id: `biscuit-baker-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: "ビスケット・ベーカー",
    growth: { attack: 1, defense: 1, destruction: 1, wisdom: 1, coordination: 1 },
  });
}

// ---------------------------------------------------------------------
// 武器 / カトラリー (weapons)
// ---------------------------------------------------------------------
// Performance stats are ranked 無/低/中/高/極, stored internally as 0-4.

function createWeapon({ id, name, stats }) {
  return { id, name, stats: { ...stats } };
}

export function createHumbleFryingPan() {
  // A frying pan freshly forged from ザラメ鉱石: its stats are copied
  // straight from that ore (see RIGID_RESOURCES below). Which material
  // it was forged from is intentionally not kept on the weapon itself.
  return createWeapon({
    id: `weapon-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: "質素なフライパン",
    stats: { sweetness: 1, hardness: 1, poisonResist: 1, stability: 1, flexibility: 1 },
  });
}

// ---------------------------------------------------------------------
// 資源 (materials / currency — the natural/rigid split has no mechanical
// difference, only different stat shapes)
// ---------------------------------------------------------------------

export const NATURAL_RESOURCES = {
  baseCream: { id: "baseCream", name: "ベースクリーム" },
};

export const RIGID_RESOURCES = {
  zarameOre: {
    id: "zarameOre",
    name: "ザラメ鉱石",
    stats: { sweetness: 1, hardness: 1, poisonResist: 1, stability: 1, flexibility: 1 },
  },
};

// Flattens a run's { natural, rigid } quantity maps into a display-ready
// list. Used by the small resource HUD and the squad formation screen.
export function describeResources(resources) {
  if (!resources) return [];
  const list = [];
  for (const [key, species] of Object.entries(NATURAL_RESOURCES)) {
    list.push({ id: key, name: species.name, qty: resources.natural[key] ?? 0 });
  }
  for (const [key, species] of Object.entries(RIGID_RESOURCES)) {
    list.push({ id: key, name: species.name, qty: resources.rigid[key] ?? 0 });
  }
  return list;
}

// ---------------------------------------------------------------------
// 糖衣 / オブラート (coatings)
// ---------------------------------------------------------------------

export const COATING_ATTRIBUTE_LABELS = {
  time: "時間",
  soak: "浸水",
  humidity: "多湿",
  cold: "低温",
  dry: "乾燥",
  heat: "高温",
  contamination: "汚染",
  decay: "腐敗",
};

export const COATING_EFFECT_LABELS = {
  damage: "属性特化ダメージ",
  reduction: "属性ダメージ軽減",
  ailmentChance: "状態異常付与確率",
  ailmentResist: "状態異常罹患耐性",
  envAdapt: "属性環境適応度",
};

// Flavor names are "<attribute prefix><effect suffix>" (時間 + 属性特化
// ダメージ = "カラフルな" + "プラズマ"). Only this one combination has a
// known name so far; the rest fall back to a plain descriptive label
// until the remaining naming data is provided.
const COATING_ATTRIBUTE_PREFIX = { time: "カラフルな" };
const COATING_EFFECT_SUFFIX = { damage: "プラズマ" };

function nameCoating(attribute, effect) {
  const prefix = COATING_ATTRIBUTE_PREFIX[attribute];
  const suffix = COATING_EFFECT_SUFFIX[effect];
  if (prefix && suffix) return `${prefix}${suffix}`;
  return `${COATING_ATTRIBUTE_LABELS[attribute]}の糖衣（${COATING_EFFECT_LABELS[effect]}）`;
}

export function formatMastery(mastery) {
  return mastery >= 5 ? "熟練度: MAX" : `熟練度: ${mastery}`;
}

export function describeCoating(coating) {
  return [
    `属性: ${COATING_ATTRIBUTE_LABELS[coating.attribute]}`,
    `効果内容: ${COATING_EFFECT_LABELS[coating.effect]}`,
    formatMastery(coating.mastery),
  ].join(" / ");
}

function createCoating({ id, attribute, effect, mastery = 1 }) {
  return { id, attribute, effect, mastery, name: nameCoating(attribute, effect), enabled: true };
}

export function createColorfulPlasma() {
  return createCoating({ id: "colorful-plasma", attribute: "time", effect: "damage", mastery: 1 });
}

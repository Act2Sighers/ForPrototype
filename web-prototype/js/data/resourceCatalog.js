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

function growthSum(growth) {
  return growth.attack + growth.defense + growth.destruction + growth.wisdom + growth.coordination;
}

export function computeMaxHp(growth) {
  return growthSum(growth) * 12;
}

// A character's level is just its growth total minus 4 -- every
// キャラクターデータ below starts at growth-sum 5 (level 1, HP 60);
// leveling up or recruiting a boosted candidate later just means
// allocating more growth, and the level follows automatically.
export function computeLevel(growth) {
  return growthSum(growth) - 4;
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

// キャラクターデータ: the growth-only templates candidates are built
// from. Every one sums to growth 5 (level 1, HP 60) as-is; recruiting a
// boosted candidate later means allocating extra growth on top of one
// of these via createCharacterFromData's bonusGrowth, not editing the
// template itself.
export const CHARACTER_DATA = {
  flakeSugar: { id: "flakeSugar", name: "フレーク・シュガー", growth: { attack: 0, defense: 2, destruction: 1, wisdom: 1, coordination: 1 } },
  cubeSugar: { id: "cubeSugar", name: "キューブ・シュガー", growth: { attack: 2, defense: 0, destruction: 1, wisdom: 1, coordination: 1 } },
  honeyScrew: { id: "honeyScrew", name: "ハニー・スクリュー", growth: { attack: 1, defense: 1, destruction: 2, wisdom: 0, coordination: 1 } },
  chocolatBitterTaste: { id: "chocolatBitterTaste", name: "ショコラ・ビターテイスト", growth: { attack: 1, defense: 1, destruction: 1, wisdom: 2, coordination: 0 } },
  lollipopSpiral: { id: "lollipopSpiral", name: "ロリポップ・スパイラル", growth: { attack: 1, defense: 1, destruction: 0, wisdom: 1, coordination: 2 } },
  flawlessNoColor: { id: "flawlessNoColor", name: "フローレス・ノーカラー", growth: { attack: 2, defense: 2, destruction: 0, wisdom: 1, coordination: 0 } },
  sunlightSaccharum: { id: "sunlightSaccharum", name: "サンライト・サッカルム", growth: { attack: 0, defense: 0, destruction: 1, wisdom: 2, coordination: 2 } },
  biscuitBaker: { id: "biscuitBaker", name: "ビスケット・ベーカー", growth: { attack: 1, defense: 1, destruction: 1, wisdom: 1, coordination: 1 } },
  paletteFlash: { id: "paletteFlash", name: "パレット・フラッシュ", growth: { attack: 0, defense: 1, destruction: 1, wisdom: 0, coordination: 3 } },
  chalkThroat: { id: "chalkThroat", name: "チョーク・スロート", growth: { attack: 0, defense: 3, destruction: 1, wisdom: 1, coordination: 0 } },
  jellyMaltose: { id: "jellyMaltose", name: "ゼリー・マルトース", growth: { attack: 3, defense: 0, destruction: 1, wisdom: 0, coordination: 1 } },
  drinkFree: { id: "drinkFree", name: "ドリンク・フリー", growth: { attack: 2, defense: 1, destruction: 0, wisdom: 0, coordination: 2 } },
  sherbetFrost: { id: "sherbetFrost", name: "シャーベット・フロスト", growth: { attack: 0, defense: 2, destruction: 2, wisdom: 1, coordination: 0 } },
  shelfStable: { id: "shelfStable", name: "シェルフ・ステイブル", growth: { attack: 0, defense: 0, destruction: 1, wisdom: 3, coordination: 1 } },
};

// Instantiates an actual 隊員 from a キャラクターデータ template, with
// an id unique to this individual (the template id names the species,
// not the individual — the same template can be granted more than
// once, e.g. ビスケット・ベーカー every run; see grantStartReward).
// bonusGrowth optionally adds on top of the template for a
// stronger-than-default recruit (not used anywhere yet).
export function createCharacterFromData(dataId, bonusGrowth = {}) {
  const data = CHARACTER_DATA[dataId];
  const growth = {
    attack: data.growth.attack + (bonusGrowth.attack ?? 0),
    defense: data.growth.defense + (bonusGrowth.defense ?? 0),
    destruction: data.growth.destruction + (bonusGrowth.destruction ?? 0),
    wisdom: data.growth.wisdom + (bonusGrowth.wisdom ?? 0),
    coordination: data.growth.coordination + (bonusGrowth.coordination ?? 0),
  };
  return {
    id: `${dataId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: data.name,
    level: computeLevel(growth),
    growth,
    skills: [],
    weapon: null,
  };
}

export function createBiscuitBaker() {
  return createCharacterFromData("biscuitBaker");
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
// difference, only different stat shapes; "currency" vs "material" is
// purely how the player is using a given resource, not a system
// distinction)
// ---------------------------------------------------------------------

export const NATURAL_RESOURCES = {
  baseCream: { id: "baseCream", name: "ベースクリーム", abbr: "BC" },
  squeezedFructoseLiquid: { id: "squeezedFructoseLiquid", name: "シボリ果糖液", abbr: "SFL" },
  gummyElasticMaterial: { id: "gummyElasticMaterial", name: "口香弾性質", abbr: "GEM" },
  waferMembraneObject: { id: "waferMembraneObject", name: "糖衣膜状物体", abbr: "WMO" },
  sableSoftGravel: { id: "sableSoftGravel", name: "サブレ軟性塊", abbr: "SSG" },
  electroMagneticGelatin: { id: "electroMagneticGelatin", name: "電磁性ゼラチン", abbr: "EMG" },
};

// Every rigid resource but 琥珀糖鉱石 has fixed performance stats and is
// tracked as a simple quantity, same as a natural resource. 琥珀糖鉱石
// (amberSugarMineral) is marked `variableStats` instead of `stats`: see
// rollAmberSugarMineralStats() below for why it can't work that way.
export const RIGID_RESOURCES = {
  coarseSugarMineral: {
    id: "coarseSugarMineral",
    name: "ザラメ鉱石",
    abbr: "CSM",
    stats: { sweetness: 1, hardness: 1, poisonResist: 1, stability: 1, flexibility: 1 },
  },
  amberSugarMineral: {
    id: "amberSugarMineral",
    name: "琥珀糖鉱石",
    abbr: "ASM",
    variableStats: true,
  },
  cacaoLayeredRock: {
    id: "cacaoLayeredRock",
    name: "カカオ堆積岩",
    abbr: "CLR",
    stats: { sweetness: 2, hardness: 3, poisonResist: 1, stability: 2, flexibility: 2 },
  },
  driedFructoseRock: {
    id: "driedFructoseRock",
    name: "ヒボシ果糖岩",
    abbr: "DFR",
    stats: { sweetness: 2, hardness: 1, poisonResist: 2, stability: 3, flexibility: 2 },
  },
  honeyCrystalOre: {
    id: "honeyCrystalOre",
    name: "ハチミツ結晶鉱",
    abbr: "HCO",
    stats: { sweetness: 1, hardness: 2, poisonResist: 2, stability: 2, flexibility: 3 },
  },
  dropSpiralOre: {
    id: "dropSpiralOre",
    name: "アメダマ螺旋鉱",
    abbr: "DSO",
    stats: { sweetness: 3, hardness: 2, poisonResist: 2, stability: 1, flexibility: 2 },
  },
  sorbetEternalIce: {
    id: "sorbetEternalIce",
    name: "ソルベ永久氷柱",
    abbr: "SEI",
    stats: { sweetness: 2, hardness: 2, poisonResist: 3, stability: 2, flexibility: 1 },
  },
  sugarCaneFiber: {
    id: "sugarCaneFiber",
    name: "甘蔗繊維質",
    abbr: "SCF",
    stats: { sweetness: 0, hardness: 3, poisonResist: 3, stability: 3, flexibility: 3 },
  },
  highPuritySugar: {
    id: "highPuritySugar",
    name: "高純度糖鉱",
    abbr: "HPS",
    stats: { sweetness: 4, hardness: 4, poisonResist: 0, stability: 0, flexibility: 0 },
  },
};

// 琥珀糖鉱石 rolls fresh performance stats every time one turns up (the 5
// values are random but always add up to 8), which breaks the usual
// rigid-resource model in three ways: it has no fixed rank to list in
// the catalog above; a simple quantity counter can't represent "3 of
// them" when each one is actually different; and using one (e.g. to
// forge a weapon) means picking a specific rolled instance, not just
// decrementing a count. So unlike the fixed-stat resources, this species
// is never tallied as a number — every one that turns up becomes its
// own instance (see createRigidResourceInstance), the same way weapons
// and characters are individuals rather than a stack.
const VARIABLE_STAT_TOTAL_POINTS = 8;
const STAT_KEYS = ["sweetness", "hardness", "poisonResist", "stability", "flexibility"];
const STAT_MAX_RANK = 4;

export function rollAmberSugarMineralStats() {
  const stats = { sweetness: 0, hardness: 0, poisonResist: 0, stability: 0, flexibility: 0 };
  let remaining = VARIABLE_STAT_TOTAL_POINTS;
  while (remaining > 0) {
    const eligible = STAT_KEYS.filter((key) => stats[key] < STAT_MAX_RANK);
    const key = eligible[Math.floor(Math.random() * eligible.length)];
    stats[key] += 1;
    remaining -= 1;
  }
  return stats;
}

// Creates one instance of a rigid resource species: a fixed-stat species
// just copies its catalog stats, while a variableStats species (only
// 琥珀糖鉱石 so far) gets a fresh random roll. Nothing grants these yet
// (no acquisition event exists), but this is what such an event should
// call — for a fixed species where a simple quantity counter still
// works, prefer incrementing state.run.resources.rigid[id] directly
// instead.
export function createRigidResourceInstance(speciesId) {
  const species = RIGID_RESOURCES[speciesId];
  return {
    id: `${speciesId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    speciesId,
    name: species.name,
    stats: species.variableStats ? rollAmberSugarMineralStats() : { ...species.stats },
  };
}

// A fresh { natural, rigid } quantity map, one entry per fungible
// species (i.e. every one except variableStats rigid resources, which
// aren't tracked as quantities at all — see above).
export function createEmptyResources() {
  const natural = {};
  for (const key of Object.keys(NATURAL_RESOURCES)) natural[key] = 0;
  const rigid = {};
  for (const [key, species] of Object.entries(RIGID_RESOURCES)) {
    if (!species.variableStats) rigid[key] = 0;
  }
  return { natural, rigid };
}

// Flattens a run's { natural, rigid } quantity maps into a display-ready
// list (English abbreviation + quantity), skipping anything not yet
// held. Used by the small resource HUD and the squad formation screen.
export function describeResources(resources) {
  if (!resources) return [];
  const list = [];
  for (const [key, species] of Object.entries(NATURAL_RESOURCES)) {
    const qty = resources.natural[key] ?? 0;
    if (qty > 0) list.push({ id: key, name: species.name, abbr: species.abbr, qty });
  }
  for (const [key, species] of Object.entries(RIGID_RESOURCES)) {
    if (species.variableStats) continue;
    const qty = resources.rigid[key] ?? 0;
    if (qty > 0) list.push({ id: key, name: species.name, abbr: species.abbr, qty });
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
// ダメージ = "カラフルな" + "プラズマ"). Full 8x5 naming table.
const COATING_ATTRIBUTE_PREFIX = {
  time: "カラフルな",
  soak: "キュートな",
  humidity: "ストライプの",
  cold: "キラキラした",
  dry: "チェックの",
  heat: "オシャレな",
  contamination: "エスニックな",
  decay: "サイセンタンの",
};

const COATING_EFFECT_SUFFIX = {
  damage: "プラズマ",
  reduction: "ショール",
  ailmentChance: "サテライト",
  ailmentResist: "フットプリント",
  envAdapt: "ヘイロー",
};

function nameCoating(attribute, effect) {
  return `${COATING_ATTRIBUTE_PREFIX[attribute]}${COATING_EFFECT_SUFFIX[effect]}`;
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

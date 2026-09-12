// Catalog for the four resource kinds (隊員 / 武器 / 糖衣 / 資源): their
// fixed data, plus the small factory functions needed to create
// instances of them. state.js owns *where* instances live and how
// they're granted.

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
  const weaponPart = character.weapon ? `武器: ${getWeaponDisplayName(character.weapon)}` : "武器: なし";
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

// ---------------------------------------------------------------------
// 武器 / カトラリー (weapons)
// ---------------------------------------------------------------------
// Performance stats are ranked 無/低/中/高/極, stored internally as 0-4.
// A weapon's own fixed data is just which 武器種 it is -- everything
// else (stats, and the prefix derived from them) comes from what it was
// forged from. forgeWeapon references RIGID_RESOURCES, defined further
// below; that's fine since it's only read when forgeWeapon actually
// runs, well after the whole module has finished loading.

export const WEAPON_TYPES = {
  fork: { id: "fork", name: "フォーク" },
  knife: { id: "knife", name: "ナイフ" },
  dipper: { id: "dipper", name: "ディッパー" },
  recipeBook: { id: "recipeBook", name: "レシピブック" },
  straw: { id: "straw", name: "ストロー" },
  paperPlate: { id: "paperPlate", name: "カミザラ" },
  timer: { id: "timer", name: "タイマー" },
  fryingPan: { id: "fryingPan", name: "フライパン" },
  mixer: { id: "mixer", name: "ミキサー" },
  jarredBottle: { id: "jarredBottle", name: "ビンヅメ" },
  pizzaCutter: { id: "pizzaCutter", name: "ピザカッター" },
  shaker: { id: "shaker", name: "シェイカー" },
  icePick: { id: "icePick", name: "アイスピック" },
  slicer: { id: "slicer", name: "スライサー" },
};

// A weapon's name is "<prefix><weapon type>" (e.g. "質素な" + "フライ
// パン"). The prefix is picked from one of ten pools, chosen by the
// weapon's current total stat points and, in the middle bracket, by
// which single stat (if any) leads: see computeWeaponPrefixTier. It's
// rolled fresh at creation, and is meant to be re-rolled by
// refreshWeaponPrefix() any time a stat change (e.g. future
// enhancement) moves the weapon into a different bracket -- but left
// alone if the bracket doesn't change, so upgrading a weapon doesn't
// rename it on every tweak.
const WEAPON_PREFIX_POOL = {
  broken: ["即席の", "壊れかけの", "練習用", "おもちゃの", "廃品の", "形だけの"],
  humble: ["質素な", "中古の", "お得用の", "試作品の", "お下がりの", "頑張った"],
  "mid-tie": ["実用的な", "器用な", "愛用の", "いい感じの", "堅実な", "食べごろ"],
  "mid-sweetness": ["甘味入り", "別腹の", "おやつの", "食べやすい", "鋭利な", "強火の"],
  "mid-hardness": ["頑固な", "弾力のある", "もちもち", "丈夫な", "鉄壁の", "老舗の"],
  "mid-poisonResist": ["刺激的な", "すっぱい", "酢漬けの", "爆発", "劇的な", "衝撃の"],
  "mid-stability": ["落ち着く", "安全な", "職人技の", "複雑な", "難解な", "こだわりの"],
  "mid-flexibility": ["伸びる", "しなる", "競技用", "お揃いの", "コラボ品の", "芳しい"],
  premium: ["上物の", "由緒ある", "熟練者の", "人気の", "流行りの", "お祝い用"],
  legendary: ["究極の", "完璧な", "伝説の", "宇宙的な", "霜降り", "七色の"],
};

function computeWeaponPrefixTier(stats) {
  const sum = STAT_KEYS.reduce((total, key) => total + stats[key], 0);
  if (sum >= 17) return "legendary";
  if (sum >= 14) return "premium";
  if (sum >= 7) {
    const maxValue = Math.max(...STAT_KEYS.map((key) => stats[key]));
    const topKeys = STAT_KEYS.filter((key) => stats[key] === maxValue);
    return topKeys.length >= 2 ? "mid-tie" : `mid-${topKeys[0]}`;
  }
  if (sum >= 4) return "humble";
  return "broken";
}

// Recomputes a weapon's prefix tier from its current stats. Only rolls
// a new prefix when the tier actually changed (including the very
// first call, since prefixTier starts as null) -- otherwise the
// existing prefix is left as-is.
export function refreshWeaponPrefix(weapon) {
  const tier = computeWeaponPrefixTier(weapon.stats);
  if (tier !== weapon.prefixTier) {
    weapon.prefixTier = tier;
    const pool = WEAPON_PREFIX_POOL[tier];
    weapon.prefix = pool[Math.floor(Math.random() * pool.length)];
  }
  return weapon;
}

export function getWeaponDisplayName(weapon) {
  return `${weapon.prefix}${WEAPON_TYPES[weapon.baseTypeId].name}`;
}

function createWeapon({ id, baseTypeId, stats }) {
  const weapon = { id, baseTypeId, stats: { ...stats }, prefix: null, prefixTier: null };
  refreshWeaponPrefix(weapon);
  return weapon;
}

// Forges a weapon of the given 武器種 from a rigid resource species: the
// weapon's stats are copied from the material (or freshly rolled, for
// 琥珀糖鉱石) as of the moment it's forged. Which material was used is
// intentionally not kept on the weapon afterward.
export function forgeWeapon(weaponTypeId, materialId) {
  const species = RIGID_RESOURCES[materialId];
  const stats = species.variableStats ? rollAmberSugarMineralStats() : { ...species.stats };
  return createWeapon({
    id: `weapon-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    baseTypeId: weaponTypeId,
    stats,
  });
}

// ---------------------------------------------------------------------
// 初期雇用データ (initial-employment data)
// ---------------------------------------------------------------------
// Used only by the (not yet built) 初期雇用 event: each entry pairs a
// キャラクターデータ with the 武器種 + 剛体資源 it starts equipped
// with. Every entry here uses ザラメ鉱石, the weakest material, since
// this is meant for early-game / low-difficulty initial-employment
// pools; stronger variants (better material, or bonus growth) would be
// separate entries once higher-tier recruitment exists.
export const INITIAL_EMPLOYMENT_DATA = {
  flakeSugar: { characterDataId: "flakeSugar", weaponTypeId: "fork", materialId: "coarseSugarMineral" },
  cubeSugar: { characterDataId: "cubeSugar", weaponTypeId: "knife", materialId: "coarseSugarMineral" },
  honeyScrew: { characterDataId: "honeyScrew", weaponTypeId: "dipper", materialId: "coarseSugarMineral" },
  chocolatBitterTaste: { characterDataId: "chocolatBitterTaste", weaponTypeId: "recipeBook", materialId: "coarseSugarMineral" },
  lollipopSpiral: { characterDataId: "lollipopSpiral", weaponTypeId: "straw", materialId: "coarseSugarMineral" },
  flawlessNoColor: { characterDataId: "flawlessNoColor", weaponTypeId: "paperPlate", materialId: "coarseSugarMineral" },
  sunlightSaccharum: { characterDataId: "sunlightSaccharum", weaponTypeId: "timer", materialId: "coarseSugarMineral" },
  biscuitBaker: { characterDataId: "biscuitBaker", weaponTypeId: "fryingPan", materialId: "coarseSugarMineral" },
  paletteFlash: { characterDataId: "paletteFlash", weaponTypeId: "mixer", materialId: "coarseSugarMineral" },
  chalkThroat: { characterDataId: "chalkThroat", weaponTypeId: "jarredBottle", materialId: "coarseSugarMineral" },
  jellyMaltose: { characterDataId: "jellyMaltose", weaponTypeId: "pizzaCutter", materialId: "coarseSugarMineral" },
  drinkFree: { characterDataId: "drinkFree", weaponTypeId: "shaker", materialId: "coarseSugarMineral" },
  sherbetFrost: { characterDataId: "sherbetFrost", weaponTypeId: "icePick", materialId: "coarseSugarMineral" },
  shelfStable: { characterDataId: "shelfStable", weaponTypeId: "slicer", materialId: "coarseSugarMineral" },
};

// Instantiates a character from an 初期雇用データ entry, forging and
// equipping its starting weapon in the same step.
export function createInitialRecruit(employmentId) {
  const entry = INITIAL_EMPLOYMENT_DATA[employmentId];
  const character = createCharacterFromData(entry.characterDataId);
  character.weapon = forgeWeapon(entry.weaponTypeId, entry.materialId);
  return character;
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

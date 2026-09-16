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

// ---------------------------------------------------------------------
// シナジー (戦闘スタイル)
// ---------------------------------------------------------------------
// A weapon can be equipped by a character (and vice versa) only if they
// share at least one シナジー -- see canEquip below. Purely a
// compatibility/flavor concept for now; once battle exists, each
// シナジー is meant to also gate which special attacks/actions a
// character can perform.
// `style` is the full descriptive flavor text; `shortStyle` is the
// terser parenthetical form 鍛冶画面 lists each シナジー under (e.g.
// "カット（近接・軽撃）").
export const SYNERGIES = {
  cut: { id: "cut", name: "カット", style: "近接×軽撃/速度重視", shortStyle: "近接・軽撃" },
  grill: { id: "grill", name: "グリル", style: "近接×重撃/威力重視", shortStyle: "近接・重撃" },
  fry: { id: "fry", name: "フライ", style: "遠距離×射撃攻撃", shortStyle: "遠距離・射撃" },
  hole: { id: "hole", name: "ホール", style: "遠距離×魔法攻撃", shortStyle: "遠距離・魔法" },
  kaikei: { id: "kaikei", name: "カイケイ", style: "サポート×戦術指揮", shortStyle: "支援・戦術" },
  araimono: { id: "araimono", name: "アライモノ", style: "サポート×防衛/回復", shortStyle: "支援・防護" },
};

// Whether `character` and `weapon` share at least one シナジー, i.e.
// whether the character could equip that weapon. No equip/swap screen
// calls this yet (that's future work), but it's exercised by
// INITIAL_EMPLOYMENT_DATA's own consistency check below.
export function canEquip(character, weapon) {
  const weaponSynergies = WEAPON_TYPES[weapon.baseTypeId].synergies;
  return character.synergies.some((synergyId) => weaponSynergies.includes(synergyId));
}

export const CHARACTER_BASE = { attack: 3, defense: 1, destruction: 1, wisdom: 1, coordination: 1 };

export const CHARACTER_STAT_LABELS = {
  hp: "カロリー",
  attack: "トウド",
  defense: "ヒフク",
  destruction: "シゲキ",
  wisdom: "フクミ",
  coordination: "カオリ",
};

// Full descriptive names, shown in parentheses alongside the short
// labels above wherever a character's stats are broken out in detail
// (see characterCard.js).
export const CHARACTER_STAT_FULL_LABELS = {
  hp: "HP",
  attack: "攻撃力",
  defense: "防御力",
  destruction: "破壊力",
  wisdom: "賢さ",
  coordination: "協調性",
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

// Which 性能値 (weapon stat) feeds into which 能力値 (character stat): a
// character's displayed non-HP stats are base+growth *plus* whichever of
// these its equipped weapon carries -- see computeStats below. The
// reverse map is used by characterCard.js to color a weapon's stat
// abbreviations the same as the 能力値 they feed.
export const WEAPON_STAT_BY_CHARACTER_STAT = {
  attack: "sweetness",
  defense: "hardness",
  destruction: "poisonResist",
  wisdom: "stability",
  coordination: "flexibility",
};

export const CHARACTER_STAT_BY_WEAPON_STAT = Object.fromEntries(
  Object.entries(WEAPON_STAT_BY_CHARACTER_STAT).map(([charKey, weaponKey]) => [weaponKey, charKey])
);

// HP and level are growth-only (see computeMaxHp/computeLevel above) --
// only the other five stats pick up their equipped weapon's matching
// performance value on top of base+growth.
export function computeStats(character) {
  const g = character.growth;
  const weaponStats = character.weapon?.stats;
  const withWeapon = (base, charKey) => base + (weaponStats?.[WEAPON_STAT_BY_CHARACTER_STAT[charKey]] ?? 0);
  return {
    hp: computeMaxHp(g),
    attack: withWeapon(CHARACTER_BASE.attack + g.attack, "attack"),
    defense: withWeapon(CHARACTER_BASE.defense + g.defense, "defense"),
    destruction: withWeapon(CHARACTER_BASE.destruction + g.destruction, "destruction"),
    wisdom: withWeapon(CHARACTER_BASE.wisdom + g.wisdom, "wisdom"),
    coordination: withWeapon(CHARACTER_BASE.coordination + g.coordination, "coordination"),
  };
}

// キャラクターデータ: the growth-only templates candidates are built
// from. Every one sums to growth 5 (level 1, HP 60) as-is; recruiting a
// boosted candidate later means allocating extra growth on top of one
// of these via createCharacterFromData's bonusGrowth, not editing the
// template itself.
export const CHARACTER_DATA = {
  flakeSugar: { id: "flakeSugar", name: "フレーク・シュガー", growth: { attack: 0, defense: 2, destruction: 1, wisdom: 1, coordination: 1 }, synergies: ["araimono"] },
  cubeSugar: { id: "cubeSugar", name: "キューブ・シュガー", growth: { attack: 2, defense: 0, destruction: 1, wisdom: 1, coordination: 1 }, synergies: ["cut"] },
  honeyScrew: { id: "honeyScrew", name: "ハニー・スクリュー", growth: { attack: 1, defense: 1, destruction: 2, wisdom: 0, coordination: 1 }, synergies: ["grill"] },
  chocolatBitterTaste: { id: "chocolatBitterTaste", name: "ショコラ・ビターテイスト", growth: { attack: 1, defense: 1, destruction: 1, wisdom: 2, coordination: 0 }, synergies: ["hole"] },
  lollipopSpiral: { id: "lollipopSpiral", name: "ロリポップ・スパイラル", growth: { attack: 1, defense: 1, destruction: 0, wisdom: 1, coordination: 2 }, synergies: ["fry"] },
  flawlessNoColor: { id: "flawlessNoColor", name: "フローレス・ノーカラー", growth: { attack: 2, defense: 2, destruction: 0, wisdom: 1, coordination: 0 }, synergies: ["cut", "fry"] },
  sunlightSaccharum: { id: "sunlightSaccharum", name: "サンライト・サッカルム", growth: { attack: 0, defense: 0, destruction: 1, wisdom: 2, coordination: 2 }, synergies: ["kaikei"] },
  biscuitBaker: { id: "biscuitBaker", name: "ビスケット・ベーカー", growth: { attack: 1, defense: 1, destruction: 1, wisdom: 1, coordination: 1 }, synergies: ["grill"] },
  paletteFlash: { id: "paletteFlash", name: "パレット・フラッシュ", growth: { attack: 0, defense: 1, destruction: 1, wisdom: 0, coordination: 3 }, synergies: ["hole", "araimono"] },
  chalkThroat: { id: "chalkThroat", name: "チョーク・スロート", growth: { attack: 0, defense: 3, destruction: 1, wisdom: 1, coordination: 0 }, synergies: ["kaikei", "araimono"] },
  jellyMaltose: { id: "jellyMaltose", name: "ゼリー・マルトース", growth: { attack: 3, defense: 0, destruction: 1, wisdom: 0, coordination: 1 }, synergies: ["cut", "grill"] },
  drinkFree: { id: "drinkFree", name: "ドリンク・フリー", growth: { attack: 2, defense: 1, destruction: 0, wisdom: 0, coordination: 2 }, synergies: ["fry", "araimono"] },
  sherbetFrost: { id: "sherbetFrost", name: "シャーベット・フロスト", growth: { attack: 0, defense: 2, destruction: 2, wisdom: 1, coordination: 0 }, synergies: ["grill", "hole"] },
  shelfStable: { id: "shelfStable", name: "シェルフ・ステイブル", growth: { attack: 0, defense: 0, destruction: 1, wisdom: 3, coordination: 1 }, synergies: ["fry", "kaikei"] },
};

// Instantiates an actual 隊員 from a キャラクターデータ template, with
// an id unique to this individual (the template id names the species,
// not the individual — the same template can be hired more than once,
// e.g. ビスケット・ベーカー showing up in every 初期雇用 pool).
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
    currentHp: computeMaxHp(growth),
    skills: [],
    weapon: null,
    synergies: data.synergies,
  };
}

// モンスターデータ: 敵陣営用の同種テンプレート。隊員データと同じ
// base+growth の考え方（CHARACTER_BASE＋growth＝表示される能力値、
// growthの合計×12＝HP）を流用しているが、雇用候補には一切出ないよう
// CHARACTER_DATAとは別カタログにしてある。プレイヤーの操作で成長する
// ことは無いので bonusGrowth の概念は無い。
export const MONSTER_DATA = {
  karumeDog: { id: "karumeDog", name: "カルメヤ犬", growth: { attack: 1, defense: 0, destruction: 0, wisdom: 1, coordination: 1 } },
  chocoRock: { id: "chocoRock", name: "チョコロック", growth: { attack: 0, defense: 3, destruction: 0, wisdom: 0, coordination: 0 } },
  electricJelly: { id: "electricJelly", name: "電気ゼリー", growth: { attack: 0, defense: 0, destruction: 2, wisdom: 1, coordination: 0 } },
};

// createCharacterFromData と同じ形のインスタンスを、MONSTER_DATA から
// 毎回新しい個体（idだけ別）として生成する。
export function createMonsterFromData(dataId) {
  const data = MONSTER_DATA[dataId];
  const growth = { ...data.growth };
  return {
    id: `${dataId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: data.name,
    level: computeLevel(growth),
    growth,
    currentHp: computeMaxHp(growth),
    skills: [],
    weapon: null,
  };
}

// Permanently raises one of a character's five growth stats (not HP,
// which is derived, not stored) by `amount`, recomputing level to match
// (see computeLevel). Returns {before, after} of the raw growth value,
// for display purposes -- see exploration.js's post-run stat growth.
export function growCharacterStat(character, statKey, amount = 1) {
  const before = character.growth[statKey];
  character.growth[statKey] = before + amount;
  character.level = computeLevel(character.growth);
  return { before, after: character.growth[statKey] };
}

// Picks whichever of `characters` currently has the highest `statKey`
// value (base+growth), breaking ties uniformly at random. Returns null
// for an empty list. Used by episode outcomes that single out e.g.
// "the wisest squad member" rather than a player-chosen one.
export function pickHighestStatCharacter(characters, statKey) {
  if (!characters.length) return null;
  let best = -Infinity;
  let ties = [];
  for (const character of characters) {
    const value = computeStats(character)[statKey];
    if (value > best) {
      best = value;
      ties = [character];
    } else if (value === best) {
      ties.push(character);
    }
  }
  return ties[Math.floor(Math.random() * ties.length)];
}

// Lowers a character's currentHp by `amount`, floored at 0. Used by both
// episode outcomes (see data/scripts.js) and the battle screen's
// 攻撃/貫通攻撃 modules.
export function applyHpDamage(character, amount) {
  const maxHp = computeMaxHp(character.growth);
  const current = character.currentHp ?? maxHp;
  character.currentHp = Math.max(0, current - amount);
}

// Raises a character's currentHp by `amount`, capped at their max HP.
// Used by the battle screen's 回復 module.
export function applyHpHeal(character, amount) {
  const maxHp = computeMaxHp(character.growth);
  const current = character.currentHp ?? maxHp;
  character.currentHp = Math.min(maxHp, current + amount);
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

// `frame` names the 剛体資源 species + quantity 鍛冶画面's 武器製造
// consumes as that weapon's フレーム (its quantity always matches the
// weapon's own synergies.length -- see data/resourceCatalog.js's
// pickLowestQualityFrame). The frame's own quality/stats are never
// looked at; only the module (freely chosen at forge time) determines
// the crafted weapon's stats -- see craftWeapon.
export const WEAPON_TYPES = {
  fork: { id: "fork", name: "フォーク", synergies: ["cut", "hole", "araimono"], frame: { speciesId: "sorbetEternalIce", quantity: 3 } },
  knife: { id: "knife", name: "ナイフ", synergies: ["cut"], frame: { speciesId: "dropSpiralOre", quantity: 1 } },
  dipper: { id: "dipper", name: "ディッパー", synergies: ["grill"], frame: { speciesId: "honeyCrystalOre", quantity: 1 } },
  recipeBook: { id: "recipeBook", name: "レシピブック", synergies: ["hole", "kaikei"], frame: { speciesId: "driedFructoseRock", quantity: 2 } },
  straw: { id: "straw", name: "ストロー", synergies: ["fry"], frame: { speciesId: "cacaoLayeredRock", quantity: 1 } },
  paperPlate: { id: "paperPlate", name: "カミザラ", synergies: ["cut", "fry"], frame: { speciesId: "driedFructoseRock", quantity: 2 } },
  timer: { id: "timer", name: "タイマー", synergies: ["fry", "kaikei"], frame: { speciesId: "sugarCaneFiber", quantity: 2 } },
  fryingPan: { id: "fryingPan", name: "フライパン", synergies: ["grill", "araimono"], frame: { speciesId: "cacaoLayeredRock", quantity: 2 } },
  mixer: { id: "mixer", name: "ミキサー", synergies: ["grill", "hole", "araimono"], frame: { speciesId: "honeyCrystalOre", quantity: 3 } },
  jarredBottle: { id: "jarredBottle", name: "ビンヅメ", synergies: ["kaikei", "araimono"], frame: { speciesId: "amberSugarMineral", quantity: 2 } },
  pizzaCutter: { id: "pizzaCutter", name: "ピザカッター", synergies: ["cut", "grill"], frame: { speciesId: "dropSpiralOre", quantity: 2 } },
  shaker: { id: "shaker", name: "シェイカー", synergies: ["hole", "araimono"], frame: { speciesId: "sorbetEternalIce", quantity: 2 } },
  icePick: { id: "icePick", name: "アイスピック", synergies: ["grill", "hole"], frame: { speciesId: "sorbetEternalIce", quantity: 2 } },
  slicer: { id: "slicer", name: "スライサー", synergies: ["cut", "fry", "kaikei"], frame: { speciesId: "dropSpiralOre", quantity: 3 } },
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
  const sum = sumStatValues(stats);
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
// intentionally not kept on the weapon afterward. No forging screen
// exists yet to pick a specific quality tier -- every current caller
// only ever passes ザラメ鉱石 (no quality variance), so a tiered or
// 琥珀糖鉱石 material just defaults to its "mid" tier/quality for now.
export function forgeWeapon(weaponTypeId, materialId) {
  const species = RIGID_RESOURCES[materialId];
  const stats = species.variableStats
    ? rollAmberSugarMineralStats(AMBER_QUALITY_POINTS.mid)
    : { ...(species.stats ?? species.statsByTier.mid) };
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

// ---------------------------------------------------------------------
// 雇用 / 除隊 (hiring & discharge) — shared by 雇用画面 and 部隊編成画面
// の除隊モード.
// ---------------------------------------------------------------------

function sumStatValues(stats) {
  return STAT_KEYS.reduce((total, key) => total + stats[key], 0);
}

// D/C/B/A/S, same breakpoints as the weapon prefix tiers, but the 7-13
// bracket isn't split further here — it's just "B" regardless of which
// stat leads.
export function computeWeaponRating(stats) {
  const sum = sumStatValues(stats);
  if (sum >= 17) return "S";
  if (sum >= 14) return "A";
  if (sum >= 7) return "B";
  if (sum >= 4) return "C";
  return "D";
}

export const WEAPON_STAT_LABELS = {
  sweetness: "糖度",
  hardness: "硬性",
  poisonResist: "毒耐性",
  stability: "安定性",
  flexibility: "柔軟性",
};

// A weapon stat's 0-4 internal value, spelled out as its 無/低/中/高/極
// rank (see the 武器/カトラリー section below for why it's stored as a
// plain 0-4 int).
const WEAPON_STAT_RANK_LABELS = ["無", "低", "中", "高", "極"];
export function weaponStatRankLabel(value) {
  return WEAPON_STAT_RANK_LABELS[value] ?? "?";
}

export function describeWeapon(weapon) {
  const statLine = STAT_KEYS.map((key) => `${WEAPON_STAT_LABELS[key]}${weapon.stats[key]}`).join(" ");
  return `${getWeaponDisplayName(weapon)} / ${statLine} / 武器評価:${computeWeaponRating(weapon.stats)}`;
}

// Simplified stand-in for the real hire-cost / discharge-reward
// formulas (not designed yet): ザラメ鉱石 x ceil((growth sum + weapon
// stat sum) / 2). Takes anything with a `growth` and an equipped
// `weapon` -- a real character (for a discharge reward) or a hiring
// candidate preview (for its listed cost) both fit this shape.
export function computeTradeValue({ growth, weapon }) {
  return Math.ceil((growthSum(growth) + sumStatValues(weapon.stats)) / 2);
}

function shuffledCopy(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function pickRandomEmploymentIds(count) {
  return shuffledCopy(Object.keys(INITIAL_EMPLOYMENT_DATA)).slice(0, count);
}

// A 雇用画面 candidate: forges its weapon once, up front, so the rating
// and cost shown stay consistent with what hiring actually grants (see
// hiring.js, which reuses this same weapon instance rather than forging
// a new one when the candidate is actually hired). `flatCost`, when
// given, overrides computeTradeValue -- used by 初期雇用モード, whose
// cost is a flat ザラメ鉱石x1 regardless of stats.
export function createHiringCandidate(employmentId, { flatCost } = {}) {
  const entry = INITIAL_EMPLOYMENT_DATA[employmentId];
  const data = CHARACTER_DATA[entry.characterDataId];
  const weapon = forgeWeapon(entry.weaponTypeId, entry.materialId);
  return {
    employmentId,
    characterDataId: entry.characterDataId,
    name: data.name,
    level: computeLevel(data.growth),
    weapon,
    cost: flatCost ?? computeTradeValue({ growth: data.growth, weapon }),
  };
}

// ---------------------------------------------------------------------
// 武器取引画面 / 武器置き場画面（売却モード）
// ---------------------------------------------------------------------
// Placeholder pricing per the user's own instruction: both buy and sell
// price are just ザラメ鉱石×(性能値合計), with no regard yet for ラン
// 進捗率 (deferred across every event, not just this one, until more of
// 取引/戦闘 exists) or which specific 武器評価/prefix the weapon has.

export function computeWeaponMarketPrice(weapon) {
  return sumStatValues(weapon.stats);
}

export function pickRandomWeaponTypeIds(count) {
  return shuffledCopy(Object.keys(WEAPON_TYPES)).slice(0, count);
}

// A 武器取引画面 candidate: always forged from ザラメ鉱石 for now (see
// this section's own note above) -- weaponTrade.js forges it once, up
// front, so the price shown matches what buying it actually grants,
// the same way createHiringCandidate does for 雇用画面.
export function createWeaponTradeCandidate(weaponTypeId) {
  const weapon = forgeWeapon(weaponTypeId, "coarseSugarMineral");
  return { weapon, price: computeWeaponMarketPrice(weapon), purchased: false };
}

// ---------------------------------------------------------------------
// 資源 (materials / currency — the natural/rigid split has no mechanical
// difference, only different stat shapes; "currency" vs "material" is
// purely how the player is using a given resource, not a system
// distinction)
// ---------------------------------------------------------------------
//
// Quality tiers: every species except ベースクリーム(natural) and ザラメ
//鉱石(rigid) can turn up in more than one quality, tracked on a run as
// a {tier: count} bucket (see createEmptyResources) rather than a plain
// number. 琥珀糖鉱石 is the one further exception within rigid
// resources: its "quality" only controls how many points get randomly
// rolled at acquisition time (see rollAmberSugarMineralStats) — the
// resulting stats make every one an individual instance, the same way
// weapons and characters are, rather than a tally.

export const NATURAL_QUALITY_TIERS = ["mid", "high", "premium"];
const NATURAL_QUALITY_PREFIX = { mid: "", high: "上", premium: "特上" };
export const NATURAL_QUALITY_LABELS = { mid: "中", high: "上", premium: "特上" };

// Full display name for one quality of a natural resource species (e.g.
// "上シボリ果糖液"). Nothing calls this yet (no natural-resource
// acquisition event exists to show an individual unit), but the naming
// rule is part of the data model regardless.
export function naturalResourceTierName(speciesId, tier) {
  return `${NATURAL_QUALITY_PREFIX[tier]}${NATURAL_RESOURCES[speciesId].name}`;
}

export const NATURAL_RESOURCES = {
  baseCream: { id: "baseCream", name: "ベースクリーム", abbr: "BC" },
  squeezedFructoseLiquid: { id: "squeezedFructoseLiquid", name: "シボリ果糖液", abbr: "シ果", qualityTiers: NATURAL_QUALITY_TIERS },
  gummyElasticMaterial: { id: "gummyElasticMaterial", name: "口香弾性質", abbr: "口香", qualityTiers: NATURAL_QUALITY_TIERS },
  waferMembraneObject: { id: "waferMembraneObject", name: "糖衣膜状物体", abbr: "糖膜", qualityTiers: NATURAL_QUALITY_TIERS },
  sableSoftGravel: { id: "sableSoftGravel", name: "サブレ軟性塊", abbr: "サ軟", qualityTiers: NATURAL_QUALITY_TIERS },
  electroMagneticGelatin: { id: "electroMagneticGelatin", name: "電磁性ゼラチン", abbr: "電ゼ", qualityTiers: NATURAL_QUALITY_TIERS },
};

const RIGID_QUALITY_SUFFIX = { low: "-", mid: "", high: "+", highest: "++" };
export const RIGID_QUALITY_LABELS = { low: "低", mid: "中", high: "高", highest: "最高" };
const RIGID_QUALITY_TIERS_3 = ["low", "mid", "high"];
const RIGID_QUALITY_TIERS_4 = ["low", "mid", "high", "highest"];

// Full display name for one quality of a (non-琥珀糖鉱石) rigid resource
// species, e.g. "カカオ堆積岩+" for a 高品質 one. See
// naturalResourceTierName's note above — not called by today's screens.
export function rigidResourceTierName(speciesId, tier) {
  return `${RIGID_RESOURCES[speciesId].name}${RIGID_QUALITY_SUFFIX[tier]}`;
}

// Every rigid resource but ザラメ鉱石 and 琥珀糖鉱石 has fixed
// performance stats per quality tier (statsByTier), tracked as a
// {tier: count} bucket like a natural resource. ザラメ鉱石 has no
// quality variance at all (a flat `stats` + plain quantity, like
// ベースクリーム among natural resources). 琥珀糖鉱石 is marked
// `variableStats` instead of statsByTier: see rollAmberSugarMineralStats
// below for why it can't work that way. Each statsByTier's "mid" entry
// is this species' original (pre-quality-system) fixed stats.
// Key order below matches the required display order for both display
// modes (短縮表示/個別表示), which groups each rigid resource with the
// natural resource sharing its color (see RESOURCE_COLOR_CLASS) --
// ザラメ, アメダマ螺旋鉱, カカオ堆積岩, ソルベ永久氷柱, ヒボシ果糖岩,
// ハチミツ結晶鉱, 琥珀糖鉱石, 甘蔗繊維質, 高純度糖鉱.
export const RIGID_RESOURCES = {
  coarseSugarMineral: {
    id: "coarseSugarMineral",
    name: "ザラメ鉱石",
    abbr: "ザラメ",
    stats: { sweetness: 1, hardness: 1, poisonResist: 1, stability: 1, flexibility: 1 },
  },
  dropSpiralOre: {
    id: "dropSpiralOre",
    name: "アメダマ螺旋鉱",
    abbr: "ア螺",
    qualityTiers: RIGID_QUALITY_TIERS_3,
    statsByTier: {
      low: { sweetness: 2, hardness: 1, poisonResist: 1, stability: 0, flexibility: 1 },
      mid: { sweetness: 3, hardness: 2, poisonResist: 2, stability: 1, flexibility: 2 },
      high: { sweetness: 4, hardness: 3, poisonResist: 3, stability: 2, flexibility: 3 },
    },
  },
  cacaoLayeredRock: {
    id: "cacaoLayeredRock",
    name: "カカオ堆積岩",
    abbr: "カ堆",
    qualityTiers: RIGID_QUALITY_TIERS_3,
    statsByTier: {
      low: { sweetness: 1, hardness: 2, poisonResist: 0, stability: 1, flexibility: 1 },
      mid: { sweetness: 2, hardness: 3, poisonResist: 1, stability: 2, flexibility: 2 },
      high: { sweetness: 3, hardness: 4, poisonResist: 2, stability: 3, flexibility: 3 },
    },
  },
  sorbetEternalIce: {
    id: "sorbetEternalIce",
    name: "ソルベ永久氷柱",
    abbr: "ソ永",
    qualityTiers: RIGID_QUALITY_TIERS_3,
    statsByTier: {
      low: { sweetness: 1, hardness: 1, poisonResist: 2, stability: 1, flexibility: 0 },
      mid: { sweetness: 2, hardness: 2, poisonResist: 3, stability: 2, flexibility: 1 },
      high: { sweetness: 3, hardness: 3, poisonResist: 4, stability: 3, flexibility: 2 },
    },
  },
  driedFructoseRock: {
    id: "driedFructoseRock",
    name: "ヒボシ果糖岩",
    abbr: "ヒ果",
    qualityTiers: RIGID_QUALITY_TIERS_3,
    statsByTier: {
      low: { sweetness: 1, hardness: 0, poisonResist: 1, stability: 2, flexibility: 1 },
      mid: { sweetness: 2, hardness: 1, poisonResist: 2, stability: 3, flexibility: 2 },
      high: { sweetness: 3, hardness: 2, poisonResist: 3, stability: 4, flexibility: 3 },
    },
  },
  honeyCrystalOre: {
    id: "honeyCrystalOre",
    name: "ハチミツ結晶鉱",
    abbr: "ハ結",
    qualityTiers: RIGID_QUALITY_TIERS_3,
    statsByTier: {
      low: { sweetness: 0, hardness: 1, poisonResist: 1, stability: 1, flexibility: 2 },
      mid: { sweetness: 1, hardness: 2, poisonResist: 2, stability: 2, flexibility: 3 },
      high: { sweetness: 2, hardness: 3, poisonResist: 3, stability: 3, flexibility: 4 },
    },
  },
  amberSugarMineral: {
    id: "amberSugarMineral",
    name: "琥珀糖鉱石",
    abbr: "琥珀",
    variableStats: true,
  },
  sugarCaneFiber: {
    id: "sugarCaneFiber",
    name: "甘蔗繊維質",
    abbr: "甘蔗",
    qualityTiers: RIGID_QUALITY_TIERS_4,
    statsByTier: {
      low: { sweetness: 0, hardness: 2, poisonResist: 2, stability: 3, flexibility: 3 },
      mid: { sweetness: 0, hardness: 3, poisonResist: 3, stability: 3, flexibility: 3 },
      high: { sweetness: 2, hardness: 3, poisonResist: 3, stability: 3, flexibility: 3 },
      highest: { sweetness: 4, hardness: 3, poisonResist: 3, stability: 3, flexibility: 3 },
    },
  },
  highPuritySugar: {
    id: "highPuritySugar",
    name: "高純度糖鉱",
    abbr: "純糖",
    qualityTiers: RIGID_QUALITY_TIERS_4,
    statsByTier: {
      low: { sweetness: 3, hardness: 3, poisonResist: 0, stability: 0, flexibility: 0 },
      mid: { sweetness: 4, hardness: 4, poisonResist: 0, stability: 0, flexibility: 0 },
      high: { sweetness: 4, hardness: 4, poisonResist: 2, stability: 2, flexibility: 2 },
      highest: { sweetness: 4, hardness: 4, poisonResist: 4, stability: 4, flexibility: 4 },
    },
  },
};

// Flavor text shown in 資源置き場画面's 内訳表示 -- one entry per
// natural/rigid species (never shown for anything else, so no
// per-quality variants needed).
export const RESOURCE_DESCRIPTIONS = {
  baseCream: "カトラリーやオブラートを製造・強化するための下地となる。",
  squeezedFructoseLiquid: "高い糖度を有する液体。あらゆる物体と親和する。",
  gummyElasticMaterial: "溶解させて精製した液体がコーティングに適する。",
  waferMembraneObject: "起源不明の透明な膜。毒の侵食を遅延させる効果がある。",
  sableSoftGravel: "とても細かく砕ける、ヤスリや型抜きなどに適する砂礫。",
  electroMagneticGelatin: "微弱な磁性を帯びたゲル質。なじませた物体を柔軟にする。",
  coarseSugarMineral: "入手しやすく加工もしやすい。貨幣や保護材への使用に適している。",
  amberSugarMineral: "性質や品質の振れ幅が大きい、採掘や加工の精度次第で評価が変わる。",
  cacaoLayeredRock: "瞬間的な衝撃に耐え得る素材として優秀。",
  driedFructoseRock: "結合度がとても高く、紙にも加工できる。",
  honeyCrystalOre: "しなるような構造への利用に最も適している。",
  dropSpiralOre: "鋭利な構造への利用に最も適している。",
  sorbetEternalIce: "魔術組成を必要とする道具などに使われる。",
  sugarCaneFiber: "緻密な構造への利用に最も適している。企業需要が高くとても高価。",
  highPuritySugar: "奇跡の鉱石。最も純度の高いものは、毒に対する完全な免疫を持つという。",
};

// Lets a player see at a glance how many of the materials for a given
// 能力値-flavored weapon upgrade they're holding: each rigid resource
// shares a color with the one natural resource "on the same theme",
// reusing the exact 能力値/性能値 hues from theme.css. 琥珀糖鉱石 and
// 甘蔗繊維質 don't fit that pairing (their random/uniquely-flexible
// stats don't line up with a single theme) and stay uncolored;
// 高純度糖鉱 gets its own distinct color instead, to flag its rarity.
export const RESOURCE_COLOR_CLASS = {
  coarseSugarMineral: "stat-hp",
  baseCream: "stat-hp",
  dropSpiralOre: "stat-attack",
  squeezedFructoseLiquid: "stat-attack",
  cacaoLayeredRock: "stat-defense",
  gummyElasticMaterial: "stat-defense",
  sorbetEternalIce: "stat-destruction",
  waferMembraneObject: "stat-destruction",
  driedFructoseRock: "stat-wisdom",
  sableSoftGravel: "stat-wisdom",
  honeyCrystalOre: "stat-coordination",
  electroMagneticGelatin: "stat-coordination",
  highPuritySugar: "resource-premium",
};

// 琥珀糖鉱石 rolls fresh performance stats every time one turns up; the 5
// values are random but always add up to a quality-dependent total (see
// AMBER_QUALITY_POINTS), which breaks the usual rigid-resource model in
// three ways: it has no fixed rank to list in the catalog above; a
// simple quantity counter can't represent "3 of them" when each one is
// actually different; and using one (e.g. to forge a weapon) means
// picking a specific rolled instance, not just decrementing a count. So
// unlike the tiered/fixed-stat resources, this species is never tallied
// as a number — every one that turns up becomes its own instance (see
// createAmberSugarMineralInstance), the same way weapons and characters
// are individuals rather than a stack. Its display name embeds its own
// stats directly (see amberSugarMineralName), so unlike the other rigid
// resources it needs no -/(none)/+/++ quality suffix.
export const AMBER_QUALITY_POINTS = { low: 5, mid: 10, high: 15 };
const STAT_KEYS = ["sweetness", "hardness", "poisonResist", "stability", "flexibility"];
const STAT_MAX_RANK = 4;

export function rollAmberSugarMineralStats(totalPoints) {
  const stats = { sweetness: 0, hardness: 0, poisonResist: 0, stability: 0, flexibility: 0 };
  let remaining = totalPoints;
  while (remaining > 0) {
    const eligible = STAT_KEYS.filter((key) => stats[key] < STAT_MAX_RANK);
    if (eligible.length === 0) break;
    const key = eligible[Math.floor(Math.random() * eligible.length)];
    stats[key] += 1;
    remaining -= 1;
  }
  return stats;
}

// The 5-digit "型番" (model number) embedded in 琥珀糖鉱石's own name:
// its 性能評価 (same D/C/B/A/S bands as a weapon's) followed by its 5
// raw stat digits in STAT_KEYS order — e.g. stats {sweetness:0,
// hardness:1, poisonResist:2, stability:3, flexibility:4} (rating B)
// becomes "B-01234".
export function computeAmberModelNumber(stats) {
  const digits = STAT_KEYS.map((key) => stats[key]).join("");
  return `${computeWeaponRating(stats)}-${digits}`;
}

export function amberSugarMineralName(stats) {
  return `${RIGID_RESOURCES.amberSugarMineral.name}_${computeAmberModelNumber(stats)}型`;
}

export function createAmberSugarMineralInstance(quality) {
  const stats = rollAmberSugarMineralStats(AMBER_QUALITY_POINTS[quality]);
  return {
    id: `amberSugarMineral-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    stats,
    modelNumber: computeAmberModelNumber(stats),
    name: amberSugarMineralName(stats),
  };
}

// A fresh { natural, rigid } resources object. Shape per species:
//  - ベースクリーム / ザラメ鉱石: a plain number (no quality variance).
//  - 琥珀糖鉱石: an array of individual instances (see
//    createAmberSugarMineralInstance) — never a count.
//  - everything else: a {tier: count} bucket, one key per the species'
//    qualityTiers.
export function createEmptyResources() {
  const natural = {};
  for (const [key, species] of Object.entries(NATURAL_RESOURCES)) {
    natural[key] = species.qualityTiers ? Object.fromEntries(species.qualityTiers.map((tier) => [tier, 0])) : 0;
  }
  const rigid = {};
  for (const [key, species] of Object.entries(RIGID_RESOURCES)) {
    if (species.variableStats) rigid[key] = [];
    else if (species.qualityTiers) rigid[key] = Object.fromEntries(species.qualityTiers.map((tier) => [tier, 0]));
    else rigid[key] = 0;
  }
  return { natural, rigid };
}

// Sums every tier's count for a {tier: count} bucket.
function sumTiers(bucket) {
  return Object.values(bucket).reduce((total, qty) => total + qty, 0);
}

// The single highest tier (per `qualityTiers`, always worst-to-best)
// that currently has any count, with its own count — e.g. for
// {mid:3, high:0, premium:0} that's ("mid", 3); for {mid:3, high:2,
// premium:0} it's ("high", 2). Never called on an all-zero bucket (see
// callers' own total>0 guard).
function topNonZeroTier(bucket, qualityTiers) {
  for (let i = qualityTiers.length - 1; i >= 0; i--) {
    const tier = qualityTiers[i];
    if (bucket[tier] > 0) return { tier, qty: bucket[tier] };
  }
  return null;
}

// Groups a list of 琥珀糖鉱石 instances by their exact 型番, sorted best
// (highest total stat points) first. Shared by describeResources (short
// display) and describeResourcesIndividually (full display) below.
function groupAmberInstances(instances) {
  const byModel = new Map();
  for (const instance of instances) {
    const sum = STAT_KEYS.reduce((total, key) => total + instance.stats[key], 0);
    const entry = byModel.get(instance.modelNumber) ?? { modelNumber: instance.modelNumber, qty: 0, sum };
    entry.qty += 1;
    byModel.set(instance.modelNumber, entry);
  }
  return [...byModel.values()].sort((a, b) => b.sum - a.sum);
}

function amberStatSum(stats) {
  return STAT_KEYS.reduce((total, key) => total + stats[key], 0);
}

// ---------------------------------------------------------------------
// 鍛冶画面 (武器製造): フレーム/モジュール selection.
// ---------------------------------------------------------------------
// Every function here is pure (takes `resources` explicitly, same
// convention as describeResources/describeResourcesIndividually) --
// the actual mutation of the player's real holdings only happens at
// 製造完了 time, via state.js's consumeRigidFrame/consumeModulePick.

// Total held of a rigid species regardless of its shape (flat number,
// {tier: count} bucket, or an array of 琥珀糖鉱石 instances).
function sumRigidHeld(resources, speciesId) {
  const species = RIGID_RESOURCES[speciesId];
  const value = resources.rigid[speciesId];
  if (species.variableStats) return value.length;
  if (!species.qualityTiers) return value;
  return sumTiers(value);
}

// Whether the player holds enough of a weapon type's フレーム species,
// in aggregate across every quality/instance -- this is the sole gate
// on 鍛冶画面's per-weapon buttons (ベースクリーム isn't checked here;
// that's 武器製造画面's own "製造開始！" gate instead).
export function hasEnoughFrame(resources, weaponTypeId) {
  const { speciesId, quantity } = WEAPON_TYPES[weaponTypeId].frame;
  return sumRigidHeld(resources, speciesId) >= quantity;
}

// Picks `quantity` units of `speciesId` preferring the lowest quality
// first, without mutating `resources`. Only ever called once, when
// 武器製造画面 mounts (see that screen -- the frame selection is never
// recomputed afterward), and only for a weapon type 鍛冶画面 already
// gated on hasEnoughFrame, so `quantity` is always satisfiable. Returns
// a breakdown shape state.js's consumeRigidFrame can apply directly at
// 製造完了 time: {speciesId, tierBreakdown} for a quality-tiered
// species, {speciesId, instanceIds} for 琥珀糖鉱石, or {speciesId,
// flatQuantity} for a flat species (only ザラメ鉱石, never actually
// used as a frame today, but handled for completeness).
export function pickLowestQualityFrame(resources, speciesId, quantity) {
  const species = RIGID_RESOURCES[speciesId];
  const value = resources.rigid[speciesId];
  if (species.variableStats) {
    const sorted = [...value].sort((a, b) => amberStatSum(a.stats) - amberStatSum(b.stats));
    return { speciesId, instanceIds: sorted.slice(0, quantity).map((instance) => instance.id) };
  }
  if (!species.qualityTiers) {
    return { speciesId, flatQuantity: Math.min(value, quantity) };
  }
  const tierBreakdown = {};
  let remaining = quantity;
  for (const tier of species.qualityTiers) {
    if (remaining <= 0) break;
    const take = Math.min(value[tier], remaining);
    if (take > 0) tierBreakdown[tier] = take;
    remaining -= take;
  }
  return { speciesId, tierBreakdown };
}

// A view of `resources` with a pending フレーム reservation already
// subtracted out, so 資源置き場画面's モジュール選択モード can't offer
// (and thus double-book) the exact units already earmarked as フレーム
// for the weapon currently being forged. Everything but the reserved
// species' own bucket is shared by reference (safe: nothing here
// mutates its input).
export function resourcesMinusFrameReservation(resources, frameReservation) {
  if (!frameReservation) return resources;
  const { speciesId } = frameReservation;
  const species = RIGID_RESOURCES[speciesId];
  const rigid = { ...resources.rigid };
  if (species.variableStats) {
    const excluded = new Set(frameReservation.instanceIds);
    rigid[speciesId] = resources.rigid[speciesId].filter((instance) => !excluded.has(instance.id));
  } else if (species.qualityTiers) {
    const bucket = { ...resources.rigid[speciesId] };
    for (const [tier, qty] of Object.entries(frameReservation.tierBreakdown)) {
      bucket[tier] = Math.max(0, bucket[tier] - qty);
    }
    rigid[speciesId] = bucket;
  } else {
    rigid[speciesId] = Math.max(0, resources.rigid[speciesId] - frameReservation.flatQuantity);
  }
  return { natural: resources.natural, rigid };
}

// Every 琥珀糖鉱石 型番 group currently tied for the highest quality
// (see groupAmberInstances -- normally just one, but a genuine tie
// means 資源置き場画面's モジュール選択モード must let the player pick
// which 型番 rather than grabbing one arbitrarily).
export function amberTopGroups(instances) {
  const groups = groupAmberInstances(instances);
  if (!groups.length) return [];
  const topSum = groups[0].sum;
  return groups.filter((group) => group.sum === topSum);
}

// The single highest-quality unit of a NON-琥珀糖鉱石 rigid species
// (資源置き場画面's モジュール選択モード calls amberTopGroups instead
// for 琥珀糖鉱石, since a tie there needs the player's own choice).
// Returns null if none are held. `stats` is exactly what the crafted
// weapon will receive (see craftWeapon) -- the whole reason a module
// pick carries its resolved stats up front rather than just an id.
export function pickBestModuleUnit(resources, speciesId) {
  const species = RIGID_RESOURCES[speciesId];
  const value = resources.rigid[speciesId];
  if (!species.qualityTiers) {
    return value > 0 ? { speciesId, stats: species.stats, displayName: species.name } : null;
  }
  const top = topNonZeroTier(value, species.qualityTiers);
  if (!top) return null;
  return { speciesId, tier: top.tier, stats: species.statsByTier[top.tier], displayName: rigidResourceTierName(speciesId, top.tier) };
}

// Builds a module pick descriptor for one specific 琥珀糖鉱石 instance
// (the player's choice among amberTopGroups' tied 型番 candidates, or
// the sole top group when there's no tie).
export function pickAmberModuleInstance(resources, instanceId) {
  const instance = resources.rigid.amberSugarMineral.find((i) => i.id === instanceId);
  if (!instance) return null;
  return { speciesId: "amberSugarMineral", instanceId: instance.id, stats: instance.stats, displayName: instance.name };
}

// Creates a weapon with exactly the given stats -- unlike forgeWeapon
// (which looks up a fixed "mid" tier or freshly rolls 琥珀糖鉱石 stats,
// for the unrelated 初期雇用 flow), 鍛冶画面's 武器製造 hands the
// weapon whatever stats the player's chosen module resource actually
// has, per the user's own spec ("フレーム側の品質や性能値は一切見ま
// せん").
export function craftWeapon(weaponTypeId, moduleStats) {
  return createWeapon({
    id: `weapon-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    baseTypeId: weaponTypeId,
    stats: moduleStats,
  });
}

// ---------------------------------------------------------------------
// 武器強化画面
// ---------------------------------------------------------------------

// Which single 自然資源 species a 性能値's enhancement draws from --
// this happens to already match RESOURCE_COLOR_CLASS's own pairing
// (シボリ果糖液=red=attack/糖度, 口香弾性質=blue=defense/硬性, etc.),
// so the same `stat-${charKey}` color classes used everywhere else
// double as this screen's gauge/button colors with no new palette.
export const NATURAL_SPECIES_BY_WEAPON_STAT = {
  sweetness: "squeezedFructoseLiquid",
  hardness: "gummyElasticMaterial",
  poisonResist: "waferMembraneObject",
  stability: "sableSoftGravel",
  flexibility: "electroMagneticGelatin",
};

// Index i = the cost to raise a 性能値 from level i to i+1 (0->1,
// 1->2, 2->3, 3->4), as the natural-resource quantity needed from
// EACH quality tier (only one tier's worth is actually spent -- see
// affordableEnhanceTier below).
const WEAPON_STAT_UPGRADE_COST = [
  { mid: 1, high: 1, premium: 1 },
  { mid: 3, high: 1, premium: 1 },
  { mid: 10, high: 3, premium: 1 },
  { mid: 30, high: 10, premium: 3 },
];

const ENHANCE_BASECREAM_COST_BY_RATING = { D: 1, C: 1, B: 3, A: 10, S: 30 };

// Which quality tier of `bucket` a `cost` can actually be paid from,
// preferring the lowest (least valuable) tier the player can afford --
// the same "spend the cheapest stock first" preference
// pickLowestQualityFrame applies to フレーム material. null if none of
// the three tiers alone cover the cost.
function affordableEnhanceTier(bucket, cost) {
  if (bucket.mid >= cost.mid) return "mid";
  if (bucket.high >= cost.high) return "high";
  if (bucket.premium >= cost.premium) return "premium";
  return null;
}

// The exact plan (which tier, how much of it, how much ベースクリーム)
// for raising one 性能値 by one level, or null if the player can't
// currently afford it (already maxed out, lacking the natural resource
// in any single tier, or lacking ベースクリーム at the weapon's current
// 武器評価 -- see ENHANCE_BASECREAM_COST_BY_RATING). Pure: state.js's
// enhanceWeaponStat applies exactly this plan; weaponEnhance.js's own
// canEnhanceWeaponStat below just checks whether one exists.
export function resolveEnhancePlan(resources, weapon, statKey) {
  const value = weapon.stats[statKey];
  if (value >= 4) return null;
  const speciesId = NATURAL_SPECIES_BY_WEAPON_STAT[statKey];
  const cost = WEAPON_STAT_UPGRADE_COST[value];
  const tier = affordableEnhanceTier(resources.natural[speciesId], cost);
  if (!tier) return null;
  const baseCreamCost = ENHANCE_BASECREAM_COST_BY_RATING[computeWeaponRating(weapon.stats)];
  if ((resources.natural.baseCream ?? 0) < baseCreamCost) return null;
  return { speciesId, tier, naturalCost: cost[tier], baseCreamCost };
}

export function canEnhanceWeaponStat(resources, weapon, statKey) {
  return resolveEnhancePlan(resources, weapon, statKey) !== null;
}

// The ベースクリーム a weapon's NEXT enhancement (of any 性能値) would
// cost at its current 武器評価 -- shown once up front on
// 武器強化画面 ("強化のたびにベースクリームを N 消費"), rather than
// recomputed per-stat since it only depends on the weapon as a whole.
export function enhanceBaseCreamCost(weapon) {
  return ENHANCE_BASECREAM_COST_BY_RATING[computeWeaponRating(weapon.stats)];
}

// These species stay in the 短縮表示 (HUD) even at zero count, so the
// player can always see how stocked up they are on upgrade materials at
// a glance; a zero-count entry among them renders in the default text
// color instead of its usual RESOURCE_COLOR_CLASS (see the `zero` flag
// below and dom.js's hudLine). Every other species (琥珀糖鉱石, 甘蔗繊維
// 質, 高純度糖鉱) keeps the old skip-when-empty behavior. 個別表示
// (describeResourcesIndividually) is unaffected by this and always
// skips zero-count entries regardless of species.
const ALWAYS_SHOW_SHORT_NATURAL = new Set([
  "baseCream",
  "squeezedFructoseLiquid",
  "gummyElasticMaterial",
  "waferMembraneObject",
  "sableSoftGravel",
  "electroMagneticGelatin",
]);
const ALWAYS_SHOW_SHORT_RIGID = new Set([
  "coarseSugarMineral",
  "dropSpiralOre",
  "cacaoLayeredRock",
  "sorbetEternalIce",
  "driedFructoseRock",
  "honeyCrystalOre",
]);

// 短縮表示 (resource HUD, every screen but 部隊編成画面/探索結果):
// one entry per held species, skipping anything not held at all unless
// it's in the always-show sets above. A species with no quality
// variance (ベースクリーム/ザラメ鉱石) is just "abbr×qty"; every other
// species is "abbr×total(topTierQty)", read as "qty total, of which the
// single best quality tier held accounts for topTierQty" (see the
// user's own worked example for シボリ果糖液). 琥珀糖鉱石 treats the
// 型番 group with the highest total stat points as "the best quality
// tier" for that same parenthetical. Returns {natural, rigid} (rigid
// shown above natural in the HUD) so the caller can render them as two
// separate lines; each entry carries its `speciesId` for
// RESOURCE_COLOR_CLASS lookups, plus `zero: true` when it's an
// always-shown entry with nothing held (so the caller skips coloring).
export function describeResources(resources) {
  if (!resources) return { natural: [], rigid: [] };

  function describeOne(key, species, value, alwaysShow) {
    if (species.variableStats) {
      if (!value.length) return null;
      const best = groupAmberInstances(value)[0];
      return { speciesId: key, text: `${species.abbr}×${value.length}(${best.qty})` };
    }
    if (!species.qualityTiers) {
      if (value > 0) return { speciesId: key, text: `${species.abbr}×${value}` };
      return alwaysShow ? { speciesId: key, text: `${species.abbr}×0`, zero: true } : null;
    }
    const total = sumTiers(value);
    if (total === 0) {
      return alwaysShow ? { speciesId: key, text: `${species.abbr}×0`, zero: true } : null;
    }
    const top = topNonZeroTier(value, species.qualityTiers);
    return { speciesId: key, text: `${species.abbr}×${total}(${top.qty})` };
  }

  const natural = Object.entries(NATURAL_RESOURCES)
    .map(([key, species]) => describeOne(key, species, resources.natural[key], ALWAYS_SHOW_SHORT_NATURAL.has(key)))
    .filter(Boolean);
  const rigid = Object.entries(RIGID_RESOURCES)
    .map(([key, species]) => describeOne(key, species, resources.rigid[key], ALWAYS_SHOW_SHORT_RIGID.has(key)))
    .filter(Boolean);
  return { natural, rigid };
}

// 個別表示 (部隊編成画面、探索結果画面): every held quality/型番 counted
// and shown separately -- a species with nothing held at all is
// omitted entirely, as is any zero-count tier within a shown entry.
// Returns {natural, rigid} (natural section shown above rigid here --
// the opposite order from describeResources' HUD, per spec). Each
// entry is {speciesId, label, detail} rather than one flat string, so
// the caller can color just the label portion (see
// resourceDisplay.js's use of RESOURCE_COLOR_CLASS).
export function describeResourcesIndividually(resources) {
  if (!resources) return { natural: [], rigid: [] };

  function describeOne(key, species, value, tierLabels) {
    const label = `［${species.name}(${species.abbr})］`;
    if (!species.variableStats && !species.qualityTiers) {
      return value > 0 ? { speciesId: key, label, detail: `${value}個` } : null;
    }
    if (species.variableStats) {
      if (!value.length) return null;
      const parts = groupAmberInstances(value).map((group) => `${group.modelNumber}: ${group.qty}個`);
      return { speciesId: key, label, detail: `計${value.length}個［${parts.join(" / ")}］` };
    }
    const total = sumTiers(value);
    if (total === 0) return null;
    const parts = species.qualityTiers.filter((tier) => value[tier] > 0).map((tier) => `${tierLabels[tier]}: ${value[tier]}個`);
    return { speciesId: key, label, detail: `計${total}個［${parts.join(" / ")}］` };
  }

  const natural = Object.entries(NATURAL_RESOURCES)
    .map(([key, species]) => describeOne(key, species, resources.natural[key], NATURAL_QUALITY_LABELS))
    .filter(Boolean);
  const rigid = Object.entries(RIGID_RESOURCES)
    .map(([key, species]) => describeOne(key, species, resources.rigid[key], RIGID_QUALITY_LABELS))
    .filter(Boolean);
  return { natural, rigid };
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

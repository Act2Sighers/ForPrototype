// 探索イベント固有のロジック: 採集能力/採掘能力/監督能力の算出、環境
// （土壌/地質/属性）ごとの品質帯テーブル、判定成功数からの報酬決定。
// Pure data + pure functions only -- no state mutation (that happens in
// scenes/exploration.js via state.js's grant helpers, the same split
// episode.js already follows for its own effects).
import { computeStats, RIGID_RESOURCES } from "./resourceCatalog.js";

export function computeGatherAbility(character) {
  const s = computeStats(character);
  return Math.max(s.defense, s.wisdom);
}

export function computeMineAbility(character) {
  const s = computeStats(character);
  return Math.max(s.attack, s.destruction);
}

export function computeSuperviseAbility(character) {
  return computeStats(character).coordination;
}

// Which single growth stat a character's 採集/採掘能力 actually came
// from this run -- ties broken uniformly at random. Only meaningful at
// the moment growth is applied (phase③); the ability *value* is the
// same regardless of which tied stat "wins".
export function gatherGrowthStatKey(character) {
  const s = computeStats(character);
  if (s.defense === s.wisdom) return Math.random() < 0.5 ? "defense" : "wisdom";
  return s.defense > s.wisdom ? "defense" : "wisdom";
}

export function mineGrowthStatKey(character) {
  const s = computeStats(character);
  if (s.attack === s.destruction) return Math.random() < 0.5 ? "attack" : "destruction";
  return s.attack > s.destruction ? "attack" : "destruction";
}

// Quality-band tables: ordered worst-to-best, one entry per band, each
// covering a [min,max] range of 成功数. `quality: null` is "獲得無し".
// Environments other than "標準" (harder dungeons, special nodes) would
// supply their own bands/pools here later -- nothing else in this file
// assumes "standard" is the only one that will ever exist.
const STANDARD_SOIL_BANDS = [
  { quality: null, min: 0, max: 0 },
  { quality: "mid", min: 1, max: 2 },
  { quality: "high", min: 3, max: 4 },
  { quality: "premium", min: 5, max: Infinity },
];

const STANDARD_GEOLOGY_BANDS = [
  { quality: null, min: 0, max: 0 },
  { quality: "low", min: 1, max: 2 },
  { quality: "mid", min: 3, max: 4 },
  { quality: "high", min: 5, max: 6 },
  { quality: "highest", min: 7, max: Infinity },
];

// How many of the bottom bands (index 0 = "獲得無し") trigger a
// supervisor call when that's all a member could muster: 採集 only
// calls on true 獲得無し, 採掘 also calls on its lowest quality band.
const GATHER_CALL_BAND_INDEX_MAX = 0;
const MINE_CALL_BAND_INDEX_MAX = 1;

export const STANDARD_ENVIRONMENT = {
  soilLabel: "標準",
  geologyLabel: "標準",
  attributeLabel: "全て",
  soilBands: STANDARD_SOIL_BANDS,
  geologyBands: STANDARD_GEOLOGY_BANDS,
  // 属性：全て -- every quality-tiered natural species (ベースクリーム
  // has no quality to award, so it's exempt) / every quality-tiered
  // rigid species except ザラメ鉱石 (exempt, same reason) and 高純度糖鉱
  // (locked to a future high-difficulty dungeon per the 遭遇 script's
  // own note). 琥珀糖鉱石 participates too -- see pickMineReward.
  naturalSpeciesPool: [
    "squeezedFructoseLiquid",
    "gummyElasticMaterial",
    "waferMembraneObject",
    "sableSoftGravel",
    "electroMagneticGelatin",
  ],
  rigidSpeciesPool: [
    "cacaoLayeredRock",
    "driedFructoseRock",
    "honeyCrystalOre",
    "dropSpiralOre",
    "sorbetEternalIce",
    "sugarCaneFiber",
    "amberSugarMineral",
  ],
};

function resolveBand(successCount, bands) {
  const index = bands.findIndex((band) => successCount >= band.min && successCount <= band.max);
  return { quality: bands[index].quality, index };
}

export function resolveGatherBand(successCount, environment = STANDARD_ENVIRONMENT) {
  return resolveBand(successCount, environment.soilBands);
}

export function resolveMineBand(successCount, environment = STANDARD_ENVIRONMENT) {
  return resolveBand(successCount, environment.geologyBands);
}

export function needsGatherSupervisor(successCount, environment = STANDARD_ENVIRONMENT) {
  return resolveGatherBand(successCount, environment).index <= GATHER_CALL_BAND_INDEX_MAX;
}

export function needsMineSupervisor(successCount, environment = STANDARD_ENVIRONMENT) {
  return resolveMineBand(successCount, environment).index <= MINE_CALL_BAND_INDEX_MAX;
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// Resolves one 採集 round's outcome: null (獲得無し) or
// { category: "natural", speciesId, quality }.
export function pickGatherReward(successCount, environment = STANDARD_ENVIRONMENT) {
  const { quality } = resolveGatherBand(successCount, environment);
  if (quality === null) return null;
  const speciesId = pickRandom(environment.naturalSpeciesPool);
  return { category: "natural", speciesId, quality };
}

// Resolves one 採掘 round's outcome: null, { category: "amber", quality
// }, or { category: "rigid", speciesId, quality }. A species with no
// "highest" tier of its own (every rigid resource but 甘蔗繊維質, amber
// included) clamps a "highest" roll down to "high" instead.
export function pickMineReward(successCount, environment = STANDARD_ENVIRONMENT) {
  const { quality } = resolveMineBand(successCount, environment);
  if (quality === null) return null;
  const speciesId = pickRandom(environment.rigidSpeciesPool);
  if (speciesId === "amberSugarMineral") {
    return { category: "amber", quality: quality === "highest" ? "high" : quality };
  }
  const species = RIGID_RESOURCES[speciesId];
  const clampedQuality = species.qualityTiers.includes(quality) ? quality : "high";
  return { category: "rigid", speciesId, quality: clampedQuality };
}

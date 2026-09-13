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

// トウド(攻撃力)'s base value sits 2 higher than シゲキ(破壊力)'s (see
// CHARACTER_BASE), which without correction made 採掘能力 favor トウド
// almost every time. Subtracting that gap back out here levels the two
// stats; whenever トウド is the one actually used, the ability value
// (and only the ability value -- growth still targets raw attack, see
// mineGrowthStatKey) is this reduced figure too.
const MINE_ATTACK_ADJUSTMENT = 2;

export function computeMineAbility(character) {
  const s = computeStats(character);
  return Math.max(s.attack - MINE_ATTACK_ADJUSTMENT, s.destruction);
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
  const adjustedAttack = s.attack - MINE_ATTACK_ADJUSTMENT;
  if (adjustedAttack === s.destruction) return Math.random() < 0.5 ? "attack" : "destruction";
  return adjustedAttack > s.destruction ? "attack" : "destruction";
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

// ---------------------------------------------------------------------
// 自動割り当て (phase① "自動割り当て" button)
// ---------------------------------------------------------------------

// All k-sized index subsets of [0, n), as arrays of indices.
function combinations(n, k) {
  if (k > n) return [];
  const results = [];
  const combo = [];
  function backtrack(start) {
    if (combo.length === k) {
      results.push([...combo]);
      return;
    }
    for (let i = start; i < n; i++) {
      combo.push(i);
      backtrack(i + 1);
      combo.pop();
    }
  }
  backtrack(0);
  return results;
}

// Scores one candidate 採集/採掘 group the way it will actually play out
// in phase②: a group of 2+ always ends up with whichever member has
// the highest 監督能力 as its supervisor (see explorationSim.js's own
// pickSupervisor), contributing their 監督能力 instead of their
// 採集/採掘能力, while every other member contributes their own
// ability. A solo group just uses that one ability directly. When
// several members tie for the top 監督能力, the tie is broken toward
// whichever leaves the higher-scoring remainder -- this is what lets a
// near-tied-but-not-quite-highest coordinator still "win" the
// supervisor slot in the overall optimum when doing so frees up a
// better 採集/採掘能力 elsewhere in the group.
function scoreGroup(members, abilityKey) {
  if (members.length === 0) return 0;
  if (members.length === 1) return members[0][abilityKey];
  const maxSupervise = Math.max(...members.map((m) => m.supervise));
  const supervisorCandidates = members.filter((m) => m.supervise === maxSupervise);
  let best = -Infinity;
  for (const supervisor of supervisorCandidates) {
    const rest = members.filter((m) => m !== supervisor);
    const total = maxSupervise + rest.reduce((sum, m) => sum + m[abilityKey], 0);
    if (total > best) best = total;
  }
  return best;
}

// Decides the single best way to split `characters` between the 採集
// and 採掘 groups for the phase① "自動割り当て" button, by exhaustively
// scoring every valid partition (see scoreGroup above) and keeping the
// highest-scoring one. FORMATION_LIMIT+STANDBY_LIMIT caps the eligible
// roster at 12, so even the worst case -- choosing 3 for 採集 and 3 for
// 採掘 out of 12 -- is only ~18,500 combinations, cheap enough to brute
// force exactly rather than risk a heuristic missing the true optimum.
// At full capacity (6 or more characters) both groups are always filled
// to their 3-person cap, leaving the weakest leftovers unassigned;
// below that, the two groups are kept as equal in size as possible,
// trying both orientations when the total is odd (since which group
// gets the extra seat should follow whichever scores higher, not an
// arbitrary default) -- this also naturally reduces to "put the lone
// candidate wherever their better ability lies" at n=1, and to "match
// the two candidates to whichever group each is individually better at"
// at n=2, matching those cases' simpler, supervisor-free math exactly.
export function autoAssignRoles(characters) {
  const n = characters.length;
  if (n === 0) return { gather: [], mine: [] };

  const stats = characters.map((character) => ({
    character,
    gather: computeGatherAbility(character),
    mine: computeMineAbility(character),
    supervise: computeSuperviseAbility(character),
  }));

  const sizePairs =
    n >= 6
      ? [[3, 3]]
      : (() => {
          const low = Math.floor(n / 2);
          const high = n - low;
          return low === high ? [[low, high]] : [[low, high], [high, low]];
        })();

  let best = null;
  for (const [gatherSize, mineSize] of sizePairs) {
    for (const gatherIdx of combinations(n, gatherSize)) {
      const gatherSet = new Set(gatherIdx);
      const remaining = [];
      for (let i = 0; i < n; i++) if (!gatherSet.has(i)) remaining.push(i);
      for (const minePick of combinations(remaining.length, mineSize)) {
        const mineIdx = minePick.map((i) => remaining[i]);
        const gatherStats = gatherIdx.map((i) => stats[i]);
        const mineStats = mineIdx.map((i) => stats[i]);
        const score = scoreGroup(gatherStats, "gather") + scoreGroup(mineStats, "mine");
        if (!best || score > best.score) {
          best = { score, gather: gatherStats.map((s) => s.character), mine: mineStats.map((s) => s.character) };
        }
      }
    }
  }
  return { gather: best.gather, mine: best.mine };
}

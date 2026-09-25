// 探索イベント固有のロジック: 採集能力/採掘能力/監督能力の算出、環境
// （土壌/地質/属性）ごとの品質帯テーブル、判定成功数からの報酬決定。
// Pure data + pure functions only -- no state mutation (that happens in
// scenes/exploration.js via state.js's grant helpers, the same split
// episode.js already follows for its own effects).
import { computeStats } from "./resourceCatalog.js";

export function computeGatherAbility(character) {
  const s = computeStats(character);
  return Math.max(s.defence, s.wisdom);
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
  return Math.max(s.attack - MINE_ATTACK_ADJUSTMENT, s.power);
}

export function computeSuperviseAbility(character) {
  return computeStats(character).sociality;
}

// 進捗度上限：各隊員の担当能力値(A、採集ならcomputeGatherAbility、採掘
// ならcomputeMineAbility)から算出する（3+floor(A/3)）。旧仕様の固定5に
// なるのはAが6〜8の時。
export function computeProgressCap(character, role) {
  const ability = role === "gather" ? computeGatherAbility(character) : computeMineAbility(character);
  return 3 + Math.floor(ability / 3);
}

// 作業監督呼び出しの条件（採集/採掘共通・一律）：成功数が、その班の
// 作業監督自身の監督能力の1/3（切り捨て）以下なら呼び出す。監督能力が
// 高いほど「これくらいの成功数なら任せず自分が判定し直した方が良い」
// という基準が上がる、という考え方。
export function needsSupervisorCall(successCount, superviseAbility) {
  return successCount <= Math.floor(superviseAbility / 3);
}

// Which single growth stat a character's 採集/採掘能力 actually came
// from this run -- ties broken uniformly at random. Only meaningful at
// the moment growth is applied (phase③); the ability *value* is the
// same regardless of which tied stat "wins".
export function gatherGrowthStatKey(character) {
  const s = computeStats(character);
  if (s.defence === s.wisdom) return Math.random() < 0.5 ? "defence" : "wisdom";
  return s.defence > s.wisdom ? "defence" : "wisdom";
}

export function mineGrowthStatKey(character) {
  const s = computeStats(character);
  const adjustedAttack = s.attack - MINE_ATTACK_ADJUSTMENT;
  if (adjustedAttack === s.power) return Math.random() < 0.5 ? "attack" : "power";
  return adjustedAttack > s.power ? "attack" : "power";
}

// 成功数から獲得品質の並びを決める、採集/採掘共通の周回式。tiersは
// 品質3段階を低い順に並べたもの（採集: 中/上/特上、採掘: 低/中/高）。
// 成功数2つごとに1段階進み、3段階（＝成功数6）で1周する：
//  - 1周目（cycle=0）は各段階でtiers[0]→tiers[1]→tiers[2]（1個ずつ）。
//  - 2周目以降（cycle>0）は、それまでの周回数ぶんのtiers[2]（最上位
//    品質）に加えて、その周回内の段階に応じたアイテムをもう1つ追加する
//    （段階0→tiers[0]×1、段階1→tiers[1]×1、段階2→tiers[2]をさらに
//    1個増やす＝tiers[2]×(cycle+1)のみ）。
// 成功数0は獲得無し（空配列）。
const CYCLE_SUCCESS_COUNT = 6;
const STEPS_PER_CYCLE = 3;
const SUCCESS_PER_STEP = CYCLE_SUCCESS_COUNT / STEPS_PER_CYCLE;

function resolveTieredItems(successCount, tiers) {
  if (successCount <= 0) return [];
  const [tierA, tierB, tierC] = tiers;
  const n = successCount - 1;
  const cycle = Math.floor(n / CYCLE_SUCCESS_COUNT);
  const step = Math.floor((n % CYCLE_SUCCESS_COUNT) / SUCCESS_PER_STEP);
  if (step === STEPS_PER_CYCLE - 1) {
    return [{ quality: tierC, count: cycle + 1 }];
  }
  const items = [];
  if (cycle > 0) items.push({ quality: tierC, count: cycle });
  items.push({ quality: step === 0 ? tierA : tierB, count: 1 });
  return items;
}

// Environments other than "標準" (harder dungeons, special nodes) would
// supply their own tiers/pools/thresholds here later -- nothing else in
// this file assumes "standard" is the only one that will ever exist.
export const STANDARD_ENVIRONMENT = {
  soilLabel: "標準",
  geologyLabel: "標準",
  attributeLabel: "全て",
  gatherTiers: ["mid", "high", "premium"],
  mineTiers: ["low", "mid", "high"],
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

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// Resolves one 採集 round's outcome: null (獲得無し) or a list of
// { category: "natural", speciesId, quality, count } (同一の種を、
// resolveTieredItemsが決めた品質×個数ぶんまとめて獲得する)。
export function pickGatherReward(successCount, environment = STANDARD_ENVIRONMENT) {
  const items = resolveTieredItems(successCount, environment.gatherTiers);
  if (items.length === 0) return null;
  const speciesId = pickRandom(environment.naturalSpeciesPool);
  return items.map((item) => ({ category: "natural", speciesId, quality: item.quality, count: item.count }));
}

// Resolves one 採掘 round's outcome: null、または
// { category: "amber" | "rigid", speciesId?, quality, count } の配列
// （琥珀糖鉱石が選ばれた場合はspeciesId無しのamberカテゴリになる）。
export function pickMineReward(successCount, environment = STANDARD_ENVIRONMENT) {
  const items = resolveTieredItems(successCount, environment.mineTiers);
  if (items.length === 0) return null;
  const speciesId = pickRandom(environment.rigidSpeciesPool);
  if (speciesId === "amberSugarMineral") {
    return items.map((item) => ({ category: "amber", quality: item.quality, count: item.count }));
  }
  return items.map((item) => ({ category: "rigid", speciesId, quality: item.quality, count: item.count }));
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

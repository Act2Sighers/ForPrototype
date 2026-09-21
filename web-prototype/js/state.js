// Single in-memory game state shared by every scene. Nothing here is
// persisted to disk yet -- "save" just copies data into one of the
// in-memory slots below. That's enough to exercise every transition in
// the spec without pretending we have a real save format yet.

import { generateDungeon } from "./data/dungeonGenerator.js";
import { DUNGEONS } from "./data/testDungeon.js";
import {
  createColorfulPlasma,
  createEmptyResources,
  createEmptyObtainedResources,
  computeTradeValue,
  createAmberSugarMineralInstance,
  amberQualityFromStats,
  computeRunScore,
  RIGID_RESOURCES,
  NATURAL_RESOURCES,
  craftWeapon,
  craftCoating,
  COATING_PATTERN_MATERIALS,
  COATING_FLAVOR_MATERIALS,
  EQUIP_SLOTS,
  resolveEnhancePlan,
  refreshWeaponPrefix,
  computeWeaponMarketPrice,
  computeMaxHp,
  computeTimeEatsCheckoutTotal,
  findTimeEatsDef,
  pickLowestQualityFrame,
  pickLowestQualityNatural,
} from "./data/resourceCatalog.js";

// 隊員 (characters, each carrying its own equipped 武器) live in one of
// three slot groups:
//  - formationSlots: fights in battle (max 6, must hold >=1 whenever a
//    run is active).
//  - standbySlots: recruited but not fielded (max 6).
//  - retiredSlots: moved here in bulk when a run ends (see
//    settleRunEnd) — on a clear, everyone in formation+standby; on a
//    game over, only whoever was in standby. Max 20, not enforced yet.
export const FORMATION_LIMIT = 6;
export const STANDBY_LIMIT = 6;
export const RETIRED_LIMIT = 20; // not enforced yet — overflow handling is future work

// Everything a save file owns besides the save slot's own bookkeeping
// (label/timestamp) and whatever run is in progress: the warehouse's
// 糖衣 and the three 隊員 slot groups. Bundled together because they're
// always saved/loaded as one unit — see slotSnapshot()/loadSlot().
function freshProfile() {
  return {
    warehouseItems: [createColorfulPlasma()],
    formationSlots: [],
    standbySlots: [],
    retiredSlots: [],
    // 武器置き場: player-owned weapons not currently equipped by any
    // formation/standby member -- see weaponStorage.js. Populated by
    // equipStoredWeapon() swapping a character's old weapon in here;
    // future weapon forging/enhancement will add to it too.
    storedWeapons: [],
    // 仕立画面：ある(attribute, effect)の組み合わせの糖衣を、プレイヤーが
    // 過去に作成した回数（"${attribute}_${effect}"をキーにした通算値、
    // 一着ごとにリセットされない）。craftAndStoreCoating参照 -- 5回ごと
    // に新しい一着、それ以外は既存の熟練度5でない一着への加算になる。
    coatingCraftCounts: {},
    // 休憩イベント：隊員個別エピソード（独白/裏話/真相/思い出の6段階）の
    // 消化進捗を隊員idごとに0〜6で保持する（0=未消化、6=全消化済み）。
    // 必ず順番通りに進む -- 次に引ける候補は常にこの数値が指す1段階
    // だけ（js/data/restEpisodes.js参照）。ラン単位ではなくプロフィール
    // 単位で永続する。
    restEpisodeProgress: {},
    // 休憩イベント：一度でも抽選済みの休憩台本のid一覧（restEpisodes.js
    // の各台本のid）。未抽選優先の抽選（pickRestEpisode参照）で使う。
    seenRestEpisodeIds: [],
  };
}

const state = {
  // The save data belonging to the run currently being played, before it
  // has necessarily been written into a slot.
  currentSave: null,

  // Fixed at 3 manual slots for the prototype, plus one autosave slot
  // (see autoSave()) that the player never writes to directly.
  saveSlots: [null, null, null],
  autoSaveSlot: null,

  // 糖衣 (coatings): carried between runs, so they live here rather than
  // on the run. Live working copy of whichever save is active — see
  // freshProfile()/createNewSaveData()/loadSlot().
  ...freshProfile(),

  // The active run, created when a dungeon challenge starts.
  run: null,
};

export default state;

export function createNewSaveData() {
  const data = {
    createdAt: Date.now(),
    label: "冒険の記録",
  };
  state.currentSave = data;
  Object.assign(state, freshProfile());
  state.run = null;
  return data;
}

export function startNewRun(dungeonId, difficultyId) {
  const dungeonMeta = DUNGEONS.find((d) => d.id === dungeonId);
  state.run = {
    dungeonId,
    // マップ構造（マス配置・経路・マス種別）はランごとにランダム生成
    // され、以後このラン（リトライ含む）を通じて固定される -- 挑戦開始
    // 時に1回だけ生成し、ここに保持する（毎回getDungeonで引き直す旧来
    // の静的マップとは違い、この生成結果そのものが「そのランのマップ」
    // になる。retryRun()はこのフィールドに触れないので、リトライして
    // も同じマップのまま再挑戦できる）。
    dungeon: generateDungeon({ id: dungeonId, name: dungeonMeta?.name ?? dungeonId }),
    difficultyId,
    currentNodeId: "start",
    visitedNodeIds: ["start"],
    takenOutItemIds: [],
    // 資源 (materials/currency): reset to 0 at the top of every run.
    resources: createEmptyResources(),
    // リザルトのスコア計算専用：ラン中に実際に使い切って手元から消えた
    // 分も含め、手に入れた資源を品質ごとに延べ数で数え続ける（resources
    // と違って減ることが無い）。createEmptyObtainedResources参照。
    obtainedResources: createEmptyObtainedResources(),
    // 同じくスコア計算専用：戦闘勝利のたびに、そのモンスター全員のレベル
    // 合計を積み上げる（recordDefeatedMonsterLevels）。
    defeatedMonsterLevelSum: 0,
    // 同じくスコア計算専用：戦闘不能のまま勝利した味方を復活させた回数
    // （recordRescue、battle.jsのreviveIncapacitatedAllies参照）。
    rescueCount: 0,
    // 時間食 (軽食画面で購入した消耗品、荷物置き場に並ぶ): 資源と同じく
    // ラン単位で、ランが終わればリセットされる。
    timeEatsInventory: [],
    // 「クロノスタブ(初回限定)」のような、一度買うと同じラン内では
    // それ以降どの軽食画面にも並ばなくなる品のdefIdを記録する（軽食
    // 画面自体のラインナップは取引イベント単位でしか保持されないため、
    // ラン全体で効かせるにはここが必要 -- resourceCatalog.jsの
    // generateTimeEatsLineup参照）。
    purchasedFirstTimeOnlyIds: [],
    // Consumed the first time the player reaches the start square this
    // run — see consumeStartEventTrigger(), which map.js uses to call
    // the 雇用画面 in 初期雇用モード exactly once per run.
    startEventTriggered: false,
    // 行商イベントの発生済み回数と、前回発生してから「通常のマス」
    // （休憩/行商の仮想マスを除く、実際のダンジョンノード）を踏んだ回数
    // -- map.jsが毎回の描画でこれらとDUNGEON_PARAMS.peddlerCountを見て
    // 行商マスを出すかどうか判定する。moveRunToが通常マス到達のたびに
    // movesSincePeddlerを進め、recordPeddlerTriggeredが発生のたびに
    // カウンタをリセットする。
    peddlerOccurrenceCount: 0,
    movesSincePeddler: 0,
    settled: false,
  };
  return state.run;
}

export function retryRun() {
  if (!state.run) return;
  state.run.currentNodeId = "start";
  state.run.visitedNodeIds = ["start"];
  state.run.resources = createEmptyResources();
  state.run.obtainedResources = createEmptyObtainedResources();
  state.run.defeatedMonsterLevelSum = 0;
  state.run.rescueCount = 0;
  state.run.timeEatsInventory = [];
  state.run.purchasedFirstTimeOnlyIds = [];
  state.run.startEventTriggered = false;
  state.run.peddlerOccurrenceCount = 0;
  state.run.movesSincePeddler = 0;
  state.run.settled = false;
}

export function endRun() {
  state.run = null;
}

// Returns true the first time this is called for the current run (and
// marks it consumed so it never fires again this run), false every time
// after. map.js calls this once on mount and, if true, immediately
// calls the 雇用画面 in 初期雇用モード -- that screen grants its own
// starting resource budget on mount (see hiring.js), so nothing needs
// granting here.
export function consumeStartEventTrigger() {
  if (!state.run || state.run.startEventTriggered) return false;
  state.run.startEventTriggered = true;
  return true;
}

export function canAffordCost(cost) {
  return (state.run?.resources.rigid.coarseSugarMineral ?? 0) >= cost;
}

export function hasSquadRoom() {
  return state.formationSlots.length < FORMATION_LIMIT || state.standbySlots.length < STANDBY_LIMIT;
}

// Deducts a hire's cost and places the newly hired character into
// formation if there's room, else standby. Callers must have already
// checked canAffordCost()/hasSquadRoom() -- this trusts both hold.
export function hireCharacter(character, cost) {
  state.run.resources.rigid.coarseSugarMineral -= cost;
  if (state.formationSlots.length < FORMATION_LIMIT) state.formationSlots.push(character);
  else state.standbySlots.push(character);
}

// Generic resource grant used by episode outcomes (see episode.js /
// data/scripts.js) and anywhere else that just needs to add to the run's
// stockpile with nothing further to validate or compute. Only valid for
// a species with no quality variance (ベースクリーム/ザラメ鉱石) --
// everything else uses grantTieredResource or grantAmberSugarMineral
// below. hireCharacter/dischargeCharacter mutate coarseSugarMineral
// directly above instead, since those also need to check affordability
// or compute the amount.
export function grantResource(category, id, amount) {
  if (!state.run) return;
  state.run.resources[category][id] += amount;
  state.run.obtainedResources[category][id] += amount;
}

// Grants `amount` of one quality tier of a species tracked as a
// {tier: count} bucket (every natural/rigid species except
// ベースクリーム, ザラメ鉱石, and 琥珀糖鉱石 -- see
// data/resourceCatalog.js's createEmptyResources). Returns the species'
// total count before/after, for effect-description purposes (see
// episode.js).
export function grantTieredResource(category, id, tier, amount) {
  const bucket = state.run.resources[category][id];
  const before = Object.values(bucket).reduce((total, qty) => total + qty, 0);
  bucket[tier] += amount;
  state.run.obtainedResources[category][id][tier] += amount;
  return { before, after: before + amount };
}

// Rolls and grants one fresh 琥珀糖鉱石 instance of the given quality.
// Returns the new instance plus the species' total count before/after.
export function grantAmberSugarMineral(quality) {
  const list = state.run.resources.rigid.amberSugarMineral;
  const before = list.length;
  const instance = createAmberSugarMineralInstance(quality);
  list.push(instance);
  state.run.obtainedResources.rigid.amberSugarMineral[quality] += 1;
  return { instance, before, after: list.length };
}

// exploration.jsのcommitHaul専用：既に個別にロール済みの琥珀糖鉱石
// インスタンス群（quality引数を持たない）をまとめて付与する。品質は
// grantAmberSugarMineralのように呼び出し側から渡されない代わりに、
// 各インスタンス自身の性能値合計から逆算する（amberQualityFromStats
// 参照 -- ロール時の配分点数は品質ごとに固定なので復元できる）。
export function grantAmberSugarMineralInstances(instances) {
  if (!state.run || instances.length === 0) return;
  state.run.resources.rigid.amberSugarMineral.push(...instances);
  for (const instance of instances) {
    const quality = amberQualityFromStats(instance.stats);
    state.run.obtainedResources.rigid.amberSugarMineral[quality] += 1;
  }
}

// 休憩イベント（js/data/restEpisodes.js）で1本引いた後に呼ぶ記録処理。
// characterIdが渡された場合（隊員個別エピソード）はその隊員の進捗を
// 1段階進める -- 呼び出し側（episode.js）が既にpickRestEpisodeで
// 「次に引くべき1段階」を選んでいるので、ここでは単純にインクリメント
// するだけでよい。どちらの場合もidをseenRestEpisodeIdsへ記録する
// （重複追加はしない）。
export function recordRestEpisodeDraw(episodeId, characterId) {
  if (characterId) {
    state.restEpisodeProgress[characterId] = (state.restEpisodeProgress[characterId] ?? 0) + 1;
  }
  if (!state.seenRestEpisodeIds.includes(episodeId)) {
    state.seenRestEpisodeIds.push(episodeId);
  }
}

// Removes a character (by id) from formation or standby, retires them,
// and grants the discharge reward. Returns { character, reward }, or
// null if no such character was found in either slot group. Callers
// are responsible for not discharging the last formation member (the
// squad-formation screen's discharge mode disables that button).
export function dischargeCharacter(characterId) {
  let list = state.formationSlots;
  let idx = list.findIndex((c) => c.id === characterId);
  if (idx === -1) {
    list = state.standbySlots;
    idx = list.findIndex((c) => c.id === characterId);
  }
  if (idx === -1) return null;

  const [character] = list.splice(idx, 1);
  const reward = computeTradeValue(character);
  grantResource("rigid", "coarseSugarMineral", reward);
  state.retiredSlots.push(character);
  return { character, reward };
}

// Equips `character` with the 武器置き場 weapon identified by
// `weaponId` (see weaponStorage.js/squadFormation.js's 持ち替え flows),
// swapping their previous weapon (if any) back into storedWeapons in
// its place. No-op if that weapon id isn't actually in storedWeapons
// (already equipped by a concurrent action, e.g. a stale UI state).
export function equipStoredWeapon(character, weaponId) {
  const idx = state.storedWeapons.findIndex((w) => w.id === weaponId);
  if (idx === -1) return;
  const [newWeapon] = state.storedWeapons.splice(idx, 1);
  const oldWeapon = character.weapon;
  character.weapon = newWeapon;
  if (oldWeapon) state.storedWeapons.push(oldWeapon);
}

const BASE_CREAM_COST_PER_CRAFT = 5;

// Deducts a フレーム/モジュール reservation (see
// data/resourceCatalog.js's pickLowestQualityFrame/pickBestModuleUnit/
// pickAmberModuleInstance for how these shapes are built) from the
// player's real holdings. Both take the same {speciesId, ...} shape;
// only consumeRigidFrame additionally needs a `quantity`-shaped
// breakdown (tierBreakdown/instanceIds/flatQuantity) since a フレーム
// can span several units, while a モジュール pick is always exactly
// one unit (see craftAndStoreWeapon below, which calls this with a
// synthetic single-unit reservation).
function consumeRigidReservation(reservation) {
  const { speciesId } = reservation;
  const species = RIGID_RESOURCES[speciesId];
  if (species.variableStats) {
    const excluded = new Set(reservation.instanceIds);
    state.run.resources.rigid[speciesId] = state.run.resources.rigid[speciesId].filter(
      (instance) => !excluded.has(instance.id)
    );
  } else if (species.qualityTiers) {
    for (const [tier, qty] of Object.entries(reservation.tierBreakdown)) {
      state.run.resources.rigid[speciesId][tier] -= qty;
    }
  } else {
    state.run.resources.rigid[speciesId] -= reservation.flatQuantity;
  }
}

// 鍛冶画面's 武器製造完了 step: pays the フレーム reservation (from
// pickLowestQualityFrame, computed once when 武器製造画面 mounted), the
// one モジュール unit (from pickBestModuleUnit/pickAmberModuleInstance),
// and ベースクリーム×5, then crafts the weapon with the モジュール's
// exact stats and drops it into 武器置き場 (storedWeapons) -- exactly
// where an unequipped weapon already belongs, so "すぐに装備させる"
// afterward is just the ordinary squadFormation "swap" mode reused
// as-is. Returns the new weapon.
export function craftAndStoreWeapon(weaponTypeId, frameReservation, modulePick) {
  consumeRigidReservation(frameReservation);
  consumeRigidReservation(
    modulePick.tier
      ? { speciesId: modulePick.speciesId, tierBreakdown: { [modulePick.tier]: 1 } }
      : modulePick.instanceId
      ? { speciesId: modulePick.speciesId, instanceIds: [modulePick.instanceId] }
      : { speciesId: modulePick.speciesId, flatQuantity: 1 }
  );
  state.run.resources.natural.baseCream -= BASE_CREAM_COST_PER_CRAFT;
  const weapon = craftWeapon(weaponTypeId, modulePick.stats);
  state.storedWeapons.push(weapon);
  return weapon;
}

const COATING_BASE_CREAM_COST_PER_CRAFT = 10;

// consumeRigidReservationの自然資源版（仕立画面の原料１＝パターン用）。
function consumeNaturalReservation(reservation) {
  const { speciesId } = reservation;
  const species = NATURAL_RESOURCES[speciesId];
  if (species.qualityTiers) {
    for (const [tier, qty] of Object.entries(reservation.tierBreakdown)) {
      state.run.resources.natural[speciesId][tier] -= qty;
    }
  } else {
    state.run.resources.natural[speciesId] -= reservation.flatQuantity;
  }
}

// 仕立画面's 作成完了 step: pays the パターン(自然資源)/フレーバー
// (剛体資源) reservations plus ベースクリーム×10, then either mints a
// brand new 一着（熟練度1）or raises the mastery of the one existing
// 一着 that isn't already MAX -- see freshProfile()'s
// coatingCraftCounts comment for the counting rule (every 5th craft of
// the same attribute/effect combo starts a fresh piece). Either way the
// resulting coating is immediately marked 持ち出し済み (even when it was
// sitting untaken-out in the warehouse from a previous run) -- something
// just made/leveled up this run belongs in 糖衣置き場, not still in the
// warehouse. Returns the resulting coating (new or leveled-up).
export function craftAndStoreCoating(patternReservation, flavorReservation) {
  consumeNaturalReservation(patternReservation);
  consumeRigidReservation(flavorReservation);
  state.run.resources.natural.baseCream -= COATING_BASE_CREAM_COST_PER_CRAFT;

  const { effect } = COATING_PATTERN_MATERIALS[patternReservation.speciesId];
  const { attribute } = COATING_FLAVOR_MATERIALS[flavorReservation.speciesId];
  const key = `${attribute}_${effect}`;
  const pastCraftCount = state.coatingCraftCounts[key] ?? 0;
  state.coatingCraftCounts[key] = pastCraftCount + 1;

  const coating =
    pastCraftCount % 5 === 0
      ? craftCoating(attribute, effect)
      : state.warehouseItems.find((c) => c.attribute === attribute && c.effect === effect && c.mastery < 5);
  if (pastCraftCount % 5 === 0) state.warehouseItems.push(coating);
  else coating.mastery += 1;

  if (!state.run.takenOutItemIds.includes(coating.id)) state.run.takenOutItemIds.push(coating.id);
  return coating;
}

// 糖衣編集画面's プルダウン確定：指定した(attribute, effect, mastery)
// バケツから、現役隊員（編成＋待機）の誰にも装備されていない糖衣を
// 1つ選んで装備させる（同じバケツ内の複数枚は見た目・効果ともに区別
// が無いので、どれが選ばれても構わない）。該当する糖衣が無い場合は
// 何もしない（UIが古くなっていた場合の保険）。
export function equipCoating(character, slot, attribute, effect, mastery) {
  const takenOutIds = state.run?.takenOutItemIds ?? [];
  const equippedIds = new Set();
  for (const member of [...state.formationSlots, ...state.standbySlots]) {
    for (const equipped of Object.values(member.equippedCoatings)) {
      if (equipped) equippedIds.add(equipped.id);
    }
  }
  const candidate = state.warehouseItems.find(
    (c) =>
      c.attribute === attribute &&
      c.effect === effect &&
      c.mastery === mastery &&
      takenOutIds.includes(c.id) &&
      !equippedIds.has(c.id)
  );
  if (!candidate) return;
  character.equippedCoatings[slot] = candidate;
}

export function unequipCoating(character, slot) {
  character.equippedCoatings[slot] = null;
}

export function unequipAllCoatings(character) {
  for (const slot of EQUIP_SLOTS) character.equippedCoatings[slot] = null;
}

// 糖衣編集画面の「全隊員の糖衣を外す」：現役隊員（編成＋待機）全員分。
export function unequipAllCoatingsForRoster() {
  for (const member of [...state.formationSlots, ...state.standbySlots]) unequipAllCoatings(member);
}

// 武器強化画面's own "強化" button: applies exactly the plan
// resolveEnhancePlan already resolved (that same function is also what
// the UI calls to decide whether a stat's button is enabled, so there
// is nothing left to validate here) -- pays the natural-resource tier
// and ベースクリーム, raises the stat by one, and re-rolls the weapon's
// prefix if this crosses into a new tier (see refreshWeaponPrefix's own
// comment, which already anticipated this exact use). No-op if the
// enhancement isn't actually affordable (stale UI state).
export function enhanceWeaponStat(weapon, statKey) {
  const plan = resolveEnhancePlan(state.run.resources, weapon, statKey);
  if (!plan) return;
  state.run.resources.natural[plan.speciesId][plan.tier] -= plan.naturalCost;
  state.run.resources.natural.baseCream -= plan.baseCreamCost;
  weapon.stats[statKey] += 1;
  refreshWeaponPrefix(weapon);
}

// 武器取引画面's own "購入" confirm: pays the candidate's already-
// computed price (ザラメ鉱石, see computeWeaponMarketPrice) and drops
// the weapon into 武器置き場 (storedWeapons) -- same destination as any
// other unequipped weapon. Mirrors hireCharacter's own shape.
export function purchaseWeapon(weapon, price) {
  state.run.resources.rigid.coarseSugarMineral -= price;
  state.storedWeapons.push(weapon);
}

// 武器置き場画面（売却モード）'s own "まとめて売る" confirm: removes
// every storedWeapons entry whose id is in `weaponIds` and grants their
// combined ザラメ鉱石 value. Returns the total granted, for display.
export function sellStoredWeapons(weaponIds) {
  const idSet = new Set(weaponIds);
  let total = 0;
  state.storedWeapons = state.storedWeapons.filter((weapon) => {
    if (!idSet.has(weapon.id)) return true;
    total += computeWeaponMarketPrice(weapon);
    return false;
  });
  grantResource("rigid", "coarseSugarMineral", total);
  return total;
}

// 軽食画面の「お会計」確定：computeTimeEatsCheckoutTotalと同じ計算で
// 総額を出し、所持資源から支払い、ラインナップ（lineup、呼び出し元が
// 保持し続けている配列そのもの）の残り数量を減らして、購入分を荷物
// 置き場（state.run.timeEatsInventory）に積む。初回限定品を買った場合
// はランを通じて再表示されないようpurchasedFirstTimeOnlyIdsに記録する。
// purchases は {defId: 購入数量} の形。呼び出し側は事前に総額<=所持
// 資源であることを確認済みの前提（雇用/武器取引と同じ流儀）。
export function purchaseTimeEats(mode, lineup, purchases) {
  const total = computeTimeEatsCheckoutTotal(mode, lineup, purchases);
  state.run.resources.rigid.coarseSugarMineral -= total;
  for (const entry of lineup) {
    const qty = purchases[entry.defId] ?? 0;
    if (qty <= 0) continue;
    entry.remainingQty -= qty;
    const existing = state.run.timeEatsInventory.find((item) => item.defId === entry.defId);
    if (existing) existing.qty += qty;
    else {
      state.run.timeEatsInventory.push({
        defId: entry.defId,
        name: entry.name,
        target: entry.target,
        hpRecoveryPercent: entry.hpRecoveryPercent,
        conversionEfficiency: entry.conversionEfficiency,
        qty,
      });
    }
    if (findTimeEatsDef(mode, entry.defId)?.firstTimeOnly) {
      state.run.purchasedFirstTimeOnlyIds.push(entry.defId);
    }
  }
  return total;
}

// 部隊編成画面（配給／全員配給モード）の「選択」「全員に配給する」が
// 呼ぶ：荷物置き場のスタックからqty個消費し、0になったらそのスタック
// 自体をtimeEatsInventoryから取り除く（他の資源一覧が0個の種を表示し
// ない慣習と同じ）。
export function consumeTimeEatsItem(item, qty = 1) {
  item.qty -= qty;
  if (item.qty <= 0) {
    state.run.timeEatsInventory = state.run.timeEatsInventory.filter((i) => i !== item);
  }
}

// 行商の資源取引画面's own "取引" confirm: pays offer.requirementQuantity
// of offer.requirementSpeciesId (品質問わず、最も品質の低いものから
// 消費される -- pickLowestQualityFrame/pickLowestQualityNaturalと同じ
// 流儀）、そして offer の品目（offer.tierの品質でoffer.quantityぶん）
// を付与する。琥珀糖鉱石は{tier:count}バケツを持たないので、該当品質の
// インスタンスを新規ロールして積む専用分岐が要る。呼び出し側は事前に
// hasEnoughForResourceTradeOffer で充足を確認済みの前提。
export function purchaseResourceTradeOffer(offer) {
  const requirementIsNatural = Boolean(NATURAL_RESOURCES[offer.requirementSpeciesId]);
  if (requirementIsNatural) {
    consumeNaturalReservation(pickLowestQualityNatural(state.run.resources, offer.requirementSpeciesId, offer.requirementQuantity));
  } else {
    consumeRigidReservation(pickLowestQualityFrame(state.run.resources, offer.requirementSpeciesId, offer.requirementQuantity));
  }

  if (offer.category === "natural") {
    grantTieredResource("natural", offer.speciesId, offer.tier, offer.quantity);
  } else if (RIGID_RESOURCES[offer.speciesId].variableStats) {
    for (let i = 0; i < offer.quantity; i++) grantAmberSugarMineral(offer.tier);
  } else {
    grantTieredResource("rigid", offer.speciesId, offer.tier, offer.quantity);
  }
}

// 戦闘勝利のたびにbattle.jsが呼ぶ：倒したモンスター全員のレベル合計を
// スコア用カウンタへ積み上げる。
export function recordDefeatedMonsterLevels(levelSum) {
  if (!state.run) return;
  state.run.defeatedMonsterLevelSum += levelSum;
}

// 戦闘不能のまま勝利した味方を復活させるたびにbattle.jsが呼ぶ（その
// 戦闘で復活させた人数ぶん）。
export function recordRescue(count) {
  if (!state.run || count <= 0) return;
  state.run.rescueCount += count;
}

// Moves the run's squad into retiredSlots once, at the moment the run
// ends (i.e. when the result screen is reached — see result.js). On a
// clear, everyone in formation+standby retires; on a game over, only
// whoever was left in standby (formation is presumed lost). Equipped
// weapons travel with their owner since they're stored on the character
// itself; nothing separate needs clearing for them.
export function settleRunEnd(mode) {
  if (!state.run || state.run.settled) return;
  // スコアは編成/待機がまだ手つかずのこの時点で確定させる -- ゲーム
  // オーバーだと編成側はこの直後に失われる（下のsurvivors参照）が、
  // スコアの「全隊員」は生死を問わずこの瞬間のロスター全体を指す。
  state.run.finalScore = computeRunScore({
    reachedNodeCount: state.run.visitedNodeIds.length,
    formationSlots: state.formationSlots,
    standbySlots: state.standbySlots,
    storedWeapons: state.storedWeapons,
    defeatedMonsterLevelSum: state.run.defeatedMonsterLevelSum,
    rescueCount: state.run.rescueCount,
    obtainedResources: state.run.obtainedResources,
  });
  const survivors =
    mode === "gameover"
      ? [...state.standbySlots]
      : [...state.formationSlots, ...state.standbySlots];
  // 退役スロットへ移す隊員は、変調を0にしてHPを全回復させる。正変調
  // （時間食の変換処理でのみ使う内部パラメータ）も退役時に失われる。
  for (const character of survivors) {
    character.condition = 0;
    character.positiveCondition = 0;
    character.currentHp = computeMaxHp(character.growth);
  }
  state.retiredSlots.push(...survivors);
  state.formationSlots = [];
  state.standbySlots = [];
  state.run.settled = true;
}

export function moveRunTo(nodeId) {
  if (!state.run) return;
  state.run.currentNodeId = nodeId;
  if (!state.run.visitedNodeIds.includes(nodeId)) {
    state.run.visitedNodeIds.push(nodeId);
  }
  // 休憩/行商の仮想マスはこの関数を通らない（map.js参照 -- 仮想マス解決
  // 後は現在地をそのままに、本来の対象マスだけreachableへ絞り込む）ので、
  // ここに来るのは常に「通常のマス」への到達のみ。行商のクールダウン
  // 判定はこのカウントだけを見れば良い。
  state.run.movesSincePeddler += 1;
}

// 行商イベント発生時に呼ぶ：発生済み回数を1増やし、クールダウンを
// リセットする（map.jsが仮想行商マスをクリックした瞬間、
// api.callScene("peddlerShop", ...)する前に呼ぶ想定 -- moveRunToと同じ
// 「クリックした時点で即座に確定させる」流儀）。
export function recordPeddlerTriggered() {
  if (!state.run) return;
  state.run.peddlerOccurrenceCount += 1;
  state.run.movesSincePeddler = 0;
}

// A save slot bundles: its own label/timestamp, a deep copy of the
// profile (warehouse + character slots), and a deep copy of the run in
// progress (or null, if the player saved from outside a run — e.g. from
// the world screen). structuredClone fully decouples the slot from the
// live state, so later play can't reach back and mutate an old save.
function slotSnapshot() {
  return {
    savedAt: Date.now(),
    label: state.currentSave?.label ?? "冒険の記録",
    profile: structuredClone({
      warehouseItems: state.warehouseItems,
      formationSlots: state.formationSlots,
      standbySlots: state.standbySlots,
      retiredSlots: state.retiredSlots,
      storedWeapons: state.storedWeapons,
      coatingCraftCounts: state.coatingCraftCounts,
      restEpisodeProgress: state.restEpisodeProgress,
      seenRestEpisodeIds: state.seenRestEpisodeIds,
    }),
    run: state.run ? structuredClone(state.run) : null,
  };
}

export function saveToSlot(index) {
  state.saveSlots[index] = slotSnapshot();
}

export function deleteSlot(index) {
  state.saveSlots[index] = null;
}

export function duplicateSlot(fromIndex) {
  const emptyIndex = state.saveSlots.findIndex((slot) => slot === null);
  if (emptyIndex === -1) return -1;
  state.saveSlots[emptyIndex] = structuredClone(state.saveSlots[fromIndex]);
  return emptyIndex;
}

// Restores a save slot's profile and run into the live working state.
// Callers should navigate to "map" if the restored run is non-null (the
// player was mid-dungeon when they saved), or to "world" otherwise.
function restoreFromSlot(slot) {
  state.currentSave = { createdAt: slot.savedAt, label: slot.label };
  Object.assign(state, structuredClone(slot.profile));
  state.run = slot.run ? structuredClone(slot.run) : null;
}

export function loadSlot(index) {
  const slot = state.saveSlots[index];
  if (!slot) return null;
  restoreFromSlot(slot);
  return slot;
}

// Silently records the current profile/run into a dedicated autosave
// slot (separate from the 3 manual ones, and never shown/editable in
// save mode) — called whenever the player returns to the title screen,
// so quitting out never loses progress even if they forgot to save
// manually. See pause.js and result.js.
export function autoSave() {
  state.autoSaveSlot = slotSnapshot();
}

export function loadAutoSave() {
  if (!state.autoSaveSlot) return null;
  restoreFromSlot(state.autoSaveSlot);
  return state.autoSaveSlot;
}

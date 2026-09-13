// Single in-memory game state shared by every scene. Nothing here is
// persisted to disk yet -- "save" just copies data into one of the
// in-memory slots below. That's enough to exercise every transition in
// the spec without pretending we have a real save format yet.

import {
  createColorfulPlasma,
  createEmptyResources,
  computeTradeValue,
  createAmberSugarMineralInstance,
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
    // formation/standby member -- see squadFormation.js. Nothing
    // produces one yet (this is placeholder plumbing ahead of future
    // weapon forging/enhancement and the planned 持ち替え feature), so
    // this stays empty for now.
    storedWeapons: [],
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
  state.run = {
    dungeonId,
    difficultyId,
    currentNodeId: "start",
    visitedNodeIds: ["start"],
    takenOutItemIds: [],
    // 資源 (materials/currency): reset to 0 at the top of every run.
    resources: createEmptyResources(),
    // Consumed the first time the player reaches the start square this
    // run — see consumeStartEventTrigger(), which map.js uses to call
    // the 雇用画面 in 初期雇用モード exactly once per run.
    startEventTriggered: false,
    settled: false,
  };
  return state.run;
}

export function retryRun() {
  if (!state.run) return;
  state.run.currentNodeId = "start";
  state.run.visitedNodeIds = ["start"];
  state.run.resources = createEmptyResources();
  state.run.startEventTriggered = false;
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
  return { before, after: before + amount };
}

// Rolls and grants one fresh 琥珀糖鉱石 instance of the given quality.
// Returns the new instance plus the species' total count before/after.
export function grantAmberSugarMineral(quality) {
  const list = state.run.resources.rigid.amberSugarMineral;
  const before = list.length;
  const instance = createAmberSugarMineralInstance(quality);
  list.push(instance);
  return { instance, before, after: list.length };
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
  state.run.resources.rigid.coarseSugarMineral += reward;
  state.retiredSlots.push(character);
  return { character, reward };
}

// Moves the run's squad into retiredSlots once, at the moment the run
// ends (i.e. when the result screen is reached — see result.js). On a
// clear, everyone in formation+standby retires; on a game over, only
// whoever was left in standby (formation is presumed lost). Equipped
// weapons travel with their owner since they're stored on the character
// itself; nothing separate needs clearing for them.
export function settleRunEnd(mode) {
  if (!state.run || state.run.settled) return;
  const survivors =
    mode === "gameover"
      ? [...state.standbySlots]
      : [...state.formationSlots, ...state.standbySlots];
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

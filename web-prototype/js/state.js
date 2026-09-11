// Single in-memory game state shared by every scene. Nothing here is
// persisted to disk yet -- "save" just copies data into one of the
// in-memory slots below. That's enough to exercise every transition in
// the spec without pretending we have a real save format yet.

import {
  createBiscuitBaker,
  createHumbleFryingPan,
  createColorfulPlasma,
  createEmptyResources,
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
  };
}

const state = {
  // The save data belonging to the run currently being played, before it
  // has necessarily been written into a slot.
  currentSave: null,

  // Fixed at 3 slots for the prototype.
  saveSlots: [null, null, null],

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
    // 資源 (materials/currency): reset to 0 at the top of every run —
    // see grantStartReward(), which hands out a small starting supply
    // as soon as the player is standing on the start square.
    resources: createEmptyResources(),
    startRewardGranted: false,
    settled: false,
  };
  return state.run;
}

export function retryRun() {
  if (!state.run) return;
  state.run.currentNodeId = "start";
  state.run.visitedNodeIds = ["start"];
  state.run.resources = createEmptyResources();
  state.run.startRewardGranted = false;
  state.run.settled = false;
}

export function endRun() {
  state.run = null;
}

// Grants the start-square reward once per run: a fresh ビスケット・ベー
// カー (unconditionally — this stands in for two events not built yet,
// an opening episode and a "初期雇用" pick-your-starter screen, which
// is trivial to simulate with only one candidate) plus a small resource
// supply. Never pulls anyone back from retiredSlots — a retired
// character only returns to play once real recruitment exists. Returns
// a human-readable summary of what was granted, or null if this run
// already received it.
export function grantStartReward() {
  if (!state.run || state.run.startRewardGranted) return null;

  const biscuit = createBiscuitBaker();
  biscuit.weapon = createHumbleFryingPan();
  state.formationSlots.push(biscuit);

  state.run.resources.natural.baseCream += 3;
  state.run.resources.rigid.coarseSugarMineral += 3;

  state.run.startRewardGranted = true;
  return `${biscuit.name}（武器：${biscuit.weapon.name}）、ベースクリーム×3、ザラメ鉱石×3を獲得`;
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
export function loadSlot(index) {
  const slot = state.saveSlots[index];
  if (!slot) return null;
  state.currentSave = { createdAt: slot.savedAt, label: slot.label };
  Object.assign(state, structuredClone(slot.profile));
  state.run = slot.run ? structuredClone(slot.run) : null;
  return slot;
}

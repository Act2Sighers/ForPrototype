// Single in-memory game state shared by every scene. Nothing here is
// persisted to disk yet -- "save" just copies data into one of the
// in-memory slots below. That's enough to exercise every transition in
// the spec without pretending we have a real save format yet.

import { createBiscuitBaker, createHumbleFryingPan, createColorfulPlasma } from "./data/resourceCatalog.js";

function freshRunResources() {
  return { natural: { baseCream: 0 }, rigid: { zarameOre: 0 } };
}

export const FORMATION_LIMIT = 6;
export const STANDBY_LIMIT = 6;
export const RETIRED_LIMIT = 20; // not enforced yet — overflow handling is future work

const state = {
  // The save data belonging to the run currently being played, before it
  // has necessarily been written into a slot.
  currentSave: null,

  // Fixed at 3 slots for the prototype.
  saveSlots: [null, null, null],

  // 糖衣 (coatings) only: carried between runs, so they live here rather
  // than on the run. Starts with one real fixture item, already enabled.
  warehouseItems: [createColorfulPlasma()],

  // 隊員 (characters, each carrying its own equipped 武器) live in one of
  // three slot groups, all carried between runs:
  //  - formationSlots: fights in battle (max 6, must hold >=1 whenever a
  //    run is active).
  //  - standbySlots: recruited but not fielded (max 6).
  //  - retiredSlots: moved here in bulk when a run ends (see
  //    settleRunEnd) — on a clear, everyone in formation+standby; on a
  //    game over, only whoever was in standby. Max 20, not enforced yet.
  formationSlots: [],
  standbySlots: [],
  retiredSlots: [],

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
    resources: freshRunResources(),
    startRewardGranted: false,
    settled: false,
  };
  return state.run;
}

export function retryRun() {
  if (!state.run) return;
  state.run.currentNodeId = "start";
  state.run.visitedNodeIds = ["start"];
  state.run.resources = freshRunResources();
  state.run.startRewardGranted = false;
  state.run.settled = false;
}

export function endRun() {
  state.run = null;
}

// Grants the start-square reward once per run. Resources are handed out
// every time (including on retry); a character is only ever granted if
// formation is currently empty — since a completed run always moves its
// squad to retiredSlots (see settleRunEnd), formation is empty at the
// start of every run after the first. In that case whoever is first in
// retiredSlots is recommissioned back into formation; only if nobody has
// ever been recruited yet is a brand new ビスケット・ベーカー created.
// (A real recruitment/squad-select screen should replace this later.)
// Returns a human-readable summary of what was granted, or null if this
// run already received it.
export function grantStartReward() {
  if (!state.run || state.run.startRewardGranted) return null;

  const grantedParts = [];

  if (state.formationSlots.length === 0) {
    const recommissioned = state.retiredSlots.shift();
    if (recommissioned) {
      state.formationSlots.push(recommissioned);
      grantedParts.push(`${recommissioned.name}が編成に復帰`);
    } else {
      const biscuit = createBiscuitBaker();
      biscuit.weapon = createHumbleFryingPan();
      state.formationSlots.push(biscuit);
      grantedParts.push(`${biscuit.name}（武器：${biscuit.weapon.name}）`);
    }
  }

  state.run.resources.natural.baseCream += 3;
  state.run.resources.rigid.zarameOre += 3;
  grantedParts.push("ベースクリーム×3", "ザラメ鉱石×3");

  state.run.startRewardGranted = true;
  return `${grantedParts.join("、")}を獲得`;
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

function slotSnapshot() {
  return {
    savedAt: Date.now(),
    label: state.currentSave?.label ?? "冒険の記録",
    dungeonId: state.run?.dungeonId ?? null,
    difficultyId: state.run?.difficultyId ?? null,
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
  state.saveSlots[emptyIndex] = { ...state.saveSlots[fromIndex] };
  return emptyIndex;
}

export function loadSlot(index) {
  const slot = state.saveSlots[index];
  if (!slot) return null;
  state.currentSave = { createdAt: slot.savedAt, label: slot.label };
  return slot;
}

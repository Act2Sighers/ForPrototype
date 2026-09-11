// Single in-memory game state shared by every scene. Nothing here is
// persisted to disk yet -- "save" just copies data into one of the
// in-memory slots below. That's enough to exercise every transition in
// the spec without pretending we have a real save format yet.

import { createBiscuitBaker, createHumbleFryingPan, createColorfulPlasma } from "./data/resourceCatalog.js";

function freshRunResources() {
  return { natural: { baseCream: 0 }, rigid: { zarameOre: 0 } };
}

const state = {
  // The save data belonging to the run currently being played, before it
  // has necessarily been written into a slot.
  currentSave: null,

  // Fixed at 3 slots for the prototype.
  saveSlots: [null, null, null],

  // 糖衣 (coatings): carried between runs, so they live here rather than
  // on the run. Starts with one real fixture item, already enabled.
  warehouseItems: [createColorfulPlasma()],

  // 隊員 (characters): also carried between runs — a character keeps
  // growing the more it's used, so recruiting one is permanent. Each
  // character holds its own equipped 武器 directly (see resourceCatalog).
  characters: [],

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
  };
  return state.run;
}

export function retryRun() {
  if (!state.run) return;
  state.run.currentNodeId = "start";
  state.run.visitedNodeIds = ["start"];
  state.run.resources = freshRunResources();
  state.run.startRewardGranted = false;
}

export function endRun() {
  state.run = null;
}

// Grants the start-square reward once per run (retrying re-grants the
// resource supply, but never re-recruits a character already owned —
// see the module comment on state.characters). Returns a human-readable
// summary of what was granted, or null if this run already got it.
export function grantStartReward() {
  if (!state.run || state.run.startRewardGranted) return null;

  const grantedParts = [];

  if (!state.characters.some((c) => c.id === "biscuit-baker")) {
    const biscuit = createBiscuitBaker();
    biscuit.weapon = createHumbleFryingPan();
    state.characters.push(biscuit);
    grantedParts.push(`${biscuit.name}（武器：${biscuit.weapon.name}）`);
  }

  state.run.resources.natural.baseCream += 3;
  state.run.resources.rigid.zarameOre += 3;
  grantedParts.push("ベースクリーム×3", "ザラメ鉱石×3");

  state.run.startRewardGranted = true;
  return `${grantedParts.join("、")}を獲得`;
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

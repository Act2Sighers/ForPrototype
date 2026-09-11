// Single in-memory game state shared by every scene. Nothing here is
// persisted to disk yet -- "save" just copies data into one of the
// in-memory slots below. That's enough to exercise every transition in
// the spec without pretending we have a real save format yet.

const state = {
  // The save data belonging to the run currently being played, before it
  // has necessarily been written into a slot.
  currentSave: null,

  // Fixed at 3 slots for the prototype.
  saveSlots: [null, null, null],

  // Items that can be carried between runs. Only one fixture item exists
  // for now, always enabled.
  warehouseItems: [
    {
      id: "test-item",
      name: "テストアイテム",
      description: "内容は未実装のテストアイテムです。",
      enabled: true,
    },
  ],

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
  };
  return state.run;
}

export function retryRun() {
  if (!state.run) return;
  state.run.currentNodeId = "start";
  state.run.visitedNodeIds = ["start"];
}

export function endRun() {
  state.run = null;
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

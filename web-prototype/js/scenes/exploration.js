import { renderScreen, button, h, resourceHud } from "../dom.js";
import { resourceIndividualNodes } from "../resourceDisplay.js";
import state, { grantResource, grantTieredResource, grantAmberSugarMineralInstances, setExplorationDoubleSpeed } from "../state.js";
import { CHARACTER_STAT_LABELS, CHARACTER_STAT_FULL_LABELS, growCharacterStat } from "../data/resourceCatalog.js";
import {
  computeGatherAbility,
  computeMineAbility,
  computeSuperviseAbility,
  gatherGrowthStatKey,
  mineGrowthStatKey,
  STANDARD_ENVIRONMENT,
  autoAssignRoles,
} from "../data/exploration.js";
import { createExplorationGroups, runExploration } from "../explorationSim.js";

// Placeholder pacing per the user's own instruction (tune later). A
// debug hook (window.__EXPLORATION_FAST__) lets tests speed this up
// without touching production behavior.
const FAST = typeof window !== "undefined" && window.__EXPLORATION_FAST__;
const STEP_DELAY_MS = FAST ? 10 : 1000;
const FINAL_WAIT_MS = FAST ? 20 : 2000;

// 探索イベント. Three phases, and only ① and ③ can return to the
// caller (① "探索せずに去る", ③ "探索を終える") -- ② has no such
// command while the simulation is running.
//  ① assign: pick up to 3 隊員 each for 採集/採掘 from formation+standby.
//  ② working: the real-time simulation (see explorationSim.js) plays
//     out live, updating each worker's progress gauge and status text.
//  ③ result: the accumulated haul is granted and growth applied, then
//     shown to the player.
export function ExplorationScene(container, params, api) {
  const eligibleCharacters = [...state.formationSlots, ...state.standbySlots];
  const roles = new Map(); // characterId -> "gather" | "mine" | null

  let phase = "assign";
  let gatherGroup = null;
  let mineGroup = null;
  let resultData = null;

  function countInRole(role) {
    let count = 0;
    for (const character of eligibleCharacters) if (roles.get(character.id) === role) count++;
    return count;
  }

  function toggleRole(character, targetRole) {
    const current = roles.get(character.id) ?? null;
    roles.set(character.id, current === targetRole ? null : targetRole);
    render();
  }

  // "自動割り当て": recomputes the whole assignment from scratch across
  // every eligible character (discarding whatever the player has
  // toggled manually so far) via autoAssignRoles' exact optimum -- see
  // that function's own comment for the scoring model. Disabled once
  // there's clearly nothing left for it to add: either every assignable
  // slot is already full (6 total, the 3-per-role cap), or every
  // eligible character already has some role (only reachable at 5 or
  // fewer eligible characters).
  function isAutoAssignDisabled() {
    if (countInRole("gather") + countInRole("mine") >= 6) return true;
    return eligibleCharacters.every((character) => roles.get(character.id));
  }

  function autoAssign() {
    const { gather, mine } = autoAssignRoles(eligibleCharacters);
    roles.clear();
    for (const character of gather) roles.set(character.id, "gather");
    for (const character of mine) roles.set(character.id, "mine");
    render();
  }

  function startExploration() {
    const gatherMembers = eligibleCharacters.filter((c) => roles.get(c.id) === "gather");
    const mineMembers = eligibleCharacters.filter((c) => roles.get(c.id) === "mine");
    ({ gatherGroup, mineGroup } = createExplorationGroups({ gatherMembers, mineMembers }));
    phase = "working";
    render();
    runExploration(gatherGroup, mineGroup, STANDARD_ENVIRONMENT, render, STEP_DELAY_MS, FINAL_WAIT_MS).then(
      ({ haul, participants }) => {
        resultData = buildResultData(haul, participants);
        phase = "result";
        render();
      }
    );
  }

  // Commits the haul into the real resource pool and applies each
  // participant's one-time stat growth (only for abilities they
  // actually used -- see explorationSim.js's usedGather/usedMine/
  // usedSupervise tracking), then packages both for the result screen.
  function buildResultData(haul, participants) {
    const growthEntries = [];
    for (const worker of participants) {
      const character = worker.character;
      if (worker.usedGather || worker.usedMine) {
        const statKey = worker.usedGather ? gatherGrowthStatKey(character) : mineGrowthStatKey(character);
        const { before, after } = growCharacterStat(character, statKey, 1);
        growthEntries.push({ character, statKey, before, after });
      }
      if (worker.usedSupervise) {
        const { before, after } = growCharacterStat(character, "sociality", 1);
        growthEntries.push({ character, statKey: "sociality", before, after });
      }
    }
    commitHaul(haul);
    return { haul, growthEntries };
  }

  function commitHaul(haul) {
    for (const [key, value] of Object.entries(haul.natural)) {
      if (typeof value === "number") {
        if (value > 0) grantResource("natural", key, value);
      } else {
        for (const [tier, qty] of Object.entries(value)) if (qty > 0) grantTieredResource("natural", key, tier, qty);
      }
    }
    for (const [key, value] of Object.entries(haul.rigid)) {
      if (key === "amberSugarMineral") {
        if (value.length) grantAmberSugarMineralInstances(value);
      } else if (typeof value === "number") {
        if (value > 0) grantResource("rigid", key, value);
      } else {
        for (const [tier, qty] of Object.entries(value)) if (qty > 0) grantTieredResource("rigid", key, tier, qty);
      }
    }
  }

  function assignRow(character) {
    const role = roles.get(character.id) ?? null;
    const gatherDisabled = role !== "gather" && countInRole("gather") >= 3;
    const mineDisabled = role !== "mine" && countInRole("mine") >= 3;
    return h("div", { class: "panel" }, [
      h("div", { class: "row-between" }, [
        h("div", { class: "slot__meta" }, [
          h("span", { class: "slot__id", text: `Lv.${character.level}` }),
          h("span", { class: "slot__name", text: character.name }),
        ]),
        h("div", { class: "slot__actions" }, [
          button("採集", {
            variant: role === "gather" ? "gather" : "ghost",
            disabled: gatherDisabled,
            onClick: () => toggleRole(character, "gather"),
          }),
          button("採掘", {
            variant: role === "mine" ? "mine" : "ghost",
            disabled: mineDisabled,
            onClick: () => toggleRole(character, "mine"),
          }),
        ]),
      ]),
      h("p", { class: "character-card__stats" }, [
        h("span", { class: "ability-gather", text: `採集能力: ${computeGatherAbility(character)}` }),
        "　",
        h("span", { class: "ability-mine", text: `採掘能力: ${computeMineAbility(character)}` }),
        "　",
        h("span", { class: "ability-supervise", text: `監督能力: ${computeSuperviseAbility(character)}` }),
      ]),
    ]);
  }

  function renderAssign() {
    const totalAssigned = countInRole("gather") + countInRole("mine");
    renderScreen(container, {
      eyebrow: "EXPLORATION",
      title: "探索",
      subtitle: "隊員を採集・採掘の担当に割り当ててください（各最大3人）。",
      corner: resourceHud(state.run?.resources),
      body: [
        h("p", {
          class: "lead",
          text: `土壌：${STANDARD_ENVIRONMENT.soilLabel}　地質：${STANDARD_ENVIRONMENT.geologyLabel}　属性：${STANDARD_ENVIRONMENT.attributeLabel}`,
        }),
        eligibleCharacters.length
          ? h("div", { class: "slot-list slot-list--grid" }, eligibleCharacters.map(assignRow))
          : h("p", { class: "lead", text: "割り当てられる隊員がいません。" }),
      ],
      onPause: () => api.callScene("pause"),
      actions: [
        button("探索せずに去る", { variant: "ghost", onClick: () => api.closeScene() }),
        button("スキップ（テスト用）", { variant: "ghost", onClick: () => api.closeScene() }),
        button("自動割り当て", { variant: "ghost", disabled: isAutoAssignDisabled(), onClick: autoAssign }),
        button("探索開始！", { variant: "primary", disabled: totalAssigned === 0, onClick: startExploration }),
      ],
    });
  }

  function workerRow(worker) {
    const roleLabel = worker.role === "gather" ? "採集担当" : "採掘担当";
    const tag = worker.isSupervisor ? `${roleLabel}・監督` : roleLabel;
    const pct = (worker.progress / worker.progressCap) * 100;
    return h("div", { class: "panel" }, [
      h("div", { class: "slot__meta" }, [h("span", { class: "slot__name", text: `${worker.character.name}（${tag}）` })]),
      h("div", { class: "hp-gauge" }, [h("div", { class: "progress-gauge__fill", style: `width:${pct}%` })]),
      h("p", { class: "lead", text: worker.statusText || "…" }),
    ]);
  }

  function renderWorking() {
    const body = [];
    if (gatherGroup.members.length) {
      body.push(
        h("div", { class: "field-group" }, [
          h("p", { class: "field-label", text: "採集担当" }),
          h("div", { class: "slot-list slot-list--grid" }, gatherGroup.members.map(workerRow)),
        ])
      );
    }
    if (mineGroup.members.length) {
      body.push(
        h("div", { class: "field-group" }, [
          h("p", { class: "field-label", text: "採掘担当" }),
          h("div", { class: "slot-list slot-list--grid" }, mineGroup.members.map(workerRow)),
        ])
      );
    }
    renderScreen(container, {
      eyebrow: "EXPLORATION",
      title: "探索",
      subtitle: "作業を進行しています…",
      corner: resourceHud(state.run?.resources),
      body,
      onPause: () => api.callScene("pause"),
      actions: [
        button("スキップ（テスト用）", { variant: "ghost", onClick: () => api.closeScene() }),
        button("倍速", {
          variant: state.explorationDoubleSpeed ? "primary" : "ghost",
          onClick: () => {
            setExplorationDoubleSpeed(!state.explorationDoubleSpeed);
            render();
          },
        }),
      ],
    });
  }

  function renderResult() {
    const { haul, growthEntries } = resultData;
    const haulNodes = resourceIndividualNodes(haul);
    const body = [
      h("div", { class: "field-group" }, [
        h("p", { class: "field-label", text: "探索結果" }),
        haulNodes.length
          ? h("div", { class: "resource-list" }, haulNodes)
          : h("p", { class: "lead", text: "資源は得られませんでした。" }),
      ]),
    ];
    if (growthEntries.length) {
      body.push(
        h("div", { class: "field-group" }, [
          h("p", { class: "field-label", text: "隊員の成長" }),
          h(
            "div",
            { class: "resource-list" },
            growthEntries.map((entry) => {
              const label = `${CHARACTER_STAT_LABELS[entry.statKey]}(${CHARACTER_STAT_FULL_LABELS[entry.statKey]})`;
              return h("p", {
                class: `resource-line stat-${entry.statKey}`,
                text: `${entry.character.name}の${label}が1成長！（${entry.before} → ${entry.after}）`,
              });
            })
          ),
        ])
      );
    }
    renderScreen(container, {
      eyebrow: "EXPLORATION",
      title: "探索",
      subtitle: "探索が完了しました。",
      corner: resourceHud(state.run?.resources),
      onPause: () => api.callScene("pause"),
      body,
      actions: [button("探索を終える", { variant: "primary", onClick: () => api.closeScene() })],
    });
  }

  function render() {
    if (phase === "assign") renderAssign();
    else if (phase === "working") renderWorking();
    else renderResult();
  }

  render();
  return {};
}

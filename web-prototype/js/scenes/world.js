import { renderScreen, button, h } from "../dom.js";
import { WORLD_LOCATIONS, DIFFICULTIES } from "../data/testDungeon.js";
import { startNewRun } from "../state.js";

// The main-menu-like hub: pick a destination (a dungeon, or 王城), then
// whatever that destination needs next appears alongside it — a
// difficulty pick + 挑戦開始 for a dungeon, or a straight 入場 for the
// castle.
export function WorldScene(container, params, api) {
  let selectedLocationId = null;
  let selectedDifficultyId = null;

  function chip(label, isSelected, onClick) {
    return h("button", { class: `chip${isSelected ? " is-selected" : ""}`, onClick, text: label });
  }

  function render() {
    const location = WORLD_LOCATIONS.find((l) => l.id === selectedLocationId) ?? null;

    const body = [
      h("div", { class: "field-group" }, [
        h("p", { class: "field-label", text: "行き先" }),
        h(
          "div",
          { class: "chip-row" },
          WORLD_LOCATIONS.map((l) =>
            chip(l.name, selectedLocationId === l.id, () => {
              selectedLocationId = l.id;
              selectedDifficultyId = null;
              render();
            })
          )
        ),
      ]),
    ];

    if (location?.kind === "dungeon") {
      body.push(
        h("div", { class: "field-group" }, [
          h("p", { class: "field-label", text: "難易度" }),
          h(
            "div",
            { class: "chip-row" },
            DIFFICULTIES.map((d) =>
              chip(d.name, selectedDifficultyId === d.id, () => {
                selectedDifficultyId = d.id;
                render();
              })
            )
          ),
        ])
      );
    }

    const actions = [button("ポーズ", { variant: "ghost", onClick: () => api.callScene("pause") })];

    if (location?.kind === "castle") {
      actions.push(button("入場", { variant: "primary", onClick: () => api.callScene("gallery") }));
    } else if (location?.kind === "dungeon" && selectedDifficultyId) {
      actions.push(
        button("挑戦開始", {
          variant: "primary",
          onClick: () => {
            startNewRun(location.id, selectedDifficultyId);
            api.navigateTo("map");
          },
        })
      );
    }

    renderScreen(container, {
      eyebrow: "WORLD",
      title: "ワールド",
      subtitle: "行き先を選んでください。",
      body,
      actions,
    });
  }

  render();
  return {};
}

import { renderScreen, button, h } from "../dom.js";
import { DIFFICULTIES, DUNGEONS } from "../data/testDungeon.js";
import { startNewRun } from "../state.js";

export function DungeonSelectScene(container, params, api) {
  let selectedDifficultyId = null;
  let selectedDungeonId = null;

  function chip(label, isSelected, onClick) {
    const el = h("button", {
      class: `chip${isSelected ? " is-selected" : ""}`,
      onClick,
      text: label,
    });
    return el;
  }

  function render() {
    const canChallenge = Boolean(selectedDifficultyId && selectedDungeonId);

    const body = [
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
      ]),
      h("div", { class: "field-group" }, [
        h("p", { class: "field-label", text: "ダンジョン" }),
        h(
          "div",
          { class: "chip-row" },
          DUNGEONS.map((d) =>
            chip(d.name, selectedDungeonId === d.id, () => {
              selectedDungeonId = d.id;
              render();
            })
          )
        ),
      ]),
    ];

    renderScreen(container, {
      eyebrow: "EXPEDITION SETUP",
      title: "ダンジョン選択",
      subtitle: "難易度とダンジョンをそれぞれ選ぶと、挑戦を開始できます。",
      body,
      actions: [
        button("ポーズ", { variant: "ghost", onClick: () => api.callScene("pause") }),
        button("挑戦開始", {
          variant: "primary",
          disabled: !canChallenge,
          onClick: () => {
            startNewRun(selectedDungeonId, selectedDifficultyId);
            api.navigateTo("map");
          },
        }),
      ],
    });
  }

  render();
  return {};
}

import { renderScreen, button, h } from "../dom.js";
import state from "../state.js";
import { describeCoating, describeCharacter } from "../data/resourceCatalog.js";

// View-only: 糖衣 kept in the warehouse, and 隊員 who have retired. (A
// real build would likely split these into separate tabs; one screen is
// enough for this prototype.)
export function GalleryScene(container, params, api) {
  let selectedCoatingId = null;
  let selectedCharacterId = null;

  function render() {
    const coatingGrid = h(
      "div",
      { class: "item-grid" },
      state.warehouseItems.map((item) =>
        h(
          "div",
          {
            class: `item-tile${selectedCoatingId === item.id ? " is-selected" : ""}`,
            onClick: () => {
              selectedCoatingId = item.id;
              selectedCharacterId = null;
              render();
            },
          },
          [
            h("div", { class: "item-tile__glyph", text: item.name.slice(0, 1) }),
            h("div", { class: "item-tile__name", text: item.name }),
          ]
        )
      )
    );

    const characterList = state.retiredSlots.length
      ? h(
          "div",
          { class: "slot-list" },
          state.retiredSlots.map((c) =>
            h(
              "div",
              {
                class: `slot${selectedCharacterId === c.id ? " slot--pending" : ""}`,
                onClick: () => {
                  selectedCharacterId = c.id;
                  selectedCoatingId = null;
                  render();
                },
              },
              [
                h("div", { class: "slot__meta" }, [
                  h("span", { class: "slot__id", text: `Lv.${c.level}` }),
                  h("span", { class: "slot__name", text: c.name }),
                ]),
              ]
            )
          )
        )
      : h("p", { class: "lead", text: "退役した隊員はまだいません。" });

    const body = [
      h("div", { class: "field-group" }, [h("p", { class: "field-label", text: "糖衣" }), coatingGrid]),
      h("div", { class: "field-group" }, [
        h("p", { class: "field-label", text: "退役した隊員" }),
        characterList,
      ]),
    ];

    const selectedCoating = state.warehouseItems.find((i) => i.id === selectedCoatingId);
    const selectedCharacter = state.retiredSlots.find((c) => c.id === selectedCharacterId);
    if (selectedCoating) {
      body.push(
        h("div", { class: "panel" }, [
          h("p", { class: "field-label", text: selectedCoating.name }),
          h("p", { class: "lead", text: describeCoating(selectedCoating) }),
        ])
      );
    }
    if (selectedCharacter) {
      body.push(
        h("div", { class: "panel" }, [
          h("p", { class: "field-label", text: selectedCharacter.name }),
          h("p", { class: "lead", text: describeCharacter(selectedCharacter) }),
        ])
      );
    }

    renderScreen(container, {
      eyebrow: "GALLERY",
      title: "ギャラリー",
      subtitle: "倉庫の糖衣と、退役した隊員を鑑賞できます。",
      body,
      actions: [button("戻る", { variant: "ghost", onClick: () => api.closeScene() })],
    });
  }

  render();
  return {};
}

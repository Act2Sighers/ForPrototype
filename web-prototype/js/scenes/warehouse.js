import { renderScreen, button, h } from "../dom.js";
import state from "../state.js";

const MODE_LABEL = { view: "鑑賞", takeout: "持ち出し" };

// Note: unlike every other called screen, the warehouse does NOT offer a
// "ポーズ" option. It can be opened from the title screen's gallery
// (outside any run), where pausing — with its save/load actions — would
// not make sense.
export function WarehouseScene(container, params, api) {
  const mode = params.mode;
  if (mode !== "view" && mode !== "takeout") {
    throw new Error('warehouse scene requires params.mode of "view" or "takeout"');
  }

  let selectedItemId = null;

  function render() {
    const items = state.warehouseItems.filter((item) => item.enabled);
    const takenOutIds = state.run?.takenOutItemIds ?? [];

    const grid = h(
      "div",
      { class: "item-grid" },
      items.map((item) => {
        const isTaken = mode === "takeout" && takenOutIds.includes(item.id);
        return h(
          "div",
          {
            class: `item-tile${isTaken ? " is-taken" : ""}`,
            onClick: () => {
              selectedItemId = item.id;
              if (mode === "takeout" && !isTaken && state.run) {
                state.run.takenOutItemIds.push(item.id);
              }
              render();
            },
          },
          [
            h("div", { class: "item-tile__glyph", text: item.name.slice(0, 1) }),
            h("div", { class: "item-tile__name", text: item.name }),
            isTaken ? h("span", { class: "tag", text: "持ち出し済み" }) : null,
          ]
        );
      })
    );

    const selectedItem = items.find((item) => item.id === selectedItemId);

    const body = [
      h("div", { class: "field-group" }, [
        h("p", { class: "field-label", text: "引き継ぎアイテム" }),
        grid,
      ]),
    ];

    if (selectedItem) {
      body.push(
        h("div", { class: "panel" }, [
          h("p", { class: "field-label", text: selectedItem.name }),
          h("p", { class: "lead", text: selectedItem.description }),
        ])
      );
    }

    renderScreen(container, {
      eyebrow: `WAREHOUSE / ${MODE_LABEL[mode]}モード`,
      title: "倉庫",
      subtitle:
        mode === "view"
          ? "アイテムをクリックすると詳細を確認できます。"
          : "アイテムをクリックすると持ち出せます（複数選択可）。",
      body,
      actions: [button("戻る", { variant: "ghost", onClick: () => api.closeScene() })],
    });
  }

  render();
  return {};
}

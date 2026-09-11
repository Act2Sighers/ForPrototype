import { renderScreen, button, h } from "../dom.js";
import state from "../state.js";
import { describeCoating } from "../data/resourceCatalog.js";

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

  let selectedItemId = null; // view mode: which item's detail is shown
  const pickedIds = new Set(); // takeout mode: items chosen, not yet committed

  function render() {
    const items = state.warehouseItems.filter((item) => item.enabled);
    const takenOutIds = state.run?.takenOutItemIds ?? [];

    const grid = h(
      "div",
      { class: "item-grid" },
      items.map((item) => {
        const isTaken = mode === "takeout" && takenOutIds.includes(item.id);
        const isPicked = mode === "takeout" && pickedIds.has(item.id);

        const classes = ["item-tile"];
        if (isTaken) classes.push("is-taken");
        if (isPicked) classes.push("is-selected");

        return h(
          "div",
          {
            class: classes.join(" "),
            onClick: () => {
              if (mode === "view") {
                selectedItemId = item.id;
              } else if (!isTaken) {
                // Toggle this item in/out of the current multi-selection.
                if (pickedIds.has(item.id)) pickedIds.delete(item.id);
                else pickedIds.add(item.id);
              }
              render();
            },
          },
          [
            h("div", { class: "item-tile__glyph", text: item.name.slice(0, 1) }),
            h("div", { class: "item-tile__name", text: item.name }),
            isTaken ? h("span", { class: "tag", text: "持ち出し済み" }) : null,
            isPicked ? h("span", { class: "tag tag--selected", text: "選択中" }) : null,
          ]
        );
      })
    );

    const selectedItem = mode === "view" ? items.find((item) => item.id === selectedItemId) : null;

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
          h("p", { class: "lead", text: describeCoating(selectedItem) }),
        ])
      );
    }

    const actions = [button("戻る", { variant: "ghost", onClick: () => api.closeScene() })];

    if (mode === "takeout") {
      actions.push(
        button(pickedIds.size ? `持ち出す（${pickedIds.size}）` : "持ち出す", {
          variant: "primary",
          disabled: pickedIds.size === 0,
          onClick: () => {
            if (state.run) {
              for (const id of pickedIds) {
                if (!state.run.takenOutItemIds.includes(id)) {
                  state.run.takenOutItemIds.push(id);
                }
              }
            }
            pickedIds.clear();
            api.closeScene();
          },
        })
      );
    }

    renderScreen(container, {
      eyebrow: `WAREHOUSE / ${MODE_LABEL[mode]}モード`,
      title: "倉庫",
      subtitle:
        mode === "view"
          ? "アイテムをクリックすると詳細を確認できます。"
          : "アイテムをクリックして複数選択し、「持ち出す」で確定します。",
      body,
      actions,
    });
  }

  render();
  return {};
}

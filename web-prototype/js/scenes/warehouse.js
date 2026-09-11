import { renderScreen, button, h } from "../dom.js";
import state from "../state.js";
import { describeCoating } from "../data/resourceCatalog.js";

// The warehouse only ever holds 糖衣 (coatings) now — 隊員/武器 live in
// the formation/standby/retired slots instead (see state.js), and pure
// viewing moved to the gallery screen. So this screen has exactly one
// job: pick coatings to bring on the run.
//
// Note: unlike every other called screen, the warehouse does NOT offer
// a "ポーズ" option — it's only ever opened mid-run from the trade
// screen, which already has its own ポーズ button one level up.
export function WarehouseScene(container, params, api) {
  const pickedIds = new Set(); // items chosen this visit, not yet committed

  function render() {
    const items = state.warehouseItems.filter((item) => item.enabled);
    const takenOutIds = state.run?.takenOutItemIds ?? [];

    const grid = h(
      "div",
      { class: "item-grid" },
      items.map((item) => {
        const isTaken = takenOutIds.includes(item.id);
        const isPicked = pickedIds.has(item.id);

        const classes = ["item-tile"];
        if (isTaken) classes.push("is-taken");
        if (isPicked) classes.push("is-selected");

        return h(
          "div",
          {
            class: classes.join(" "),
            onClick: () => {
              if (isTaken) return;
              if (pickedIds.has(item.id)) pickedIds.delete(item.id);
              else pickedIds.add(item.id);
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

    renderScreen(container, {
      eyebrow: "WAREHOUSE",
      title: "倉庫",
      subtitle: "糖衣をクリックして複数選択し、「持ち出す」で確定します。",
      body: [h("div", { class: "field-group" }, [h("p", { class: "field-label", text: "糖衣" }), grid])],
      actions: [
        button("戻る", { variant: "ghost", onClick: () => api.closeScene() }),
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
        }),
      ],
    });
  }

  render();
  return {};
}

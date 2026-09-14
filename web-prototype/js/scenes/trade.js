import { renderScreen, button, h, resourceHud } from "../dom.js";
import state from "../state.js";

// Empty implementation per spec, apart from the 雇用所.
export function TradeScene(container, params, api) {
  // Kept alive for as long as this trade visit lasts (i.e. until the
  // whole TradeScene is closed via 先へ進む): passed to the hiring
  // screen and handed back via closeScene's result, so reopening 雇用所
  // within the same visit shows the same candidates (hired flags and
  // all) instead of drawing a fresh pool every time.
  let hiringCandidates = null;
  // Same idea for 鍛冶屋's own 武器取引 candidates -- smithy.js relays
  // its current value back tagged as {weaponTradeCandidates} (see its
  // own comment) so it can't be confused with hiringCandidates' plain
  // array or an {openNext} sibling-swap payload below.
  let weaponTradeCandidates = null;

  function render() {
    renderScreen(container, {
      eyebrow: "TRADE",
      title: "取引",
      corner: resourceHud(state.run?.resources),
      body: [
        h("p", { class: "lead", text: "（未実装：購入・工房などのやり取りも今後入ります）" }),
        h("div", { class: "field-group" }, [
          h("p", { class: "field-label", text: "お店" }),
          h("div", { class: "chip-row" }, [
            h("button", {
              class: "chip",
              text: "雇用所",
              onClick: () => api.callScene("hiring", { mode: "normal", candidates: hiringCandidates }),
            }),
            h("button", {
              class: "chip",
              text: "鍛冶屋",
              onClick: () => api.callScene("smithy", { weaponTradeCandidates }),
            }),
          ]),
        ]),
      ],
      actions: [
        button("ポーズ", { variant: "ghost", onClick: () => api.callScene("pause") }),
        button("部隊編成", { onClick: () => api.callScene("squadFormation") }),
        button("武器", { onClick: () => api.callScene("weaponStorage") }),
        button("資源", { onClick: () => api.callScene("resourceStorage") }),
        button("倉庫を開く", { onClick: () => api.callScene("warehouse") }),
        button("先へ進む", { variant: "primary", onClick: () => api.closeScene() }),
      ],
    });
  }

  render();
  return {
    onResume: (result) => {
      // See map.js's identical handling: squadFormation/weaponStorage/
      // resourceStorage's "武器"/"資源"/"部隊編成" buttons close
      // themselves with this flag instead of nesting a callScene, so
      // the three screens can swap between each other without growing
      // the scene stack.
      if (result?.openNext) {
        api.callScene(result.openNext);
        return;
      }
      if (result?.weaponTradeCandidates) {
        weaponTradeCandidates = result.weaponTradeCandidates;
        render();
        return;
      }
      if (result) hiringCandidates = result;
      render();
    },
  };
}

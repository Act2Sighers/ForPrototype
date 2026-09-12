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
          ]),
        ]),
      ],
      actions: [
        button("ポーズ", { variant: "ghost", onClick: () => api.callScene("pause") }),
        button("部隊編成", { onClick: () => api.callScene("squadFormation") }),
        button("倉庫を開く", { onClick: () => api.callScene("warehouse") }),
        button("先へ進む", { variant: "primary", onClick: () => api.closeScene() }),
      ],
    });
  }

  render();
  return {
    onResume: (candidates) => {
      if (candidates) hiringCandidates = candidates;
      render();
    },
  };
}

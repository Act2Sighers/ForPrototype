import { renderScreen, button, h, resourceHud } from "../dom.js";
import state from "../state.js";

// 取引画面. お店の項目から雇用所/鍛冶屋/軽食画面（自販機/喫茶店/
// フードトラック/菓子配りの4モード）へ遷移する。
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
  // 軽食画面の4モード分のラインナップ。同じ要領で、timeEats.js が
  // {timeEatsMode, timeEatsLineup} タグ付きで返してくる（モードごとに
  // 別のラインナップなので、雇用所/武器取引と違って単一の変数ではなく
  // モードをキーにしたオブジェクトで持つ）。
  const timeEatsLineups = { vendingMachine: null, cafe: null, foodTruck: null, candyHandout: null };

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
            h("button", {
              class: "chip",
              text: "仕立て屋",
              onClick: () => api.callScene("tailorShop"),
            }),
            h("button", {
              class: "chip",
              text: "自販機",
              onClick: () => api.callScene("timeEats", { mode: "vendingMachine", lineup: timeEatsLineups.vendingMachine }),
            }),
            h("button", {
              class: "chip",
              text: "喫茶店",
              onClick: () => api.callScene("timeEats", { mode: "cafe", lineup: timeEatsLineups.cafe }),
            }),
            h("button", {
              class: "chip",
              text: "フードトラック",
              onClick: () => api.callScene("timeEats", { mode: "foodTruck", lineup: timeEatsLineups.foodTruck }),
            }),
            h("button", {
              class: "chip",
              text: "菓子配り",
              onClick: () => api.callScene("timeEats", { mode: "candyHandout", lineup: timeEatsLineups.candyHandout }),
            }),
          ]),
        ]),
      ],
      actions: [
        button("ポーズ", { variant: "ghost", onClick: () => api.callScene("pause") }),
        button("部隊編成", { onClick: () => api.callScene("squadFormation") }),
        button("武器", { onClick: () => api.callScene("weaponStorage") }),
        button("荷物", { onClick: () => api.callScene("resourceStorage") }),
        button("倉庫を開く", { onClick: () => api.callScene("warehouse") }),
        button("先へ進む", { variant: "primary", onClick: () => api.closeScene() }),
      ],
    });
  }

  render();
  return {
    onResume: (result) => {
      // See map.js's identical handling: squadFormation/weaponStorage/
      // resourceStorage's "武器"/"荷物"/"部隊編成" buttons close
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
      if (result?.timeEatsMode) {
        timeEatsLineups[result.timeEatsMode] = result.timeEatsLineup;
        render();
        return;
      }
      if (result) hiringCandidates = result;
      render();
    },
  };
}

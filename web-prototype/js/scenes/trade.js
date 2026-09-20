import { renderScreen, button, h, resourceHud } from "../dom.js";
import state from "../state.js";
import { MODE_LABELS, pickRandomTimeEatsStoreMode } from "./timeEats.js";

// 取引画面. 集落マス／工房マスのどちらから呼ばれたかでお店の中身が
// 丸ごと変わる、2モード必須の画面（旧来の「全ての店に繋がっている」
// デフォルト状態は廃止 -- マス種別が整理された今、その状態は存在し
// 得ない）。
//  - "village"（集落マス）: 雇用所 と、軽食4モード（自販機/喫茶店/
//    フードトラック/菓子配り）のうちこの取引イベント開始時に1つだけ
//    抽選されたもの、計2つのボタン。
//  - "workshop"（工房マス）: 鍛冶屋 と 仕立て屋、計2つのボタン。
// 画面下部の共通ボタン（ポーズ/部隊編成/武器/糖衣/荷物/倉庫を開く/
// 先へ進む）はどちらのモードでも変わらない。
export function TradeScene(container, params, api) {
  const mode = params.mode;
  if (mode !== "village" && mode !== "workshop") {
    throw new Error('trade scene requires params.mode of "village" or "workshop"');
  }

  // 雇用所の候補一覧（集落モードのみ使う）。hiring.js が素の配列で
  // closeSceneするのを、この取引イベントの間ずっと保持し続ける -- 再訪
  // しても再抽選しない、という既存の慣習をそのまま踏襲。
  let hiringCandidates = null;
  // 鍛冶屋の武器取引候補一覧（工房モードのみ使う）。smithy.js が
  // {weaponTradeCandidates}タグ付きで返してくるものをそのまま保持する。
  let weaponTradeCandidates = null;
  // 集落モードの「お店」に並ぶ軽食チップは、取引イベント開始時に4モード
  // から1つだけ抽選され、以後この取引イベント中は固定される（再訪して
  // も再抽選しない）。そのモードのラインナップ自体も同じ要領で保持。
  const villageSnackMode = mode === "village" ? pickRandomTimeEatsStoreMode() : null;
  let villageSnackLineup = null;

  function render() {
    const shopChips =
      mode === "village"
        ? [
            h("button", {
              class: "chip",
              text: "雇用所",
              onClick: () => api.callScene("hiring", { mode: "normal", candidates: hiringCandidates }),
            }),
            h("button", {
              class: "chip",
              text: MODE_LABELS[villageSnackMode],
              onClick: () => api.callScene("timeEats", { mode: villageSnackMode, lineup: villageSnackLineup }),
            }),
          ]
        : [
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
          ];

    renderScreen(container, {
      eyebrow: mode === "village" ? "TRADE / VILLAGE" : "TRADE / WORKSHOP",
      title: mode === "village" ? "取引（集落モード）" : "取引（工房モード）",
      corner: resourceHud(state.run?.resources),
      body: [
        h("div", { class: "field-group" }, [
          h("p", { class: "field-label", text: "お店" }),
          h("div", { class: "chip-row" }, shopChips),
        ]),
      ],
      onPause: () => api.callScene("pause"),
      actions: [
        button("部隊編成", { onClick: () => api.callScene("squadFormation") }),
        button("武器", { onClick: () => api.callScene("weaponStorage") }),
        button("糖衣", { onClick: () => api.callScene("coatingStorage") }),
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
        villageSnackLineup = result.timeEatsLineup;
        render();
        return;
      }
      if (result) hiringCandidates = result;
      render();
    },
  };
}

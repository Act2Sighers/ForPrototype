import { renderScreen, button, h, resourceHud } from "../dom.js";
import state from "../state.js";

// 行商画面. trade.js's own お店 chip row（雇用所/鍛冶屋/仕立て屋/軽食系
// と同格）から呼ばれる、前触れなく現れる小さな移動商店。荷馬車には
// 雇用/武器/軽食/資源の4ボタンがあり、それぞれ hiring.js/weaponTrade.js/
// timeEats.js/resourceTrade.js を mode:"peddler"（資源はそもそも行商
// 専用画面なのでmode無し）で呼び出す。smithy.jsと同じ理由でポーズは
// 出さない（trade.jsに既に1つある）。
//
// この4画面はいずれも「同じ取引イベント内で再抽選が起きない」ことが
// 要件 -- trade.js が雇用所/武器取引/軽食のラインナップをそれぞれ保持
// し続けるのと同じ流儀で、この画面もparams.peddlerStateとして受け取った
// 各画面の抽選結果をクロージャ変数に保持し、閉じる際に{peddlerState:{...}}
// タグ付きでtrade.jsへ返す。
//
// hiring.js/weaponTrade.js/resourceTrade.jsはどれも「もどる」を素の配列
// でcloseScene()する（雇用所/鍛冶屋の候補、資源取引のオファー、という
// 形の異なる配列）。この画面はそれら3つを直接ラップする最初の画面な
// ので、どの子画面が今開いているかをpendingChildで追跡し、onResumeで
// 戻り値をどの変数に反映すべきか判定する（timeEats.jsだけは
// {timeEatsMode, timeEatsLineup}のタグ付き結果を返すので、pendingChild
// を見るまでもなく自己記述的に判定できる）。
export function PeddlerShopScene(container, params, api) {
  const peddlerState = params.peddlerState ?? {};
  let hiringCandidates = peddlerState.hiringCandidates ?? null;
  let weaponTradeCandidates = peddlerState.weaponTradeCandidates ?? null;
  let timeEatsLineup = peddlerState.timeEatsLineup ?? null;
  let resourceTradeOffers = peddlerState.resourceTradeOffers ?? null;
  let pendingChild = null;

  function openHiring() {
    pendingChild = "hiring";
    api.callScene("hiring", { mode: "peddler", candidates: hiringCandidates });
  }

  function openWeaponTrade() {
    pendingChild = "weaponTrade";
    api.callScene("weaponTrade", { mode: "peddler", candidates: weaponTradeCandidates });
  }

  function openTimeEats() {
    pendingChild = "timeEats";
    api.callScene("timeEats", { mode: "peddler", lineup: timeEatsLineup });
  }

  function openResourceTrade() {
    pendingChild = "resourceTrade";
    api.callScene("resourceTrade", { offers: resourceTradeOffers });
  }

  function render() {
    renderScreen(container, {
      eyebrow: "PEDDLER",
      title: "行商人",
      subtitle: "荷馬車を覗いてみましょう。",
      corner: resourceHud(state.run?.resources),
      body: [
        h("div", { class: "field-group" }, [
          h("p", { class: "field-label", text: "荷馬車" }),
          h("div", { class: "chip-row" }, [
            h("button", { class: "chip", text: "雇用", onClick: openHiring }),
            h("button", { class: "chip", text: "武器", onClick: openWeaponTrade }),
            h("button", { class: "chip", text: "軽食", onClick: openTimeEats }),
            h("button", { class: "chip", text: "資源", onClick: openResourceTrade }),
          ]),
        ]),
      ],
      actions: [
        button("店を出る", {
          variant: "primary",
          onClick: () =>
            api.closeScene({
              peddlerState: { hiringCandidates, weaponTradeCandidates, timeEatsLineup, resourceTradeOffers },
            }),
        }),
      ],
    });
  }

  render();
  return {
    onResume: (result) => {
      if (result?.timeEatsMode) {
        timeEatsLineup = result.timeEatsLineup;
      } else if (pendingChild === "hiring") {
        hiringCandidates = result;
      } else if (pendingChild === "weaponTrade") {
        weaponTradeCandidates = result;
      } else if (pendingChild === "resourceTrade") {
        resourceTradeOffers = result;
      }
      pendingChild = null;
      render();
    },
  };
}

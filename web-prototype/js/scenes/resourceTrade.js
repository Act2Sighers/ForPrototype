import { renderScreen, button, h, resourceHud } from "../dom.js";
import state, { purchaseResourceTradeOffer } from "../state.js";
import {
  NATURAL_RESOURCES,
  RIGID_RESOURCES,
  naturalResourceTierName,
  rigidResourceTierName,
  hasEnoughForResourceTradeOffer,
  generateResourceTradeOffers,
} from "../data/resourceCatalog.js";

function speciesName(speciesId) {
  return (NATURAL_RESOURCES[speciesId] ?? RIGID_RESOURCES[speciesId]).name;
}

function offerItemName(offer) {
  return offer.category === "natural" ? naturalResourceTierName(offer.speciesId, offer.tier) : rigidResourceTierName(offer.speciesId, offer.tier);
}

// 資源取引画面（行商モード限定）。高品質な剛体資源1種＋特上品質な自然
// 資源1種を、別の資源（品質問わず）との交換で買える。荷物置き場画面の
// 資源表示部分のスタイル（.panel/.slot__meta/.slot__name）を流用。
// offers（generateResourceTradeOffersが返す2件）はpeddlerShop.jsが
// 保持し続け、同じ取引イベント内で再訪しても再抽選にならない。
export function ResourceTradeScene(container, params, api) {
  const offers = params.offers ?? generateResourceTradeOffers();

  let pending = null; // { offerId, kind: "confirm" | "insufficient" }

  function handleTradeClick(offer) {
    pending = { offerId: offer.id, kind: hasEnoughForResourceTradeOffer(state.run?.resources, offer) ? "confirm" : "insufficient" };
    render();
  }

  function confirmTrade(offer) {
    purchaseResourceTradeOffer(offer);
    offer.purchased = true;
    pending = null;
    render();
  }

  function dismissPending() {
    pending = null;
    render();
  }

  function pendingPanel(offer) {
    if (pending.kind === "confirm") {
      return h("div", { class: "confirm-row" }, [
        h("span", {
          class: "confirm-row__text",
          text: `${offerItemName(offer)}×${offer.quantity}を取引します（取引要求：${speciesName(offer.requirementSpeciesId)}×${offer.requirementQuantity}）。よろしいですか？`,
        }),
        button("実行する", { variant: "primary", onClick: () => confirmTrade(offer) }),
        button("キャンセル", { variant: "ghost", onClick: dismissPending }),
      ]);
    }
    return h("div", { class: "confirm-row" }, [
      h("span", { class: "confirm-row__text", text: `${speciesName(offer.requirementSpeciesId)}が足りません。` }),
      button("OK", { variant: "ghost", onClick: dismissPending }),
    ]);
  }

  function offerRow(offer) {
    const isPendingThis = pending?.offerId === offer.id;
    const children = [
      h("div", { class: "slot__meta" }, [
        h("span", { class: "slot__name", text: `${offerItemName(offer)}×${offer.quantity}` }),
        h("span", { class: "tag", text: `取引要求：${speciesName(offer.requirementSpeciesId)}×${offer.requirementQuantity}` }),
        offer.purchased ? h("span", { class: "tag tag--selected", text: "取引済み" }) : null,
      ]),
    ];
    if (isPendingThis) {
      children.push(pendingPanel(offer));
    } else {
      children.push(
        h("div", { class: "slot__actions" }, [
          button("取引", { variant: "primary", disabled: offer.purchased, onClick: () => handleTradeClick(offer) }),
        ])
      );
    }
    return h("div", { class: "panel" }, children);
  }

  function render() {
    renderScreen(container, {
      eyebrow: "PEDDLER / RESOURCE TRADE",
      title: "資源取引（荷馬車）",
      subtitle: "交換したい資源を選んでください。",
      corner: resourceHud(state.run?.resources),
      body: [h("div", { class: "slot-list slot-list--grid" }, offers.map(offerRow))],
      onPause: () => api.callScene("pause"),
      actions: [button("もどる", { variant: "ghost", onClick: () => api.closeScene(offers) })],
    });
  }

  render();
  return { onResume: () => render() };
}

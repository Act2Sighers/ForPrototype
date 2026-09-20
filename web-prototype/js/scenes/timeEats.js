import { renderScreen, button, h, resourceHud } from "../dom.js";
import state, { canAffordCost, purchaseTimeEats } from "../state.js";
import {
  RIGID_RESOURCES,
  TIME_EATS_TARGET_LABELS,
  generateTimeEatsLineup,
  generatePeddlerTimeEatsLineup,
  computeTimeEatsCheckoutTotal,
} from "../data/resourceCatalog.js";

const COST_ABBR = RIGID_RESOURCES.coarseSugarMineral.abbr;

export const MODE_LABELS = {
  vendingMachine: "自販機",
  cafe: "喫茶店",
  foodTruck: "フードトラック",
  candyHandout: "菓子配り",
  peddler: "行商",
};

// "peddler"は独自のeyebrow/title（軽食（荷馬車）系）をrender側で直接
// 出すため、ここには含めない -- render()のonPause以下参照。
const MODE_EYEBROWS = {
  vendingMachine: "VENDING MACHINE",
  cafe: "CAFE",
  foodTruck: "FOOD TRUCK",
  candyHandout: "SNACK GIVER",
};

// 軽食画面の「本来の」4店舗モード（peddlerを除く）。集落マスの取引画面
// が「お店」に並べる1つをこの中から抽選するのと、軽食マス自体がこの
// 画面を直接呼ぶ際にどのモードで開くかを抽選するのとで、どちらも同じ
// プールから選ぶ -- map.js/trade.jsの両方から使われる。
export const TIME_EATS_STORE_MODES = ["vendingMachine", "cafe", "foodTruck", "candyHandout"];

export function pickRandomTimeEatsStoreMode() {
  return TIME_EATS_STORE_MODES[Math.floor(Math.random() * TIME_EATS_STORE_MODES.length)];
}

// 店ごとに固有の振る舞い（初回限定品の割引、環境による取扱対象外の
// 可能性、セット割引、数量限定の抽選品）をプレイヤーに一言説明してお
// くための、説明文2行目。
const MODE_HINTS = {
  vendingMachine: "（クロノスタブは初回購入に限り8割引でお試しいただけます！）",
  cafe: "（一部メニューは設営環境によって取扱対象外となる可能性がございます）",
  foodTruck: "（シェア・ハンドとダイアル・バーガーはセットで購入するとお買い得です！）",
  candyHandout: "（限定版クロッケット、好評につき数量限定で販売中！）",
  peddler: "（行商ならではの品揃え、数量限定でお買い得！）",
};

// 軽食画面. params.mode は5種（vendingMachine/cafe/foodTruck/
// candyHandout/peddler）のいずれか必須。params.lineup が渡されればそれを
// そのまま使う（trade.js/peddlerShop.js が雇用所/武器取引と同じ要領で、
// 取引イベント内の再訪をまたいでラインナップ -- 残り数量や購入済み
// フラグごと -- を保持し続けるため。lineup自体はresourceCatalog.jsの
// エントリを直接mutateする、ここも武器置き場（売却モード）と同じ流儀）。
// 渡されなければ新規生成する（初回訪問時）。peddlerモードは4モードの
// 垣根を越えた固定8品プールから3品を抽選し（generatePeddlerTimeEatsLineup
// 参照）、数量は各2固定・価格は半額（切り上げ）、カフェのモード切り替え
// やフードトラックのセット割引は適用されない（他の4モードのような
// カテゴリ固有ロジックが無いだけで、画面のUI/購入フローは共通）。
//
// 購入数量の入力欄は、renderScreenがインタラクトのたびに.screen-frame
// を丸ごと作り直す都合上、oninputで毎キー入力ごとに再描画すると入力中
// にフォーカスが飛んでしまう。そのためonchange（フォーカスが外れた時/
// Enter確定時）で確定させる方式にしている -- 入力欄自体は素のnumber
// inputなので、確定前のタイピング自体はブラウザのネイティブ挙動に任せ、
// 再描画を挟まない。
export function TimeEatsScene(container, params, api) {
  const mode = params.mode;
  if (!MODE_LABELS[mode]) {
    throw new Error(`timeEats scene requires a valid params.mode, got: ${mode}`);
  }

  const lineup =
    params.lineup ??
    (mode === "peddler" ? generatePeddlerTimeEatsLineup() : generateTimeEatsLineup(mode, state.run.purchasedFirstTimeOnlyIds));

  let purchases = {}; // {defId: 購入予定数量}, お会計確定でクリアされる
  let pendingCheckout = null; // null | "confirm" | "insufficient-funds"

  function totalQtyEntered() {
    return Object.values(purchases).reduce((sum, qty) => sum + qty, 0);
  }

  function handleQtyChange(entry, rawValue) {
    let qty = parseInt(rawValue, 10);
    if (!Number.isFinite(qty) || qty < 0) qty = 0;
    if (qty > entry.remainingQty) qty = entry.remainingQty;
    if (qty === 0) delete purchases[entry.defId];
    else purchases[entry.defId] = qty;
    render();
  }

  function handleCheckoutClick() {
    const total = computeTimeEatsCheckoutTotal(mode, lineup, purchases);
    pendingCheckout = canAffordCost(total) ? "confirm" : "insufficient-funds";
    render();
  }

  function confirmCheckout() {
    purchaseTimeEats(mode, lineup, purchases);
    purchases = {};
    pendingCheckout = null;
    render();
  }

  function dismissPending() {
    pendingCheckout = null;
    render();
  }

  function itemRow(entry) {
    const qty = purchases[entry.defId] ?? 0;
    const soldOut = entry.remainingQty <= 0;
    return h("div", { class: `panel${soldOut ? " panel--sold-out" : ""}` }, [
      h("div", { class: "row-between" }, [
        h("div", { class: "slot__meta" }, [
          h("span", { class: "slot__name", text: entry.name }),
          h("span", { class: "tag", text: `価格 ${COST_ABBR}×${entry.price}` }),
          soldOut ? null : h("span", { class: "tag", text: `残り${entry.remainingQty}個` }),
        ]),
        soldOut ? h("span", { class: "sold-out-badge", text: "売り切れ" }) : null,
      ]),
      h("p", {
        class: "lead",
        text: `対象：${TIME_EATS_TARGET_LABELS[entry.target]}／HP回復量：${entry.hpRecoveryPercent}%／変換効率：${entry.conversionEfficiency}%`,
      }),
      h("div", { class: "qty-input-row" }, [
        h("span", { class: "field-label", text: "購入数量" }),
        h("input", {
          type: "number",
          class: "qty-input",
          min: "0",
          max: String(entry.remainingQty),
          value: String(qty),
          disabled: soldOut,
          onchange: (e) => handleQtyChange(entry, e.target.value),
        }),
      ]),
    ]);
  }

  function pendingPanel() {
    if (pendingCheckout === "confirm") {
      const total = computeTimeEatsCheckoutTotal(mode, lineup, purchases);
      return h("div", { class: "confirm-row" }, [
        h("span", { class: "confirm-row__text", text: `合計${COST_ABBR}×${total}を支払い、購入します。よろしいですか？` }),
        button("実行する", { variant: "primary", onClick: confirmCheckout }),
        button("キャンセル", { variant: "ghost", onClick: dismissPending }),
      ]);
    }
    return h("div", { class: "confirm-row" }, [
      h("span", { class: "confirm-row__text", text: `${COST_ABBR}が足りません。` }),
      button("OK", { variant: "ghost", onClick: dismissPending }),
    ]);
  }

  function render() {
    const hasSelection = totalQtyEntered() > 0;
    const total = computeTimeEatsCheckoutTotal(mode, lineup, purchases);

    const body = [];
    if (hasSelection) {
      body.push(h("p", { class: "lead", text: `支払い総額：${COST_ABBR}×${total}` }));
    }
    body.push(
      lineup.length
        ? h("div", { class: "slot-list slot-list--grid" }, lineup.map(itemRow))
        : h("p", { class: "lead", text: "取り扱っている時間食がありません。" })
    );
    // 確認/警告は「お会計」ボタンの近く（商品一覧の下）に置く。
    if (pendingCheckout) {
      body.push(pendingPanel());
    }

    renderScreen(container, {
      eyebrow: mode === "peddler" ? "PEDDLER / TIMEEATS" : MODE_EYEBROWS[mode],
      title: mode === "peddler" ? "軽食（荷馬車）" : MODE_LABELS[mode],
      subtitle: `購入したい時間食の数量をそれぞれ入力し、「お会計」で一括購入します。\n${MODE_HINTS[mode]}`,
      corner: resourceHud(state.run?.resources),
      onPause: () => api.callScene("pause"),
      body,
      actions: [
        button(mode === "peddler" ? "もどる" : "店を出る", {
          variant: "ghost",
          onClick: () => api.closeScene({ timeEatsMode: mode, timeEatsLineup: lineup }),
        }),
        button("お会計", {
          variant: "primary",
          disabled: !hasSelection || Boolean(pendingCheckout),
          onClick: handleCheckoutClick,
        }),
      ],
    });
  }

  render();
  return { onResume: () => render() };
}

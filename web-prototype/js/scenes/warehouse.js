import { renderScreen, button, h } from "../dom.js";
import state from "../state.js";
import { describeCoating, groupCoatingsByName, describeCoatingGroupDetail } from "../data/resourceCatalog.js";

// 倉庫画面. 糖衣が置かれる2つの場所（倉庫／糖衣置き場）のうち、まだ
// このランで持ち出されていない分だけを表示する（=state.run.takenOutItemIds
// に無いもの -- coatingStorage.jsはその逆で、taken out済みのものだけ
// を表示する）。同名（attribute/effect）の糖衣はgroupCoatingsByNameで
// 束ねて1行にまとめ（coatingStorage.jsと表示内容を揃えている）、
// 「選択」はグループ単位（完熟/未熟を区別した個別選択はしない -- 持ち
// 出す時はその名前の糖衣を全部持ち出す）。「持ち出す」でまとめて
// state.run.takenOutItemIdsへ積み、以後は糖衣置き場側に現れる（戻す
// 手段は無い -- ランの終了時に自動的に倉庫側へ回収される）。
//
// Note: unlike every other called screen, the warehouse does NOT offer
// a "ポーズ" option — it's only ever opened mid-run from the trade
// screen, which already has its own ポーズ button one level up.
export function WarehouseScene(container, params, api) {
  const pickedKeys = new Set(); // group keys ("attribute_effect") chosen this visit, not yet committed
  const expandedKeys = new Set();

  function toggleDetail(key) {
    if (expandedKeys.has(key)) expandedKeys.delete(key);
    else expandedKeys.add(key);
    render();
  }

  function togglePick(key) {
    if (pickedKeys.has(key)) pickedKeys.delete(key);
    else pickedKeys.add(key);
    render();
  }

  function groupRow(group) {
    const key = `${group.attribute}_${group.effect}`;
    const isPicked = pickedKeys.has(key);
    const isExpanded = expandedKeys.has(key);
    const children = [
      h("div", { class: "slot__meta" }, [h("span", { class: "slot__name", text: group.name })]),
      h("div", { class: "slot__actions" }, [
        button(isExpanded ? "詳細を隠す" : "詳細表示", { variant: "ghost", onClick: () => toggleDetail(key) }),
        button(isPicked ? "外す" : "選択", { variant: isPicked ? "frost" : "ghost", onClick: () => togglePick(key) }),
      ]),
    ];
    if (isExpanded) {
      const representative = group.immature ?? group.items[group.items.length - 1];
      children.push(h("p", { class: "lead", text: describeCoating(representative) }));
      children.push(h("p", { class: "lead", text: describeCoatingGroupDetail(group) }));
    }
    return h("div", { class: `panel${isPicked ? " panel--selected" : ""}` }, children);
  }

  function render() {
    const takenOutIds = state.run?.takenOutItemIds ?? [];
    const coatings = state.warehouseItems.filter((item) => item.enabled && !takenOutIds.includes(item.id));
    const groups = groupCoatingsByName(coatings);

    renderScreen(container, {
      eyebrow: "WAREHOUSE",
      title: "倉庫",
      subtitle: "持ち出したい糖衣を選択し、「持ち出す」で確定します。",
      body: [
        groups.length
          ? h("div", { class: "slot-list slot-list--grid" }, groups.map(groupRow))
          : h("p", { class: "lead", text: "倉庫に糖衣はありません。" }),
      ],
      actions: [
        button("戻る", { variant: "ghost", onClick: () => api.closeScene() }),
        button(pickedKeys.size ? `持ち出す（${pickedKeys.size}）` : "持ち出す", {
          variant: "primary",
          disabled: pickedKeys.size === 0,
          onClick: () => {
            if (state.run) {
              for (const key of pickedKeys) {
                const [attribute, effect] = key.split("_");
                for (const item of state.warehouseItems) {
                  if (item.attribute === attribute && item.effect === effect && !state.run.takenOutItemIds.includes(item.id)) {
                    state.run.takenOutItemIds.push(item.id);
                  }
                }
              }
            }
            pickedKeys.clear();
            api.closeScene();
          },
        }),
      ],
    });
  }

  render();
  return {};
}

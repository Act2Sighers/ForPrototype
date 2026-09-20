import { renderScreen, button, h } from "../dom.js";
import state from "../state.js";
import { describeCoating, groupCoatingsByName, describeCoatingGroupDetail } from "../data/resourceCatalog.js";

// 糖衣置き場画面. プレイヤーが所持しており、かつ倉庫から持ち出されて
// いる（あるいはこのランで手に入れた/仕立て屋で熟練度を上げた）糖衣
// のみを対象にする（state.run.takenOutItemIds -- warehouse.jsの
// 「持ち出す」、craftAndStoreCoatingの自動持ち出し双方がここに積む）。
// 同名（attribute/effect）の糖衣はgroupCoatingsByNameで束ねて1行に
// まとめ、「詳細表示」で通常の詳細情報（describeCoating、代表として
// 未熟糖衣、無ければ完熟のどれか1つを使う）に加えて熟練度/所持枚数の
// 内訳（describeCoatingGroupDetail）を見せる。武器置き場と違い
// 「装備させる」ボタンは無い（装備は糖衣編集画面の役目）。
export function CoatingStorageScene(container, params, api) {
  const expandedKeys = new Set();

  function toggleDetail(key) {
    if (expandedKeys.has(key)) expandedKeys.delete(key);
    else expandedKeys.add(key);
    render();
  }

  function groupRow(group) {
    const key = `${group.attribute}_${group.effect}`;
    const isExpanded = expandedKeys.has(key);
    const children = [
      h("div", { class: "slot__meta" }, [h("span", { class: "slot__name", text: group.name })]),
      h("div", { class: "slot__actions" }, [
        button(isExpanded ? "詳細を隠す" : "詳細表示", { variant: "ghost", onClick: () => toggleDetail(key) }),
      ]),
    ];
    if (isExpanded) {
      const representative = group.immature ?? group.items[group.items.length - 1];
      children.push(h("p", { class: "lead", text: describeCoating(representative) }));
      children.push(h("p", { class: "lead", text: describeCoatingGroupDetail(group) }));
    }
    return h("div", { class: "panel" }, children);
  }

  function render() {
    const takenOutIds = state.run?.takenOutItemIds ?? [];
    const coatings = state.warehouseItems.filter((item) => item.enabled && takenOutIds.includes(item.id));
    const groups = groupCoatingsByName(coatings);

    renderScreen(container, {
      eyebrow: "COATING STORAGE",
      title: "糖衣置き場",
      subtitle: "このランで持ち出している/手に入れた糖衣の一覧です。",
      body: [
        groups.length
          ? h("div", { class: "slot-list slot-list--grid" }, groups.map(groupRow))
          : h("p", { class: "lead", text: "糖衣置き場に糖衣はありません。" }),
      ],
      // 「糖衣編集」は画面下部から退避させ、タイトル直下の右揃え行
      // （headActions）へ移す -- 明るいピンク地に黒文字のハイライト
      // （primaryと同じ配色）で目立たせる。
      headActions: [button("糖衣編集", { variant: "primary", onClick: () => api.callScene("coatingEdit") })],
      onPause: () => api.callScene("pause"),
      actions: [
        button("マップ", { onClick: () => api.closeScene() }),
        button("部隊編成", { onClick: () => api.closeScene({ openNext: "squadFormation" }) }),
        button("武器", { onClick: () => api.closeScene({ openNext: "weaponStorage" }) }),
        button("糖衣", { disabled: true }),
        button("荷物", { onClick: () => api.closeScene({ openNext: "resourceStorage" }) }),
      ],
    });
  }

  render();
  return { onResume: () => render() };
}

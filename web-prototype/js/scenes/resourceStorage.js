import { renderScreen, button, h } from "../dom.js";
import state from "../state.js";
import { describeResourcesIndividually, NATURAL_RESOURCES, RIGID_RESOURCES, RESOURCE_DESCRIPTIONS } from "../data/resourceCatalog.js";

function speciesName(speciesId) {
  return (NATURAL_RESOURCES[speciesId] ?? RIGID_RESOURCES[speciesId]).name;
}

// 資源置き場画面. Only a "normal" mode exists today (params.mode is
// accepted but unused) -- per the user's own note, future weapon
// forging/enhancement screens will add modes here that narrow which
// resources can be picked, the same way squadFormation/weaponStorage's
// own "swap" mode narrows their lists. Every species the player
// currently holds gets one row (species with nothing held are omitted,
// same as 個別表示 elsewhere); "内訳表示" reveals its flavor text plus
// its per-quality/型番 breakdown. Callable directly from map.js/
// trade.js, or reached via a sibling-swap from squadFormation.js/
// weaponStorage.js's own "資源" buttons -- see their {openNext}
// convention (this screen's own "部隊編成"/"武器" buttons do the same
// swap back out). "閉じる" returns to whoever actually called this
// screen.
export function ResourceStorageScene(container, params, api) {
  const expandedIds = new Set();

  function toggle(id) {
    if (expandedIds.has(id)) expandedIds.delete(id);
    else expandedIds.add(id);
    render();
  }

  function speciesRow(entry) {
    const isExpanded = expandedIds.has(entry.speciesId);
    const children = [
      h("div", { class: "slot__meta" }, [h("span", { class: "slot__name", text: speciesName(entry.speciesId) })]),
      h("div", { class: "slot__actions" }, [
        button(isExpanded ? "内訳を隠す" : "内訳表示", { variant: "ghost", onClick: () => toggle(entry.speciesId) }),
      ]),
    ];
    if (isExpanded) {
      children.push(h("p", { class: "lead", text: RESOURCE_DESCRIPTIONS[entry.speciesId] }));
      children.push(h("p", { class: "resource-line", text: entry.detail }));
    }
    return h("div", { class: "panel" }, children);
  }

  function render() {
    const { natural, rigid } = describeResourcesIndividually(state.run?.resources);
    const body = [
      h("div", { class: "field-group" }, [
        h("p", { class: "field-label", text: "自然資源" }),
        natural.length
          ? h("div", { class: "slot-list slot-list--grid" }, natural.map(speciesRow))
          : h("p", { class: "lead", text: "所持している自然資源はありません。" }),
      ]),
      h("div", { class: "field-group" }, [
        h("p", { class: "field-label", text: "剛体資源" }),
        rigid.length
          ? h("div", { class: "slot-list slot-list--grid" }, rigid.map(speciesRow))
          : h("p", { class: "lead", text: "所持している剛体資源はありません。" }),
      ]),
    ];

    renderScreen(container, {
      eyebrow: "RESOURCE STORAGE",
      title: "資源置き場",
      subtitle: "所持している資源の一覧です。",
      body,
      actions: [
        button("ポーズ", { variant: "ghost", onClick: () => api.callScene("pause") }),
        button("閉じる", { variant: "ghost", onClick: () => api.closeScene() }),
        button("部隊編成", { onClick: () => api.closeScene({ openNext: "squadFormation" }) }),
        button("武器", { onClick: () => api.closeScene({ openNext: "weaponStorage" }) }),
      ],
    });
  }

  render();
  return { onResume: () => render() };
}

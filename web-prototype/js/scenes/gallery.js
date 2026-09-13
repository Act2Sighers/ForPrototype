import { renderScreen, button, h } from "../dom.js";
import { characterInfoCard } from "../characterCard.js";
import state from "../state.js";
import { describeCoating } from "../data/resourceCatalog.js";

// View-only: 糖衣 kept in the warehouse, and 隊員 who have retired. (A
// real build would likely split these into separate tabs; one screen is
// enough for this prototype.) Each row expands its own detail directly
// underneath itself (matching 雇用画面's pattern) rather than showing a
// single detail panel far away at the bottom of the screen.
export function GalleryScene(container, params, api) {
  const expandedCoatingIds = new Set();
  const expandedCharacterIds = new Set();

  function toggle(set, id) {
    if (set.has(id)) set.delete(id);
    else set.add(id);
    render();
  }

  function coatingRow(item) {
    const isExpanded = expandedCoatingIds.has(item.id);
    const children = [
      h("div", { class: "slot__meta" }, [h("span", { class: "slot__name", text: item.name })]),
      h("div", { class: "slot__actions" }, [
        button(isExpanded ? "詳細を隠す" : "詳細表示", {
          variant: "ghost",
          onClick: () => toggle(expandedCoatingIds, item.id),
        }),
      ]),
    ];
    if (isExpanded) {
      children.push(h("p", { class: "lead", text: describeCoating(item) }));
    }
    return h("div", { class: "panel" }, children);
  }

  function characterRow(character) {
    const isExpanded = expandedCharacterIds.has(character.id);
    const children = [
      h("div", { class: "slot__meta" }, [
        h("span", { class: "slot__id", text: `Lv.${character.level}` }),
        h("span", { class: "slot__name", text: character.name }),
      ]),
      h("div", { class: "slot__actions" }, [
        button(isExpanded ? "詳細を隠す" : "詳細表示", {
          variant: "ghost",
          onClick: () => toggle(expandedCharacterIds, character.id),
        }),
      ]),
    ];
    if (isExpanded) {
      children.push(characterInfoCard(character));
    }
    return h("div", { class: "panel" }, children);
  }

  function render() {
    const body = [
      h("div", { class: "field-group" }, [
        h("p", { class: "field-label", text: "糖衣" }),
        h("div", { class: "slot-list slot-list--grid" }, state.warehouseItems.map(coatingRow)),
      ]),
      h("div", { class: "field-group" }, [
        h("p", { class: "field-label", text: "退役した隊員" }),
        state.retiredSlots.length
          ? h("div", { class: "slot-list slot-list--grid" }, state.retiredSlots.map(characterRow))
          : h("p", { class: "lead", text: "退役した隊員はまだいません。" }),
      ]),
    ];

    renderScreen(container, {
      eyebrow: "GALLERY",
      title: "ギャラリー",
      subtitle: "倉庫の糖衣と、退役した隊員を鑑賞できます。",
      body,
      actions: [button("戻る", { variant: "ghost", onClick: () => api.closeScene() })],
    });
  }

  render();
  return {};
}

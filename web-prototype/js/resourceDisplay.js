// 個別表示 (part of the character/resource-card family alongside
// characterCard.js): renders describeResourcesIndividually()'s output
// as a natural-資源-section-then-剛体-資源-section list, each entry's
// name/abbr colored per RESOURCE_COLOR_CLASS where one is mapped. A
// section with nothing held is omitted entirely, header included.
import { h } from "./dom.js";
import { describeResourcesIndividually, RESOURCE_COLOR_CLASS } from "./data/resourceCatalog.js";

function resourceEntryNode(entry) {
  const colorClass = RESOURCE_COLOR_CLASS[entry.speciesId];
  return h("p", { class: "resource-line" }, [h("span", { class: colorClass, text: entry.label }), entry.detail]);
}

export function resourceIndividualNodes(resources) {
  const { natural, rigid } = describeResourcesIndividually(resources);
  const nodes = [];
  if (natural.length) {
    nodes.push(h("p", { class: "field-label", text: "自然資源：" }));
    nodes.push(...natural.map(resourceEntryNode));
  }
  if (rigid.length) {
    nodes.push(h("p", { class: "field-label", text: "剛体資源：" }));
    nodes.push(...rigid.map(resourceEntryNode));
  }
  return nodes;
}

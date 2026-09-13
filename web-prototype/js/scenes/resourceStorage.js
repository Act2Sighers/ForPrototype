import { renderScreen, button, h } from "../dom.js";
import state from "../state.js";
import {
  describeResourcesIndividually,
  NATURAL_RESOURCES,
  RIGID_RESOURCES,
  RESOURCE_DESCRIPTIONS,
  resourcesMinusFrameReservation,
  amberTopGroups,
  pickBestModuleUnit,
  pickAmberModuleInstance,
} from "../data/resourceCatalog.js";

function speciesName(speciesId) {
  return (NATURAL_RESOURCES[speciesId] ?? RIGID_RESOURCES[speciesId]).name;
}

// 資源置き場画面. Two modes:
//  - "normal" (default): every species the player currently holds gets
//    one row (species with nothing held are omitted, same as 個別表示
//    elsewhere); "内訳表示" reveals its flavor text plus its
//    per-quality/型番 breakdown. Callable directly from map.js/
//    trade.js, or reached via a sibling-swap from squadFormation.js/
//    weaponStorage.js's own "資源" buttons -- see their {openNext}
//    convention (this screen's own "部隊編成"/"武器" buttons do the
//    same swap back out). "閉じる" returns to whoever actually called
//    this screen.
//  - "moduleSelect": called from weaponForge.js when the player clicks
//    the モジュール box, with params.frameReservation set to that
//    screen's already-committed フレーム pick. Shows only 剛体資源 (no
//    natural section), with the frame's own reservation subtracted out
//    first (resourcesMinusFrameReservation) so a species can't be
//    offered here at a quantity that would double-book units already
//    earmarked as フレーム. "選択" resolves the single highest-quality
//    unit of that species and returns it to weaponForge.js; 琥珀糖鉱石
//    shows "型番を選ぶ" instead whenever more than one 型番 is tied for
//    the top quality (see amberTopGroups), letting the player pick
//    which one. "製造画面に戻る" returns without picking anything.
export function ResourceStorageScene(container, params, api) {
  const mode = params.mode === "moduleSelect" ? "moduleSelect" : "normal";
  const frameReservation = mode === "moduleSelect" ? params.frameReservation : null;

  const expandedIds = new Set();
  const expandedModelPickerIds = new Set();
  let adjustedResources = null;

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

  function selectModule(speciesId) {
    api.closeScene(pickBestModuleUnit(adjustedResources, speciesId));
  }

  function toggleModelPicker(speciesId) {
    if (expandedModelPickerIds.has(speciesId)) expandedModelPickerIds.delete(speciesId);
    else expandedModelPickerIds.add(speciesId);
    render();
  }

  function selectAmberModel(modelNumber) {
    const instance = adjustedResources.rigid.amberSugarMineral.find((i) => i.modelNumber === modelNumber);
    api.closeScene(pickAmberModuleInstance(adjustedResources, instance.id));
  }

  function moduleRow(entry) {
    const speciesId = entry.speciesId;
    if (speciesId === "amberSugarMineral") {
      const tops = amberTopGroups(adjustedResources.rigid.amberSugarMineral);
      if (tops.length > 1) {
        const isExpanded = expandedModelPickerIds.has(speciesId);
        const children = [
          h("div", { class: "slot__meta" }, [h("span", { class: "slot__name", text: speciesName(speciesId) })]),
          h("div", { class: "slot__actions" }, [
            button(isExpanded ? "型番を隠す" : "型番を選ぶ", { variant: "ghost", onClick: () => toggleModelPicker(speciesId) }),
          ]),
        ];
        if (isExpanded) {
          children.push(
            h(
              "div",
              { class: "chip-row" },
              tops.map((group) => button(group.modelNumber, { variant: "frost", onClick: () => selectAmberModel(group.modelNumber) }))
            )
          );
        }
        return h("div", { class: "panel" }, children);
      }
      return h("div", { class: "slot" }, [
        h("div", { class: "slot__meta" }, [h("span", { class: "slot__name", text: speciesName(speciesId) })]),
        h("div", { class: "slot__actions" }, [button("選択", { variant: "primary", onClick: () => selectAmberModel(tops[0].modelNumber) })]),
      ]);
    }
    return h("div", { class: "slot" }, [
      h("div", { class: "slot__meta" }, [h("span", { class: "slot__name", text: speciesName(speciesId) })]),
      h("div", { class: "slot__actions" }, [button("選択", { variant: "primary", onClick: () => selectModule(speciesId) })]),
    ]);
  }

  function renderModuleSelect() {
    adjustedResources = resourcesMinusFrameReservation(state.run?.resources, frameReservation);
    const { rigid } = describeResourcesIndividually(adjustedResources);
    renderScreen(container, {
      eyebrow: "RESOURCE STORAGE / MODULE",
      title: "資源置き場（モジュール選択）",
      subtitle: "モジュールとして用いる剛体資源を選んでください。",
      body: [
        rigid.length
          ? h("div", { class: "slot-list slot-list--grid" }, rigid.map(moduleRow))
          : h("p", { class: "lead", text: "選択できる剛体資源がありません。" }),
      ],
      actions: [button("製造画面に戻る", { variant: "ghost", onClick: () => api.closeScene() })],
    });
  }

  function render() {
    if (mode === "moduleSelect") {
      renderModuleSelect();
      return;
    }

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

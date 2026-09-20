import { renderScreen, button, h } from "../dom.js";
import state from "../state.js";
import {
  describeResourcesIndividually,
  NATURAL_RESOURCES,
  RIGID_RESOURCES,
  RESOURCE_DESCRIPTIONS,
  TIME_EATS_TARGET_LABELS,
  resourcesMinusFrameReservation,
  amberTopGroups,
  pickBestModuleUnit,
  pickAmberModuleInstance,
  pickLowestQualityNatural,
  pickLowestQualityFrame,
  COATING_PATTERN_MATERIALS,
  COATING_FLAVOR_MATERIALS,
} from "../data/resourceCatalog.js";

function speciesName(speciesId) {
  return (NATURAL_RESOURCES[speciesId] ?? RIGID_RESOURCES[speciesId]).name;
}

// 荷物置き場画面（旧・資源置き場画面）. Two modes:
//  - "normal" (default): 時間食（軽食画面で購入した消耗品）と、プレイヤー
//    が現在持っている資源の一覧を表示する。時間食は常に対象人数/HP回復
//    量/変換効率が見え、「配給する」は対象人数に応じて部隊編成画面の
//    配給／全員配給モードを呼び出す（squadFormation.js参照）。資源側は
//    種ごとに1行（何も持っていない種は個別表示
//    と同じく省く）、「内訳表示」でフレーバーテキストと品質/型番ごとの
//    内訳を表示する。map.js/trade.jsから直接呼ばれるほか、
//    squadFormation.js/weaponStorage.jsの「荷物」ボタンからのきょうだい
//    間スワップでも呼ばれる -- それらの{openNext}の流儀参照（この画面
//    自身の「部隊編成」「武器」ボタンも同じ形でスワップし返す）。
//    「閉じる」は実際にこの画面を呼び出した側へ戻る。
//  - "moduleSelect": called from weaponForge.js when the player clicks
//    the モジュール box, with params.frameReservation set to that
//    screen's already-committed フレーム pick. Shows only 剛体資源 (no
//    natural section, no 時間食 section), with the frame's own
//    reservation subtracted out first (resourcesMinusFrameReservation)
//    so a species can't be offered here at a quantity that would
//    double-book units already earmarked as フレーム. "選択" resolves
//    the single highest-quality unit of that species and returns it to
//    weaponForge.js; 琥珀糖鉱石 shows "型番を選ぶ" instead whenever more
//    than one 型番 is tied for the top quality (see amberTopGroups),
//    letting the player pick which one. "製造画面に戻る" returns
//    without picking anything.
export function ResourceStorageScene(container, params, api) {
  const mode = ["moduleSelect", "patternSelect", "flavorSelect"].includes(params.mode) ? params.mode : "normal";
  const frameReservation = mode === "moduleSelect" ? params.frameReservation : null;

  const expandedIds = new Set();
  const expandedModelPickerIds = new Set();
  let adjustedResources = null;

  function toggle(id) {
    if (expandedIds.has(id)) expandedIds.delete(id);
    else expandedIds.add(id);
    render();
  }

  // 時間食1品ごとの表示行。所持数量、対象人数/HP回復量/変換効率は常に
  // 見える。「配給する」は対象人数が1人なら部隊編成画面（配給モード）、
  // 全員なら（全員配給モード）を呼び出す。呼び出し元へ戻ってくると
  // onResumeがrender()し直すので、消費/完売後のスタックの増減がここに
  // 反映される。
  function timeEatsRow(item) {
    return h("div", { class: "panel" }, [
      h("div", { class: "slot__meta" }, [
        h("span", { class: "slot__name", text: item.name }),
        h("span", { class: "tag", text: `所持数 ${item.qty}` }),
      ]),
      h("p", {
        class: "lead",
        text: `対象：${TIME_EATS_TARGET_LABELS[item.target]}／HP回復量：${item.hpRecoveryPercent}%／変換効率：${item.conversionEfficiency}%`,
      }),
      h("div", { class: "slot__actions" }, [
        button("配給する", {
          variant: "primary",
          disabled: item.qty <= 0,
          onClick: () =>
            api.callScene("squadFormation", {
              mode: item.target === "all" ? "feedAll" : "feed",
              timeEatsItem: item,
            }),
        }),
      ]),
    ]);
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
      eyebrow: "BAGGAGE STORAGE / MODULE",
      title: "荷物置き場（モジュール選択）",
      subtitle: "モジュールとして用いる剛体資源を選んでください。",
      body: [
        rigid.length
          ? h("div", { class: "slot-list slot-list--grid" }, rigid.map(moduleRow))
          : h("p", { class: "lead", text: "選択できる剛体資源がありません。" }),
      ],
      actions: [button("製造画面に戻る", { variant: "ghost", onClick: () => api.closeScene() })],
    });
  }

  // 仕立画面の原料１（パターン）／原料２（フレーバー）向け。どちらも
  // 除外は不要（自然資源/剛体資源はプールが完全に別なので、片方の
  // 予約がもう片方の候補を減らすことは無い -- 鍛冶画面のフレーム/
  // モジュールと違い、同じ資源プールを取り合わない）。「選択」は
  // そのレシピが要求する必要数を、最も品質の低いものから優先して
  // 予約し、そのまま呼び出し元（仕立画面）へ返す。
  function materialSelectRow(entry, onSelect) {
    return h("div", { class: "slot" }, [
      h("div", { class: "slot__meta" }, [
        h("span", { class: "slot__name", text: speciesName(entry.speciesId) }),
        h("span", { class: "tag", text: entry.detail }),
      ]),
      h("div", { class: "slot__actions" }, [button("選択", { variant: "primary", onClick: () => onSelect(entry.speciesId) })]),
    ]);
  }

  function selectPattern(speciesId) {
    const { quantity } = COATING_PATTERN_MATERIALS[speciesId];
    api.closeScene(pickLowestQualityNatural(state.run?.resources, speciesId, quantity));
  }

  function selectFlavor(speciesId) {
    const { quantity } = COATING_FLAVOR_MATERIALS[speciesId];
    api.closeScene(pickLowestQualityFrame(state.run?.resources, speciesId, quantity));
  }

  function renderPatternSelect() {
    const { natural } = describeResourcesIndividually(state.run?.resources);
    const rows = natural.filter((entry) => entry.speciesId !== "baseCream");
    renderScreen(container, {
      eyebrow: "BAGGAGE STORAGE / PATTERN",
      title: "荷物置き場（パターン選択）",
      subtitle: "パターンとして用いる自然資源を選んでください。",
      body: [
        rows.length
          ? h("div", { class: "slot-list slot-list--grid" }, rows.map((entry) => materialSelectRow(entry, selectPattern)))
          : h("p", { class: "lead", text: "選択できる自然資源がありません。" }),
      ],
      actions: [button("作成画面に戻る", { variant: "ghost", onClick: () => api.closeScene() })],
    });
  }

  function renderFlavorSelect() {
    const { rigid } = describeResourcesIndividually(state.run?.resources);
    const rows = rigid.filter((entry) => entry.speciesId !== "coarseSugarMineral");
    renderScreen(container, {
      eyebrow: "BAGGAGE STORAGE / FLAVOR",
      title: "荷物置き場（フレーバー選択）",
      subtitle: "フレーバーとして用いる剛体資源を選んでください。",
      body: [
        rows.length
          ? h("div", { class: "slot-list slot-list--grid" }, rows.map((entry) => materialSelectRow(entry, selectFlavor)))
          : h("p", { class: "lead", text: "選択できる剛体資源がありません。" }),
      ],
      actions: [button("作成画面に戻る", { variant: "ghost", onClick: () => api.closeScene() })],
    });
  }

  function render() {
    if (mode === "moduleSelect") {
      renderModuleSelect();
      return;
    }
    if (mode === "patternSelect") {
      renderPatternSelect();
      return;
    }
    if (mode === "flavorSelect") {
      renderFlavorSelect();
      return;
    }

    const { natural, rigid } = describeResourcesIndividually(state.run?.resources);
    const timeEatsInventory = state.run?.timeEatsInventory ?? [];
    const body = [
      h("div", { class: "field-group" }, [
        h("p", { class: "field-label", text: "時間食" }),
        timeEatsInventory.length
          ? h("div", { class: "slot-list slot-list--grid" }, timeEatsInventory.map(timeEatsRow))
          : h("p", { class: "lead", text: "所持している時間食はありません。" }),
      ]),
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
      eyebrow: "BAGGAGE STORAGE",
      title: "荷物置き場",
      subtitle: "所持している時間食・資源の一覧です。",
      body,
      onPause: () => api.callScene("pause"),
      actions: [
        button("マップ", { onClick: () => api.closeScene() }),
        button("部隊編成", { onClick: () => api.closeScene({ openNext: "squadFormation" }) }),
        button("武器", { onClick: () => api.closeScene({ openNext: "weaponStorage" }) }),
        button("糖衣", { onClick: () => api.closeScene({ openNext: "coatingStorage" }) }),
        button("荷物", { disabled: true }),
      ],
    });
  }

  render();
  return { onResume: () => render() };
}

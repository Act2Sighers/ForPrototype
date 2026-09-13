import { renderScreen, button, h } from "../dom.js";
import state, { equipStoredWeapon } from "../state.js";
import { describeWeapon, getWeaponDisplayName, canEquip, WEAPON_TYPES, SYNERGIES } from "../data/resourceCatalog.js";

function weaponSynergyNames(weapon) {
  return WEAPON_TYPES[weapon.baseTypeId].synergies.map((id) => SYNERGIES[id].name).join(" / ");
}

// 武器置き場画面. Two modes:
//  - "normal" (default): every 未装備武器 (state.storedWeapons), with a
//    詳細表示 toggle (性能値+武器評価+シナジー) per weapon. Callable
//    directly from map.js/trade.js, or reached via a sibling-swap from
//    squadFormation.js's own "武器" button -- see that file's
//    {openNext} convention (this screen's own "部隊編成"/"資源" buttons
//    do the same swap back out). "閉じる" returns to whoever actually
//    called this screen. Each weapon's "装備させる" calls
//    squadFormation in its own "swap" mode, passing this weapon along.
//  - "swap" (持ち替えモード): called from squadFormation.js's per-member
//    "武器変更" button, with params.character set. Shows only the
//    未装備武器 sharing a シナジー with that character (see
//    resourceCatalog.js's canEquip); 選択→confirm equips it (their
//    previous weapon, if any, comes back here) and returns to
//    squadFormation.
export function WeaponStorageScene(container, params, api) {
  const mode = params.mode === "swap" ? "swap" : "normal";
  const swapCharacter = mode === "swap" ? params.character : null;

  const expandedIds = new Set();
  let pendingWeaponId = null;

  function toggleDetail(id) {
    if (expandedIds.has(id)) expandedIds.delete(id);
    else expandedIds.add(id);
    render();
  }

  function normalRow(weapon) {
    const isExpanded = expandedIds.has(weapon.id);
    const children = [
      h("div", { class: "slot__meta" }, [h("span", { class: "slot__name", text: getWeaponDisplayName(weapon) })]),
      h("div", { class: "slot__actions" }, [
        button(isExpanded ? "詳細を隠す" : "詳細表示", { variant: "ghost", onClick: () => toggleDetail(weapon.id) }),
        button("装備させる", {
          variant: "primary",
          onClick: () => api.callScene("squadFormation", { mode: "swap", weapon }),
        }),
      ]),
    ];
    if (isExpanded) {
      children.push(h("p", { class: "lead", text: describeWeapon(weapon) }));
      children.push(h("p", { class: "lead", text: `シナジー：${weaponSynergyNames(weapon)}` }));
    }
    return h("div", { class: "panel" }, children);
  }

  function handleSelect(id) {
    pendingWeaponId = id;
    render();
  }

  function confirmEquip(weapon) {
    equipStoredWeapon(swapCharacter, weapon.id);
    api.closeScene();
  }

  function cancelPending() {
    pendingWeaponId = null;
    render();
  }

  function swapRow(weapon) {
    const isPending = pendingWeaponId === weapon.id;
    if (isPending) {
      return h("div", { class: "slot" }, [
        h("div", { class: "slot__meta" }, [h("span", { class: "slot__name", text: getWeaponDisplayName(weapon) })]),
        h("div", { class: "confirm-row" }, [
          h("span", {
            class: "confirm-row__text",
            text: `${swapCharacter.name}に${getWeaponDisplayName(weapon)}を装備させます。よろしいですか？`,
          }),
          button("実行する", { variant: "primary", onClick: () => confirmEquip(weapon) }),
          button("キャンセル", { variant: "ghost", onClick: cancelPending }),
        ]),
      ]);
    }
    return h("div", { class: "slot" }, [
      h("div", { class: "slot__meta" }, [h("span", { class: "slot__name", text: getWeaponDisplayName(weapon) })]),
      h("div", { class: "slot__actions" }, [button("選択", { variant: "primary", onClick: () => handleSelect(weapon.id) })]),
    ]);
  }

  function renderSwap() {
    const candidates = state.storedWeapons.filter((weapon) => canEquip(swapCharacter, weapon));
    renderScreen(container, {
      eyebrow: "WEAPON STORAGE / SWAP",
      title: "武器置き場（持ち替え）",
      subtitle: "装備する武器を選んでください。",
      body: [
        candidates.length
          ? h("div", { class: "slot-list slot-list--grid" }, candidates.map(swapRow))
          : h("p", { class: "lead", text: "共通のシナジーを持つ未装備武器がありません。" }),
      ],
      actions: [button("キャンセル", { variant: "ghost", onClick: () => api.closeScene() })],
    });
  }

  function render() {
    if (mode === "swap") {
      renderSwap();
      return;
    }
    renderScreen(container, {
      eyebrow: "WEAPON STORAGE",
      title: "武器置き場",
      subtitle: "使用していない武器の一覧です。",
      body: [
        state.storedWeapons.length
          ? h("div", { class: "slot-list slot-list--grid" }, state.storedWeapons.map(normalRow))
          : h("p", { class: "lead", text: "使用していない武器はありません。" }),
      ],
      actions: [
        button("ポーズ", { variant: "ghost", onClick: () => api.callScene("pause") }),
        button("閉じる", { variant: "ghost", onClick: () => api.closeScene() }),
        button("部隊編成", { onClick: () => api.closeScene({ openNext: "squadFormation" }) }),
        button("資源", { onClick: () => api.closeScene({ openNext: "resourceStorage" }) }),
      ],
    });
  }

  render();
  return { onResume: () => render() };
}

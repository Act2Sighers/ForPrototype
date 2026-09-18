import { renderScreen, button, h } from "../dom.js";
import state, { equipStoredWeapon, sellStoredWeapons } from "../state.js";
import {
  describeWeapon,
  getWeaponDisplayName,
  canEquip,
  WEAPON_TYPES,
  SYNERGIES,
  RIGID_RESOURCES,
  computeWeaponMarketPrice,
} from "../data/resourceCatalog.js";

const COST_ABBR = RIGID_RESOURCES.coarseSugarMineral.abbr;

function weaponSynergyNames(weapon) {
  return WEAPON_TYPES[weapon.baseTypeId].synergies.map((id) => SYNERGIES[id].name).join(" / ");
}

// 隊員名は「ファーストネーム・ラストネーム」形式 (見た目上「・」区切り)
// なので、その前半だけを取り出す。
function firstName(fullName) {
  return fullName.split("・")[0];
}

// Every weapon the player owns, stored or currently equipped -- unlike
// "normal" mode (未装備武器 only), 強化選択 needs the whole armory since
// any owned weapon can be enhanced regardless of who's holding it.
function allOwnedWeaponEntries() {
  const entries = state.storedWeapons.map((weapon) => ({ weapon, ownerName: null }));
  for (const character of [...state.formationSlots, ...state.standbySlots]) {
    if (character.weapon) entries.push({ weapon: character.weapon, ownerName: character.name });
  }
  return entries;
}

// 武器置き場画面. Three modes:
//  - "normal" (default): every 未装備武器 (state.storedWeapons), with a
//    詳細表示 toggle (性能値+武器評価+シナジー) per weapon. Callable
//    directly from map.js/trade.js, or reached via a sibling-swap from
//    squadFormation.js's own "武器" button -- see that file's
//    {openNext} convention (this screen's own "部隊編成"/"荷物" buttons
//    do the same swap back out). "閉じる" returns to whoever actually
//    called this screen. Each weapon's "装備させる" calls
//    squadFormation in its own "swap" mode, passing this weapon along.
//  - "swap" (持ち替えモード): called from squadFormation.js's per-member
//    "武器変更" button, with params.character set. Shows only the
//    未装備武器 sharing a シナジー with that character (see
//    resourceCatalog.js's canEquip); 選択→confirm equips it (their
//    previous weapon, if any, comes back here) and returns to
//    squadFormation.
//  - "enhance" (強化選択): called from weaponEnhance.js when the player
//    clicks its 武器 box. Shows every weapon the player owns --
//    未装備武器 AND whatever's currently equipped, each labeled
//    "（<ファーストネーム>が装備）" when it belongs to someone -- since
//    enhancement doesn't care who's holding the weapon. "選択" returns
//    the weapon straight to weaponEnhance.js; "強化画面に戻る" returns
//    without picking.
//  - "sell" (売却モード): called from weaponTrade.js's own "売却"
//    button. Every 未装備武器 gets a 選択/外す toggle (highlighting its
//    whole row while selected) instead of a single-pick "選択" --
//    multi-select is the default gesture here, confirmed in one batch
//    via "まとめて売る" (shows the running ザラメ鉱石 total once
//    anything's selected). state.js's sellStoredWeapons applies exactly
//    that batch. "取引画面に戻る" returns with nothing further to
//    relay -- unlike swap/enhance, selling mutates real state directly
//    rather than handing a pick back to the caller.
export function WeaponStorageScene(container, params, api) {
  const mode =
    params.mode === "swap" ? "swap" : params.mode === "enhance" ? "enhance" : params.mode === "sell" ? "sell" : "normal";
  const swapCharacter = mode === "swap" ? params.character : null;

  const expandedIds = new Set();
  const selectedIds = new Set();
  let pendingWeaponId = null;
  let pendingSell = false;

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

  function enhanceSelectRow(entry) {
    const label = getWeaponDisplayName(entry.weapon) + (entry.ownerName ? `（${firstName(entry.ownerName)}が装備）` : "");
    return h("div", { class: "slot" }, [
      h("div", { class: "slot__meta" }, [h("span", { class: "slot__name", text: label })]),
      h("div", { class: "slot__actions" }, [button("選択", { variant: "primary", onClick: () => api.closeScene(entry.weapon) })]),
    ]);
  }

  function renderEnhanceSelect() {
    const entries = allOwnedWeaponEntries();
    renderScreen(container, {
      eyebrow: "WEAPON STORAGE / ENHANCE",
      title: "武器置き場（強化選択）",
      subtitle: "強化する武器を選んでください。",
      body: [
        entries.length
          ? h("div", { class: "slot-list slot-list--grid" }, entries.map(enhanceSelectRow))
          : h("p", { class: "lead", text: "所持している武器がありません。" }),
      ],
      actions: [button("強化画面に戻る", { variant: "ghost", onClick: () => api.closeScene() })],
    });
  }

  function toggleSelect(id) {
    if (selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
    render();
  }

  function confirmSell() {
    sellStoredWeapons([...selectedIds]);
    selectedIds.clear();
    pendingSell = false;
    render();
  }

  function sellRow(weapon) {
    const isSelected = selectedIds.has(weapon.id);
    const isExpanded = expandedIds.has(weapon.id);
    const children = [
      h("div", { class: "slot__meta" }, [h("span", { class: "slot__name", text: getWeaponDisplayName(weapon) })]),
      h("div", { class: "slot__actions" }, [
        button(isExpanded ? "詳細を隠す" : "詳細表示", { variant: "ghost", onClick: () => toggleDetail(weapon.id) }),
        button(isSelected ? "外す" : "選択", {
          variant: isSelected ? "frost" : "ghost",
          disabled: pendingSell,
          onClick: () => toggleSelect(weapon.id),
        }),
      ]),
    ];
    if (isExpanded) {
      children.push(h("p", { class: "lead", text: describeWeapon(weapon) }));
      children.push(h("p", { class: "lead", text: `シナジー：${weaponSynergyNames(weapon)}` }));
    }
    return h("div", { class: `panel${isSelected ? " panel--selected" : ""}` }, children);
  }

  function renderSell() {
    const selectedTotal = state.storedWeapons
      .filter((weapon) => selectedIds.has(weapon.id))
      .reduce((sum, weapon) => sum + computeWeaponMarketPrice(weapon), 0);

    const body = [h("p", { class: "lead", text: "売却したい武器を1つ以上選択し、「まとめて売る」で一括売却を行います。" })];
    if (selectedIds.size > 0) {
      body.push(h("p", { class: "lead", text: `売値総額：${COST_ABBR}×${selectedTotal}` }));
    }
    body.push(
      state.storedWeapons.length
        ? h("div", { class: "slot-list slot-list--grid" }, state.storedWeapons.map(sellRow))
        : h("p", { class: "lead", text: "使用していない武器はありません。" })
    );
    // 確認は「まとめて売る」ボタンの近く（武器一覧の下）に置く。
    if (pendingSell) {
      body.push(
        h("div", { class: "confirm-row" }, [
          h("span", {
            class: "confirm-row__text",
            text: `選択した${selectedIds.size}個の武器を売却します（獲得：${COST_ABBR}×${selectedTotal}）。よろしいですか？`,
          }),
          button("実行する", { variant: "primary", onClick: confirmSell }),
          button("キャンセル", { variant: "ghost", onClick: () => { pendingSell = false; render(); } }),
        ])
      );
    }

    renderScreen(container, {
      eyebrow: "WEAPON STORAGE / SELL",
      title: "武器置き場（売却）",
      body,
      actions: [
        button("取引画面に戻る", { variant: "ghost", onClick: () => api.closeScene() }),
        button(selectedIds.size ? `まとめて売る（${selectedIds.size}）` : "まとめて売る", {
          variant: "primary",
          disabled: selectedIds.size === 0 || pendingSell,
          onClick: () => { pendingSell = true; render(); },
        }),
      ],
    });
  }

  function render() {
    if (mode === "swap") {
      renderSwap();
      return;
    }
    if (mode === "enhance") {
      renderEnhanceSelect();
      return;
    }
    if (mode === "sell") {
      renderSell();
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
        button("糖衣", { onClick: () => api.closeScene({ openNext: "coatingStorage" }) }),
        button("荷物", { onClick: () => api.closeScene({ openNext: "resourceStorage" }) }),
      ],
    });
  }

  render();
  return { onResume: () => render() };
}

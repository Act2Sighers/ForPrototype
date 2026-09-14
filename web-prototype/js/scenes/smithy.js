import { renderScreen, button, h } from "../dom.js";
import state from "../state.js";
import { SYNERGIES, WEAPON_TYPES, hasEnoughFrame } from "../data/resourceCatalog.js";

// 鍛冶画面. Only ever opened from trade.js's own お店 chip row (mid-run,
// same as warehouse.js), so it omits ポーズ the same way that screen
// does -- trade.js already has one a level up. One row per シナジー;
// "鋳型一覧" expands to that シナジー's weapon types (derived straight
// from WEAPON_TYPES' own synergies field, in its natural key order --
// this happens to already match the user's own listed order for every
// シナジー, so no separate ordering table is needed). A weapon type's
// button is disabled whenever the player doesn't hold enough of its
// フレーム species in aggregate (hasEnoughFrame) -- ベースクリーム
// isn't checked here at all, only on 武器製造画面's own "製造開始！".
//
// weaponTradeCandidates is threaded through exactly like trade.js's own
// hiringCandidates: trade.js passes its remembered value in as
// params.weaponTradeCandidates, this scene hands it to weaponTrade.js
// as params.candidates and remembers whatever comes back in onResume,
// and relays its current value back up to trade.js (tagged, so
// trade.js's own onResume can tell it apart from a plain hiring-
// candidates array or an {openNext} sibling-swap payload) when this
// screen itself closes via "店を出る" -- so the weapon shop's stock and
// purchases survive re-entering 鍛冶屋 for the whole 取引イベント.
export function SmithyScene(container, params, api) {
  const expandedSynergyIds = new Set();
  let weaponTradeCandidates = params.weaponTradeCandidates ?? null;

  function toggle(id) {
    if (expandedSynergyIds.has(id)) expandedSynergyIds.delete(id);
    else expandedSynergyIds.add(id);
    render();
  }

  function weaponButtonsFor(synergyId) {
    return Object.entries(WEAPON_TYPES)
      .filter(([, data]) => data.synergies.includes(synergyId))
      .map(([weaponTypeId, data]) =>
        button(data.name, {
          variant: "frost",
          disabled: !hasEnoughFrame(state.run?.resources, weaponTypeId),
          onClick: () => api.callScene("weaponForge", { weaponTypeId }),
        })
      );
  }

  function synergyRow(synergyId) {
    const isExpanded = expandedSynergyIds.has(synergyId);
    const synergy = SYNERGIES[synergyId];
    const children = [
      h("div", { class: "slot__meta" }, [h("span", { class: "slot__name", text: `${synergy.name}（${synergy.shortStyle}）` })]),
      h("div", { class: "slot__actions" }, [
        button(isExpanded ? "鋳型一覧を隠す" : "鋳型一覧", { variant: "ghost", onClick: () => toggle(synergyId) }),
      ]),
    ];
    if (isExpanded) {
      children.push(h("div", { class: "chip-row" }, weaponButtonsFor(synergyId)));
    }
    return h("div", { class: "panel" }, children);
  }

  function render() {
    renderScreen(container, {
      eyebrow: "SMITHY",
      title: "鍛冶",
      subtitle: "製造したい武器種を選んでください。",
      body: [h("div", { class: "slot-list slot-list--grid" }, Object.keys(SYNERGIES).map(synergyRow))],
      actions: [
        button("店を出る", { variant: "ghost", onClick: () => api.closeScene({ weaponTradeCandidates }) }),
        button("強化", { onClick: () => api.callScene("weaponEnhance") }),
        button("取引", { onClick: () => api.callScene("weaponTrade", { candidates: weaponTradeCandidates }) }),
      ],
    });
  }

  render();
  return {
    onResume: (result) => {
      if (Array.isArray(result)) weaponTradeCandidates = result;
      render();
    },
  };
}

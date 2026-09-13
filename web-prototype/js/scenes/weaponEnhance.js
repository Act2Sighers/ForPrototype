import { renderScreen, button, h } from "../dom.js";
import state, { enhanceWeaponStat } from "../state.js";
import {
  WEAPON_STAT_LABELS,
  CHARACTER_STAT_BY_WEAPON_STAT,
  NATURAL_SPECIES_BY_WEAPON_STAT,
  NATURAL_RESOURCES,
  weaponStatRankLabel,
  computeWeaponRating,
  canEnhanceWeaponStat,
  enhanceBaseCreamCost,
  getWeaponDisplayName,
} from "../data/resourceCatalog.js";

const STAT_KEYS = Object.keys(WEAPON_STAT_LABELS);

// A 性能値's 5-level gauge: dots 0..value (inclusive) and the lines
// directly between them are colored to match that 性能値's own
// stat-* color; everything past that stays a plain neutral gray.
function dotGauge(value, colorClass) {
  const children = [];
  for (let i = 0; i < 5; i++) {
    if (i > 0) children.push(h("span", { class: `enhance-line${i <= value ? ` ${colorClass}` : ""}` }));
    children.push(h("span", { class: `enhance-dot${i <= value ? ` ${colorClass}` : ""}` }));
  }
  return h("div", { class: "enhance-gauge" }, children);
}

// 武器強化画面. Called from smithy.js's own "強化" button. Clicking the
// 武器 box calls weaponStorage.js in its own "enhance" mode (showing
// every weapon the player owns, equipped or not) to pick which weapon
// to work on; once one's picked, 強化状況詳細 shows all 5 性能値 with a
// per-stat "強化" button (state.js's enhanceWeaponStat applies exactly
// the plan resourceCatalog.js's resolveEnhancePlan already resolved --
// the same function this screen calls to decide each button's disabled
// state, so there's nothing left to double-check when a click lands).
// "もどる" just returns to 鍛冶画面 -- every enhancement takes effect
// immediately, so there's no pending state to discard.
export function WeaponEnhanceScene(container, params, api) {
  let weapon = null;

  function openWeaponSelect() {
    api.callScene("weaponStorage", { mode: "enhance" });
  }

  function handleEnhance(statKey) {
    enhanceWeaponStat(weapon, statKey);
    render();
  }

  function statRow(statKey) {
    const charKey = CHARACTER_STAT_BY_WEAPON_STAT[statKey];
    const colorClass = `stat-${charKey}`;
    const value = weapon.stats[statKey];
    const speciesId = NATURAL_SPECIES_BY_WEAPON_STAT[statKey];
    const bucket = state.run.resources.natural[speciesId];

    return h("div", { class: "field-group" }, [
      h("p", {}, [
        h("span", { class: colorClass, text: `${WEAPON_STAT_LABELS[statKey]}: ${weaponStatRankLabel(value)}(${value})` }),
        h("span", {
          class: "enhance-detail-sub",
          text: ` ／ ${NATURAL_RESOURCES[speciesId].name}［中: ${bucket.mid}個 / 上: ${bucket.high}個 / 特上: ${bucket.premium}個］`,
        }),
      ]),
      h("div", { class: "row-between" }, [
        dotGauge(value, colorClass),
        button("強化", {
          variant: `stat-${charKey}`,
          disabled: !canEnhanceWeaponStat(state.run.resources, weapon, statKey),
          onClick: () => handleEnhance(statKey),
        }),
      ]),
    ]);
  }

  function render() {
    const weaponBox = h(
      "div",
      { class: "panel forge-box forge-box--clickable", onClick: openWeaponSelect },
      [h("p", { class: "field-label", text: "武器" }), h("p", { class: "lead", text: weapon ? getWeaponDisplayName(weapon) : "（未選択）" })]
    );

    const detailChildren = [h("p", { class: "field-label", text: "強化状況詳細" })];
    if (weapon) {
      const rating = computeWeaponRating(weapon.stats);
      detailChildren.push(
        h("p", { class: "lead", text: `現在の武器評価: ${rating} （強化のたびにベースクリームを ${enhanceBaseCreamCost(weapon)} 消費）` })
      );
      for (const statKey of STAT_KEYS) detailChildren.push(statRow(statKey));
    } else {
      detailChildren.push(h("p", { class: "lead", text: "（武器を選択してください）" }));
    }
    const detailBox = h("div", { class: `panel forge-box${weapon ? "" : " forge-box--disabled"}` }, detailChildren);

    renderScreen(container, {
      eyebrow: "SMITHY / ENHANCE",
      title: "武器強化",
      body: [
        h("p", { class: "lead", text: "強化する武器を選択してください。" }),
        h("p", { class: "lead", text: "強化を行うたびに、現在の武器評価に応じて一定量のベースクリームを消費します。" }),
        h("p", { class: "lead", text: "（C以下→1、B→3、A→10、S→30）" }),
        h("div", { class: "enhance-layout" }, [weaponBox, detailBox]),
      ],
      actions: [button("もどる", { variant: "ghost", onClick: () => api.closeScene() })],
    });
  }

  render();
  return {
    onResume: (result) => {
      if (result) weapon = result;
      render();
    },
  };
}

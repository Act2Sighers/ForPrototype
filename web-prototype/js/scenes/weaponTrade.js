import { renderScreen, button, h, resourceHud } from "../dom.js";
import state, { canAffordCost, purchaseWeapon } from "../state.js";
import { DUNGEON_PARAMS } from "../data/testDungeon.js";
import {
  RIGID_RESOURCES,
  WEAPON_TYPES,
  SYNERGIES,
  computeWeaponRating,
  describeWeapon,
  getWeaponDisplayName,
  createWeaponTradeCandidate,
  pickRandomWeaponTypeIds,
} from "../data/resourceCatalog.js";
import { describeWeaponSkill } from "./battle.js";

const COST_ABBR = RIGID_RESOURCES.coarseSugarMineral.abbr;
const CANDIDATE_COUNT = 5;
const PEDDLER_CANDIDATE_COUNT = 2;
const PEDDLER_COST_MULTIPLIER = 0.5;

// 武器取引の候補生成に渡すラン進捗率(m/X)。武器取引に「初期」モードは
// 存在しないので、通常/行商どちらでも常に渡す。
function currentProgress() {
  return {
    currentNodeCount: state.run.visitedNodeIds.length,
    longestReachableNodeCount: DUNGEON_PARAMS[state.run.dungeon.id].longestReachableNodeCount,
  };
}

function generateCandidates(mode) {
  const count = mode === "peddler" ? PEDDLER_CANDIDATE_COUNT : CANDIDATE_COUNT;
  const options = { progress: currentProgress(), ...(mode === "peddler" ? { costMultiplier: PEDDLER_COST_MULTIPLIER } : {}) };
  return pickRandomWeaponTypeIds(count).map((id) => createWeaponTradeCandidate(id, options));
}

function weaponSynergyNames(weapon) {
  return WEAPON_TYPES[weapon.baseTypeId].synergies.map((id) => SYNERGIES[id].name).join(" / ");
}

// 武器取引画面. Two modes:
//  - "normal" (default): called from smithy.js's own "取引" button,
//    which keeps the candidate list (and each one's purchased flag)
//    alive across re-entries for the whole 取引イベント -- see
//    smithy.js/trade.js's own weaponTradeCandidates threading, mirroring
//    exactly how trade.js already does this for 雇用画面's own
//    candidates. 5 candidates, full price. "売却" calls
//    weaponStorage.js's own "sell" mode.
//  - "peddler": 行商の荷馬車「武器」から。抽選方法・価格計算式は通常
//    モードと同じだが、候補は2枠だけ、価格は半額（切り上げ）。行商は
//    正式な鍛冶屋ではないので売却は出さない。
// 価格はザラメ鉱石×(性能値合計)（computeWeaponMarketPrice）。性能値合計
// 自体がラン進捗率に応じて上昇する（computeWeaponTradeStatSum、
// currentProgress()参照）ので、価格式そのものは変えていない。
// "もどる" always hands the (possibly now-purchased) candidate list back
// to the caller.
export function WeaponTradeScene(container, params, api) {
  const mode = params.mode === "peddler" ? "peddler" : "normal";
  const candidates = params.candidates ?? generateCandidates(mode);

  const expandedIds = new Set();
  let pending = null; // { weaponId, kind: "confirm" | "insufficient-funds" }

  function handleBuyClick(candidate) {
    pending = { weaponId: candidate.weapon.id, kind: canAffordCost(candidate.price) ? "confirm" : "insufficient-funds" };
    render();
  }

  function confirmBuy(candidate) {
    purchaseWeapon(candidate.weapon, candidate.price);
    candidate.purchased = true;
    pending = null;
    render();
  }

  function dismissPending() {
    pending = null;
    render();
  }

  function pendingPanel(candidate) {
    if (pending.kind === "confirm") {
      return h("div", { class: "confirm-row" }, [
        h("span", {
          class: "confirm-row__text",
          text: `${getWeaponDisplayName(candidate.weapon)}を購入します（費用: ${COST_ABBR}×${candidate.price}）。よろしいですか？`,
        }),
        button("実行する", { variant: "primary", onClick: () => confirmBuy(candidate) }),
        button("キャンセル", { variant: "ghost", onClick: dismissPending }),
      ]);
    }
    return h("div", { class: "confirm-row" }, [
      h("span", { class: "confirm-row__text", text: `${COST_ABBR}が足りません。` }),
      button("OK", { variant: "ghost", onClick: dismissPending }),
    ]);
  }

  function candidateRow(candidate) {
    const isExpanded = expandedIds.has(candidate.weapon.id);
    const isPendingThis = pending?.weaponId === candidate.weapon.id;
    const rating = computeWeaponRating(candidate.weapon.stats);

    const children = [
      h("div", { class: "slot__meta" }, [
        h("span", { class: "slot__id", text: `武器評価${rating}` }),
        h("span", { class: "slot__name", text: getWeaponDisplayName(candidate.weapon) }),
        h("span", { class: "tag", text: `価格 ${COST_ABBR}×${candidate.price}` }),
        candidate.purchased ? h("span", { class: "tag tag--selected", text: "購入済み" }) : null,
      ]),
    ];

    if (isPendingThis) {
      children.push(pendingPanel(candidate));
    } else {
      children.push(
        h("div", { class: "slot__actions" }, [
          button(isExpanded ? "詳細を隠す" : "詳細表示", {
            variant: "ghost",
            onClick: () => {
              if (isExpanded) expandedIds.delete(candidate.weapon.id);
              else expandedIds.add(candidate.weapon.id);
              render();
            },
          }),
          button("購入", { variant: "primary", disabled: candidate.purchased, onClick: () => handleBuyClick(candidate) }),
        ])
      );
      if (isExpanded) {
        children.push(h("p", { class: "lead", text: describeWeapon(candidate.weapon) }));
        children.push(h("p", { class: "lead", text: `シナジー：${weaponSynergyNames(candidate.weapon)}` }));
        children.push(h("p", { class: "lead", text: `スキル：${describeWeaponSkill(candidate.weapon)}` }));
      }
    }

    return h("div", { class: "panel" }, children);
  }

  function render() {
    const actions = [button("もどる", { variant: "ghost", onClick: () => api.closeScene(candidates) })];
    if (mode === "normal") {
      actions.push(button("売却", { onClick: () => api.callScene("weaponStorage", { mode: "sell" }) }));
    }
    renderScreen(container, {
      eyebrow: mode === "peddler" ? "PEDDLER / WEAPON TRADE" : "WORKSHOP / SMITHY / TRADE",
      title: mode === "peddler" ? "武器取引（荷馬車）" : "武器取引",
      subtitle: "購入したい武器を選んでください。",
      corner: resourceHud(state.run?.resources),
      body: [h("div", { class: "slot-list slot-list--grid" }, candidates.map(candidateRow))],
      onPause: () => api.callScene("pause"),
      actions,
    });
  }

  render();
  return { onResume: () => render() };
}

import { renderScreen, button, h, resourceHud } from "../dom.js";
import { characterInfoCard } from "../characterCard.js";
import state, { canAffordCost, hasSquadRoom, hireCharacter } from "../state.js";
import {
  CHARACTER_DATA,
  INITIAL_EMPLOYMENT_DATA,
  RIGID_RESOURCES,
  computeWeaponRating,
  createCharacterFromData,
  createHiringCandidate,
  pickRandomEmploymentIds,
} from "../data/resourceCatalog.js";

const COST_ABBR = RIGID_RESOURCES.coarseSugarMineral.abbr;
const NORMAL_CANDIDATE_COUNT = 5;
const PEDDLER_CANDIDATE_COUNT = 2;
const PEDDLER_COST_MULTIPLIER = 0.5;

function generateCandidates(mode) {
  if (mode === "initial") {
    return Object.keys(INITIAL_EMPLOYMENT_DATA).map((id) => ({ ...createHiringCandidate(id, { flatCost: 1 }), hired: false }));
  }
  const count = mode === "peddler" ? PEDDLER_CANDIDATE_COUNT : NORMAL_CANDIDATE_COUNT;
  const options = mode === "peddler" ? { costMultiplier: PEDDLER_COST_MULTIPLIER } : undefined;
  return pickRandomEmploymentIds(count).map((id) => ({ ...createHiringCandidate(id, options), hired: false }));
}

// 雇用画面. Call-only, three modes:
//  - "initial": the very first squad-building pass, right after the
//    オープニング episode grants its starting budget (see map.js and
//    data/scripts.js's OPENING_SCRIPT). Every 初期雇用データ entry is a
//    candidate, cost is a flat 1 regardless of stats. Closing ("出発")
//    is gated on having hired at least one candidate into a non-empty
//    formation. No 除隊 button here — pairing it with a flat cost of 1
//    would let the player hire and immediately discharge someone as a
//    resource-laundering glitch.
//  - "normal": mid-run hiring from the trade screen's 雇用所. Candidates
//    are passed in via params.candidates (trade.js keeps them alive for
//    the whole trade visit, re-passing the same array — hired flags and
//    all — every time the player reopens 雇用所) rather than drawn fresh
//    here; see trade.js. Real cost via computeTradeValue. Closing ("店
//    を出る") is never gated, and 除隊 is available.
//  - "peddler": 行商の荷馬車「雇用」から。通常モードと同じ抽選方法/価格
//    計算式だが、候補は2枠だけ、価格は半額（切り上げ）。行商は正式な
//    雇用所ではないので除隊は出さない（通常モードと同じ除隊ガード
//    `mode === "normal"` がそのままpeddlerも除外する）。Closing
//    ("もどる") は通常モード同様ゲートしない。
export function HiringScene(container, params, api) {
  const mode = params.mode;
  if (mode !== "initial" && mode !== "normal" && mode !== "peddler") {
    throw new Error('hiring scene requires params.mode of "initial", "normal", or "peddler"');
  }

  const candidates = params.candidates ?? generateCandidates(mode);

  const expandedIds = new Set();
  let pending = null; // { employmentId, kind: "confirm" | "insufficient-funds" | "no-space" }

  function handleHireClick(candidate) {
    if (!canAffordCost(candidate.cost)) {
      pending = { employmentId: candidate.employmentId, kind: "insufficient-funds" };
    } else if (!hasSquadRoom()) {
      pending = { employmentId: candidate.employmentId, kind: "no-space" };
    } else {
      pending = { employmentId: candidate.employmentId, kind: "confirm" };
    }
    render();
  }

  function confirmHire(candidate) {
    const character = createCharacterFromData(candidate.characterDataId);
    character.weapon = candidate.weapon;
    hireCharacter(character, candidate.cost);
    candidate.hired = true;
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
          text: `${candidate.name}を雇用します（費用: ${COST_ABBR}×${candidate.cost}）。よろしいですか？`,
        }),
        button("実行する", { variant: "primary", onClick: () => confirmHire(candidate) }),
        button("キャンセル", { variant: "ghost", onClick: dismissPending }),
      ]);
    }
    const message =
      pending.kind === "insufficient-funds"
        ? `${COST_ABBR}が足りません。`
        : "編成・待機スロットに空きがありません。";
    return h("div", { class: "confirm-row" }, [
      h("span", { class: "confirm-row__text", text: message }),
      button("OK", { variant: "ghost", onClick: dismissPending }),
    ]);
  }

  function candidateRow(candidate) {
    const isExpanded = expandedIds.has(candidate.employmentId);
    const isPendingThis = pending?.employmentId === candidate.employmentId;
    const rating = computeWeaponRating(candidate.weapon.stats);

    const children = [
      h("div", { class: "slot__meta" }, [
        h("span", { class: "slot__id", text: `Lv.${candidate.level} / 武器評価${rating}` }),
        h("span", { class: "slot__name", text: candidate.name }),
        h("span", { class: "tag", text: `費用 ${COST_ABBR}×${candidate.cost}` }),
        candidate.hired ? h("span", { class: "tag tag--selected", text: "雇用済み" }) : null,
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
              if (isExpanded) expandedIds.delete(candidate.employmentId);
              else expandedIds.add(candidate.employmentId);
              render();
            },
          }),
          button("雇用", {
            variant: "primary",
            disabled: candidate.hired,
            onClick: () => handleHireClick(candidate),
          }),
        ])
      );
      if (isExpanded) {
        children.push(
          characterInfoCard({
            name: candidate.name,
            level: candidate.level,
            growth: CHARACTER_DATA[candidate.characterDataId].growth,
            weapon: candidate.weapon,
            synergies: CHARACTER_DATA[candidate.characterDataId].synergies,
          })
        );
      }
    }

    return h("div", { class: "panel" }, children);
  }

  function render() {
    const canDepart = mode === "initial" ? state.formationSlots.length > 0 && candidates.some((c) => c.hired) : true;

    const actions = [];
    if (mode === "normal") {
      actions.push(
        button("除隊", { variant: "ghost", onClick: () => api.callScene("squadFormation", { mode: "discharge" }) })
      );
    }
    const departLabel = mode === "initial" ? "出発" : mode === "peddler" ? "もどる" : "店を出る";
    actions.push(
      button(departLabel, {
        variant: "primary",
        disabled: !canDepart,
        onClick: () => api.closeScene(candidates),
      })
    );

    renderScreen(container, {
      eyebrow: mode === "initial" ? "INITIAL HIRING" : mode === "peddler" ? "PEDDLER / HIRING" : "VILLAGE / HIRING",
      title: mode === "initial" ? "初期雇用" : mode === "peddler" ? "雇用（荷馬車）" : "雇用所",
      subtitle:
        mode === "initial"
          ? "最初に雇用する隊員を選んでください（複数人選べます）。"
          : "雇用したい候補者を選んでください。",
      corner: resourceHud(state.run?.resources),
      body: [h("div", { class: "slot-list slot-list--grid" }, candidates.map(candidateRow))],
      onPause: () => api.callScene("pause"),
      actions,
    });
  }

  render();
  return { onResume: () => render() };
}

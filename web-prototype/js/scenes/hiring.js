import { renderScreen, button, h, resourceHud } from "../dom.js";
import state, {
  canAffordCost,
  hasSquadRoom,
  hireCharacter,
  grantInitialHiringBudget,
} from "../state.js";
import {
  CHARACTER_DATA,
  INITIAL_EMPLOYMENT_DATA,
  RIGID_RESOURCES,
  computeWeaponRating,
  describeCharacter,
  createCharacterFromData,
  createHiringCandidate,
  pickRandomEmploymentIds,
} from "../data/resourceCatalog.js";

const COST_ABBR = RIGID_RESOURCES.coarseSugarMineral.abbr;
const NORMAL_CANDIDATE_COUNT = 5;

// 雇用画面. Call-only, two modes:
//  - "initial": the very first squad-building pass, right after
//    entering a dungeon (see map.js). Every 初期雇用データ entry is a
//    candidate, cost is a flat 1 regardless of stats, and the screen
//    grants its own starting budget on mount so it doesn't depend on
//    whatever triggered it. Closing ("出発") is gated on having hired
//    at least one candidate into a non-empty formation.
//  - "normal": mid-run hiring from the trade screen's 雇用所. Draws 5
//    unique candidates at random from the same underlying data (a
//    stand-in for a real difficulty-scaled candidate pool) and charges
//    the real (simplified) cost formula. Closing ("店を出る") is never
//    gated.
export function HiringScene(container, params, api) {
  const mode = params.mode;
  if (mode !== "initial" && mode !== "normal") {
    throw new Error('hiring scene requires params.mode of "initial" or "normal"');
  }

  if (mode === "initial") {
    grantInitialHiringBudget();
  }

  const employmentIds =
    mode === "initial" ? Object.keys(INITIAL_EMPLOYMENT_DATA) : pickRandomEmploymentIds(NORMAL_CANDIDATE_COUNT);
  const candidates = employmentIds.map((id) =>
    createHiringCandidate(id, mode === "initial" ? { flatCost: 1 } : undefined)
  );

  const hiredIds = new Set();
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
    hiredIds.add(candidate.employmentId);
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
    const isHired = hiredIds.has(candidate.employmentId);
    const isExpanded = expandedIds.has(candidate.employmentId);
    const isPendingThis = pending?.employmentId === candidate.employmentId;
    const rating = computeWeaponRating(candidate.weapon.stats);

    const children = [
      h("div", { class: "slot__meta" }, [
        h("span", { class: "slot__id", text: `Lv.${candidate.level} / 武器評価${rating}` }),
        h("span", { class: "slot__name", text: candidate.name }),
        h("span", { class: "tag", text: `費用 ${COST_ABBR}×${candidate.cost}` }),
        isHired ? h("span", { class: "tag tag--selected", text: "雇用済み" }) : null,
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
          button("雇用", { variant: "primary", disabled: isHired, onClick: () => handleHireClick(candidate) }),
        ])
      );
      if (isExpanded) {
        children.push(
          h("p", {
            class: "lead",
            text: describeCharacter({
              level: candidate.level,
              growth: CHARACTER_DATA[candidate.characterDataId].growth,
              weapon: candidate.weapon,
            }),
          })
        );
      }
    }

    return h("div", { class: "panel" }, children);
  }

  function render() {
    const canDepart = mode === "initial" ? state.formationSlots.length > 0 && hiredIds.size > 0 : true;

    renderScreen(container, {
      eyebrow: mode === "initial" ? "INITIAL HIRING" : "HIRING",
      title: "雇用",
      subtitle:
        mode === "initial"
          ? "最初に雇用する隊員を選んでください（複数人選べます）。"
          : "雇用したい候補者を選んでください。",
      corner: resourceHud(state.run?.resources),
      body: [h("div", { class: "slot-list" }, candidates.map(candidateRow))],
      actions: [
        button("除隊", { variant: "ghost", onClick: () => api.callScene("squadFormation", { mode: "discharge" }) }),
        button(mode === "initial" ? "出発" : "店を出る", {
          variant: "primary",
          disabled: !canDepart,
          onClick: () => api.closeScene(),
        }),
      ],
    });
  }

  render();
  return { onResume: () => render() };
}

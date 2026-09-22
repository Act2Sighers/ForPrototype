import { renderScreen, button, h, resourceHud } from "../dom.js";
import { characterInfoCard } from "../characterCard.js";
import state, { FORMATION_LIMIT, STANDBY_LIMIT, canAffordCost, hasSquadRoom, hireCharacter } from "../state.js";
import {
  CHARACTER_DATA,
  RIGID_RESOURCES,
  INITIAL_HIRING_COST_PER_MEMBER,
  computeWeaponRating,
  createCharacterFromData,
  createHiringCandidate,
  createInitialHiringGroupCandidates,
  pickRandomEmploymentIds,
} from "../data/resourceCatalog.js";

const COST_ABBR = RIGID_RESOURCES.coarseSugarMineral.abbr;
const NORMAL_CANDIDATE_COUNT = 5;
const PEDDLER_CANDIDATE_COUNT = 2;
const PEDDLER_COST_MULTIPLIER = 0.5;

// 通常雇用/行商モードの候補生成に渡すラン進捗率(m/X)＋難易度D。初期雇用
// は対象外(グループ単位の固定編成のため進捗率を使わない)。
function currentProgress() {
  return {
    currentNodeCount: state.run.visitedNodeIds.length,
    longestReachableNodeCount: state.run.dungeonParams.longestReachableNodeCount,
    difficultyValue: state.run.dungeonParams.difficultyValue,
  };
}

// 編成/待機を合わせた空きスロット数がcount以上あるか（グループ雇用は
// 一度に複数人加入するため、hasSquadRoom()の「1人分空きがあるか」では
// 足りない）。
function hasRoomForCount(count) {
  const available = FORMATION_LIMIT - state.formationSlots.length + (STANDBY_LIMIT - state.standbySlots.length);
  return available >= count;
}

function generateCandidates(mode) {
  if (mode === "initial") {
    return createInitialHiringGroupCandidates().map((group) => ({ ...group, hired: false }));
  }
  const count = mode === "peddler" ? PEDDLER_CANDIDATE_COUNT : NORMAL_CANDIDATE_COUNT;
  const options = { progress: currentProgress(), ...(mode === "peddler" ? { costMultiplier: PEDDLER_COST_MULTIPLIER } : {}) };
  return pickRandomEmploymentIds(count).map((id) => ({ ...createHiringCandidate(id, options), hired: false }));
}

// 雇用画面. Call-only, three modes:
//  - "initial": the very first squad-building pass, right after the
//    オープニング episode grants its starting budget (see map.js and
//    data/scripts.js's OPENING_SCRIPT). テストダンジョン向けに固定で
//    3組の2人グループ（INITIAL_HIRING_GROUPS、resourceCatalog.js）を
//    提示し、そのうち1組だけを選んで雇用する（同時に複数組は雇用不可
//    ——1組雇用した時点で残り全グループの雇用ボタンを無効化する）。
//    費用は1人あたりINITIAL_HIRING_COST_PER_MEMBER（2人グループなら
//    その2倍）。Closing ("出発") is
//    gated on having hired the one group into a non-empty formation. No
//    除隊 button here — pairing it with hiring would let the player hire
//    and immediately discharge someone as a resource-laundering glitch.
//  - "normal": mid-run hiring from the trade screen's 雇用所. Candidates
//    are passed in via params.candidates (trade.js keeps them alive for
//    the whole trade visit, re-passing the same array — hired flags and
//    all — every time the player reopens 雇用所) rather than drawn fresh
//    here; see trade.js. レベル・武器・費用はラン進捗率に応じて
//    スケールする（createHiringCandidateのprogress経路、
//    currentProgress()参照）。Closing ("店を出る") は never gated, and
//    除隊 is available.
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
  // initialモードはgroupId、normal/peddlerモードはemploymentIdで識別する。
  let pending = null; // { employmentId | groupId, kind: "confirm" | "insufficient-funds" | "no-space" }

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
    const character = createCharacterFromData(candidate.characterDataId, candidate.bonusGrowth ?? {});
    character.weapon = candidate.weapon;
    hireCharacter(character, candidate.cost);
    candidate.hired = true;
    pending = null;
    render();
  }

  function handleHireGroupClick(group) {
    if (!canAffordCost(group.cost)) {
      pending = { groupId: group.groupId, kind: "insufficient-funds" };
    } else if (!hasRoomForCount(group.members.length)) {
      pending = { groupId: group.groupId, kind: "no-space" };
    } else {
      pending = { groupId: group.groupId, kind: "confirm" };
    }
    render();
  }

  function confirmHireGroup(group) {
    for (const member of group.members) {
      const character = createCharacterFromData(member.characterDataId);
      character.weapon = member.weapon;
      hireCharacter(character, INITIAL_HIRING_COST_PER_MEMBER);
    }
    group.hired = true;
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
            dataId: candidate.characterDataId,
            level: candidate.level,
            growth: candidate.growth,
            weapon: candidate.weapon,
            synergies: CHARACTER_DATA[candidate.characterDataId].synergies,
          })
        );
      }
    }

    return h("div", { class: "panel" }, children);
  }

  function groupPendingPanel(group) {
    if (pending.kind === "confirm") {
      return h("div", { class: "confirm-row" }, [
        h("span", {
          class: "confirm-row__text",
          text: `「${group.title}」を雇用します（費用: ${COST_ABBR}×${group.cost}）。よろしいですか？`,
        }),
        button("実行する", { variant: "primary", onClick: () => confirmHireGroup(group) }),
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

  function groupRow(group) {
    const isExpanded = expandedIds.has(group.groupId);
    const isPendingThis = pending?.groupId === group.groupId;
    const anyGroupHired = candidates.some((g) => g.hired);

    const children = [
      h("div", { class: "slot__meta" }, [
        h("span", { class: "slot__name", text: group.title }),
        h("span", { class: "tag", text: `費用 ${COST_ABBR}×${group.cost}` }),
        group.hired ? h("span", { class: "tag tag--selected", text: "雇用済み" }) : null,
      ]),
    ];

    if (isPendingThis) {
      children.push(groupPendingPanel(group));
    } else {
      children.push(
        h("div", { class: "slot__actions" }, [
          button(isExpanded ? "詳細を隠す" : "詳細表示", {
            variant: "ghost",
            onClick: () => {
              if (isExpanded) expandedIds.delete(group.groupId);
              else expandedIds.add(group.groupId);
              render();
            },
          }),
          button("雇用", {
            variant: "primary",
            disabled: anyGroupHired,
            onClick: () => handleHireGroupClick(group),
          }),
        ])
      );
      if (isExpanded) {
        children.push(
          h(
            "div",
            { class: "field-group" },
            group.members.map((member) =>
              characterInfoCard({
                name: member.name,
                dataId: member.characterDataId,
                level: member.level,
                growth: member.growth,
                weapon: member.weapon,
                synergies: CHARACTER_DATA[member.characterDataId].synergies,
              })
            )
          )
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
          ? "最初に雇用する2人組を1組選んでください。"
          : "雇用したい候補者を選んでください。",
      corner: resourceHud(state.run?.resources),
      body: [
        h(
          "div",
          { class: "slot-list slot-list--grid" },
          candidates.map(mode === "initial" ? groupRow : candidateRow)
        ),
      ],
      onPause: () => api.callScene("pause"),
      actions,
    });
  }

  render();
  return { onResume: () => render() };
}

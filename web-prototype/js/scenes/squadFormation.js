import { renderScreen, button, h } from "../dom.js";
import state, { FORMATION_LIMIT, STANDBY_LIMIT, dischargeCharacter } from "../state.js";
import { describeCharacter, describeResources, computeWeaponRating } from "../data/resourceCatalog.js";

const EMPTY_FORMATION_MESSAGE = "編成スロットには隊員が1人以上必要です。";

// While editing, moving a member to the other list is always allowed
// (no per-move capacity check) — validity is only checked here, at
// commit time. Over capacity (>6) on either list, or an empty
// formation, blocks 編成完了 until the player moves people back.
function formationWarning(formationList, standbyList) {
  if (formationList.length === 0) return EMPTY_FORMATION_MESSAGE;
  if (formationList.length > FORMATION_LIMIT) return `編成スロットが定員(${FORMATION_LIMIT}人)を超えています。`;
  if (standbyList.length > STANDBY_LIMIT) return `待機スロットが定員(${STANDBY_LIMIT}人)を超えています。`;
  return null;
}

// 部隊編成画面. Two modes:
//  - "normal" (default): view the squad, or edit it -- move members
//    freely between formation/standby one at a time. "編成完了" is
//    disabled (with a warning explaining why) if that leaves formation
//    empty or either list over its 6-person capacity; moving people
//    back the other way clears it.
//  - "discharge": called from the 雇用画面's 除隊 button. Every member
//    gets a 除隊 button that retires them for a resource reward (see
//    state.js's dischargeCharacter). The sole remaining formation
//    member can't be discharged.
export function SquadFormationScene(container, params, api) {
  const mode = params.mode === "discharge" ? "discharge" : "normal";

  let editing = false;
  let draftFormation = [];
  let draftStandby = [];
  let pendingDischargeId = null;

  function enterEdit() {
    draftFormation = [...state.formationSlots];
    draftStandby = [...state.standbySlots];
    editing = true;
    render();
  }

  function commit() {
    if (formationWarning(draftFormation, draftStandby)) return;
    state.formationSlots = draftFormation;
    state.standbySlots = draftStandby;
    editing = false;
    render();
  }

  function cancel() {
    editing = false;
    render();
  }

  function moveCharacter(id, fromKey) {
    const fromArr = fromKey === "formation" ? draftFormation : draftStandby;
    const toArr = fromKey === "formation" ? draftStandby : draftFormation;
    const idx = fromArr.findIndex((c) => c.id === id);
    if (idx === -1) return;
    const [character] = fromArr.splice(idx, 1);
    toArr.push(character);
    render();
  }

  function handleDischargeClick(id) {
    pendingDischargeId = id;
    render();
  }

  function confirmDischarge(id) {
    dischargeCharacter(id);
    pendingDischargeId = null;
    render();
  }

  function cancelDischarge() {
    pendingDischargeId = null;
    render();
  }

  function dischargeRow(character, listKey, sourceLen) {
    const isPending = pendingDischargeId === character.id;
    const rating = character.weapon ? computeWeaponRating(character.weapon.stats) : null;

    if (isPending) {
      const warning =
        rating === "A" || rating === "S" ? `武器評価:${rating}の武器を所持しています。` : "";
      return h("div", { class: "slot" }, [
        h("div", { class: "slot__meta" }, [
          h("span", { class: "slot__id", text: `Lv.${character.level}` }),
          h("span", { class: "slot__name", text: character.name }),
        ]),
        h("div", { class: "confirm-row" }, [
          h("span", { class: "confirm-row__text", text: `${warning}${character.name}を除隊させます。よろしいですか？` }),
          button("実行する", { variant: "danger", onClick: () => confirmDischarge(character.id) }),
          button("キャンセル", { variant: "ghost", onClick: cancelDischarge }),
        ]),
      ]);
    }

    const disabled = listKey === "formation" && sourceLen <= 1;
    return h("div", { class: "slot" }, [
      h("div", { class: "slot__meta" }, [
        h("span", { class: "slot__id", text: `Lv.${character.level}` }),
        h("span", { class: "slot__name", text: character.name }),
      ]),
      h("div", { class: "slot__actions" }, [
        button("除隊", { variant: "danger", disabled, onClick: () => handleDischargeClick(character.id) }),
      ]),
    ]);
  }

  function characterRow(character, listKey) {
    if (mode === "discharge") {
      const sourceLen = listKey === "formation" ? state.formationSlots.length : state.standbySlots.length;
      return dischargeRow(character, listKey, sourceLen);
    }

    const actions = [];
    if (editing) {
      const label = listKey === "formation" ? "待機へ" : "編成へ";
      actions.push(button(label, { variant: "frost", onClick: () => moveCharacter(character.id, listKey) }));
    }
    return h("div", { class: "slot" }, [
      h("div", { class: "slot__meta" }, [
        h("span", { class: "slot__id", text: `Lv.${character.level}` }),
        h("span", { class: "slot__name", text: character.name }),
        listKey === "formation" ? h("span", { class: "tag", text: describeCharacter(character) }) : null,
      ]),
      h("div", { class: "slot__actions" }, actions),
    ]);
  }

  function render() {
    const formationList = mode === "discharge" ? state.formationSlots : editing ? draftFormation : state.formationSlots;
    const standbyList = mode === "discharge" ? state.standbySlots : editing ? draftStandby : state.standbySlots;

    const resourceTags = describeResources(state.run?.resources).map((r) =>
      h("span", { class: "tag", text: `${r.abbr}×${r.qty}` })
    );

    const body = [
      h("div", { class: "field-group" }, [
        h("p", { class: "field-label", text: `編成スロット（${formationList.length}/${FORMATION_LIMIT}）` }),
        formationList.length
          ? h("div", { class: "slot-list" }, formationList.map((c) => characterRow(c, "formation")))
          : h("p", { class: "lead", text: EMPTY_FORMATION_MESSAGE }),
      ]),
      h("div", { class: "field-group" }, [
        h("p", { class: "field-label", text: `待機スロット（${standbyList.length}/${STANDBY_LIMIT}）` }),
        standbyList.length
          ? h("div", { class: "slot-list" }, standbyList.map((c) => characterRow(c, "standby")))
          : h("p", { class: "lead", text: "待機中の隊員はいません。" }),
      ]),
      h("div", { class: "field-group" }, [
        h("p", { class: "field-label", text: "所持資源" }),
        h("div", { class: "chip-row" }, resourceTags),
      ]),
    ];

    let actions;
    let subtitle;
    if (mode === "discharge") {
      actions = [button("閉じる", { variant: "ghost", onClick: () => api.closeScene() })];
      subtitle = "退役させたい隊員の「除隊」を押してください。";
    } else if (editing) {
      const warning = formationWarning(draftFormation, draftStandby);
      if (warning) {
        body.push(h("p", { class: "lead", style: "color: var(--danger-strong)", text: warning }));
      }
      actions = [
        button("キャンセル", { variant: "ghost", onClick: cancel }),
        button("編成完了", { variant: "primary", disabled: Boolean(warning), onClick: commit }),
      ];
      subtitle = "隊員を編成・待機スロット間で移動できます（編成には最低1人必要です。各スロット定員は6人です）。";
    } else {
      actions = [
        button("閉じる", { variant: "ghost", onClick: () => api.closeScene() }),
        button("編成を変える", { variant: "primary", onClick: enterEdit }),
      ];
      subtitle = "編成スロットの隊員が戦闘に参加します。";
    }

    renderScreen(container, {
      eyebrow: mode === "discharge" ? "SQUAD / DISCHARGE" : "SQUAD",
      title: mode === "discharge" ? "部隊編成（除隊）" : "部隊編成",
      subtitle,
      body,
      actions,
    });
  }

  render();
  return {};
}

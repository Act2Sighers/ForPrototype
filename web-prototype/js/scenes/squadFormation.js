import { renderScreen, button, h } from "../dom.js";
import state, { FORMATION_LIMIT, STANDBY_LIMIT, dischargeCharacter } from "../state.js";
import { describeCharacter, describeResources, computeWeaponRating } from "../data/resourceCatalog.js";

// 部隊編成画面. Two modes:
//  - "normal" (default): view the squad, or edit it -- move members
//    between formation/standby one at a time (disabled once the
//    destination list is full), or select one from each list and hit
//    交換 to swap them directly (the only way to rearrange once both
//    lists are completely full, since there's no open slot to move
//    into).
//  - "discharge": called from the 雇用画面's 除隊 button. Every member
//    gets a 除隊 button that retires them for a resource reward (see
//    state.js's dischargeCharacter). The sole remaining formation
//    member can't be discharged.
export function SquadFormationScene(container, params, api) {
  const mode = params.mode === "discharge" ? "discharge" : "normal";

  let editing = false;
  let draftFormation = [];
  let draftStandby = [];
  let selectedFormationId = null;
  let selectedStandbyId = null;
  let pendingDischargeId = null;

  function enterEdit() {
    draftFormation = [...state.formationSlots];
    draftStandby = [...state.standbySlots];
    selectedFormationId = null;
    selectedStandbyId = null;
    editing = true;
    render();
  }

  function commit() {
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
    selectedFormationId = null;
    selectedStandbyId = null;

    const fromArr = fromKey === "formation" ? draftFormation : draftStandby;
    const toKey = fromKey === "formation" ? "standby" : "formation";
    const toArr = toKey === "formation" ? draftFormation : draftStandby;
    const toLimit = toKey === "formation" ? FORMATION_LIMIT : STANDBY_LIMIT;

    if (fromKey === "formation" && fromArr.length <= 1) return; // formation needs >=1
    if (toArr.length >= toLimit) return;

    const idx = fromArr.findIndex((c) => c.id === id);
    if (idx === -1) return;
    const [character] = fromArr.splice(idx, 1);
    toArr.push(character);
    render();
  }

  function toggleSelect(id, listKey) {
    if (listKey === "formation") selectedFormationId = selectedFormationId === id ? null : id;
    else selectedStandbyId = selectedStandbyId === id ? null : id;
    render();
  }

  function swapSelected() {
    if (!selectedFormationId || !selectedStandbyId) return;
    const fIdx = draftFormation.findIndex((c) => c.id === selectedFormationId);
    const sIdx = draftStandby.findIndex((c) => c.id === selectedStandbyId);
    if (fIdx === -1 || sIdx === -1) return;
    [draftFormation[fIdx], draftStandby[sIdx]] = [draftStandby[sIdx], draftFormation[fIdx]];
    selectedFormationId = null;
    selectedStandbyId = null;
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

  function characterRow(character, listKey, sourceLen, targetLen, targetLimit) {
    if (mode === "discharge") return dischargeRow(character, listKey, sourceLen);

    const actions = [];
    if (editing) {
      const isSelected =
        listKey === "formation" ? selectedFormationId === character.id : selectedStandbyId === character.id;
      actions.push(
        button(isSelected ? "選択中" : "選択", {
          variant: isSelected ? "primary" : "frost",
          onClick: () => toggleSelect(character.id, listKey),
        })
      );
      const label = listKey === "formation" ? "待機へ" : "編成へ";
      const moveDisabled = (listKey === "formation" && sourceLen <= 1) || targetLen >= targetLimit;
      actions.push(
        button(label, { variant: "frost", disabled: moveDisabled, onClick: () => moveCharacter(character.id, listKey) })
      );
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
        h(
          "div",
          { class: "slot-list" },
          formationList.map((c) =>
            characterRow(c, "formation", formationList.length, standbyList.length, STANDBY_LIMIT)
          )
        ),
      ]),
      h("div", { class: "field-group" }, [
        h("p", { class: "field-label", text: `待機スロット（${standbyList.length}/${STANDBY_LIMIT}）` }),
        standbyList.length
          ? h(
              "div",
              { class: "slot-list" },
              standbyList.map((c) =>
                characterRow(c, "standby", standbyList.length, formationList.length, FORMATION_LIMIT)
              )
            )
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
      actions = [
        button("キャンセル", { variant: "ghost", onClick: cancel }),
        button("交換", {
          variant: "frost",
          disabled: !(selectedFormationId && selectedStandbyId),
          onClick: swapSelected,
        }),
        button("編成完了", { variant: "primary", onClick: commit }),
      ];
      subtitle =
        "隊員を編成・待機スロット間で移動できます（編成には最低1人必要です）。両方満員のときは、編成側と待機側から1人ずつ「選択」して「交換」してください。";
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

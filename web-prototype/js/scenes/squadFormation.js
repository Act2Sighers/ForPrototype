import { renderScreen, button, h } from "../dom.js";
import state, { FORMATION_LIMIT, STANDBY_LIMIT } from "../state.js";
import { describeCharacter, describeResources } from "../data/resourceCatalog.js";

export function SquadFormationScene(container, params, api) {
  let editing = false;
  let draftFormation = [];
  let draftStandby = [];

  function enterEdit() {
    draftFormation = [...state.formationSlots];
    draftStandby = [...state.standbySlots];
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

  function characterRow(character, listKey, sourceLen, targetLen, targetLimit) {
    const actions = [];
    if (editing) {
      const label = listKey === "formation" ? "待機へ" : "編成へ";
      const disabled = (listKey === "formation" && sourceLen <= 1) || targetLen >= targetLimit;
      actions.push(
        button(label, {
          variant: "frost",
          disabled,
          onClick: () => moveCharacter(character.id, listKey),
        })
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
    const formationList = editing ? draftFormation : state.formationSlots;
    const standbyList = editing ? draftStandby : state.standbySlots;

    const resourceTags = describeResources(state.run?.resources).map((r) =>
      h("span", { class: "tag", text: `${r.name}×${r.qty}` })
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

    const actions = editing
      ? [
          button("キャンセル", { variant: "ghost", onClick: cancel }),
          button("編成完了", { variant: "primary", onClick: commit }),
        ]
      : [
          button("閉じる", { variant: "ghost", onClick: () => api.closeScene() }),
          button("編成を変える", { variant: "primary", onClick: enterEdit }),
        ];

    renderScreen(container, {
      eyebrow: "SQUAD",
      title: "部隊編成",
      subtitle: editing
        ? "隊員を編成・待機スロット間で移動できます（編成には最低1人必要です）。"
        : "編成スロットの隊員が戦闘に参加します。",
      body,
      actions,
    });
  }

  render();
  return {};
}

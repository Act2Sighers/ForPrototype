import { renderScreen, button, h } from "../dom.js";
import { characterHpGauge, characterStatLine, characterWeaponLine, characterSynergyLine, characterConditionBadge } from "../characterCard.js";
import state, { FORMATION_LIMIT, STANDBY_LIMIT, dischargeCharacter, equipStoredWeapon } from "../state.js";
import { computeWeaponRating, canEquip, getWeaponDisplayName } from "../data/resourceCatalog.js";

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

// 部隊編成画面. Three modes:
//  - "normal" (default): view the squad, or edit it -- move members
//    freely between formation/standby one at a time. "編成完了" is
//    disabled (with a warning explaining why) if that leaves formation
//    empty or either list over its 6-person capacity; moving people
//    back the other way clears it. Also the entry point into 武器置き場
//    (via "武器"/"資源", a sibling-swap -- see api.closeScene's
//    {openNext} convention below and map.js/trade.js's handling of it)
//    and, per-member, into a weapon 持ち替え (via "武器変更", a nested
//    call into weaponStorage's own "swap" mode).
//  - "discharge": called from the 雇用画面's 除隊 button. Every member
//    gets a 除隊 button that retires them for a resource reward (see
//    state.js's dischargeCharacter). The sole remaining formation
//    member can't be discharged.
//  - "swap" (持ち替えモード): called from weaponStorage.js's own
//    "装備させる" button, with params.weapon set to the specific
//    未装備武器 being equipped. Shows only the members who share a
//    シナジー with that weapon (see resourceCatalog.js's canEquip);
//    選択→confirm swaps it onto the chosen member (their previous
//    weapon, if any, returns to 武器置き場) and returns to the caller.
export function SquadFormationScene(container, params, api) {
  const mode = params.mode === "discharge" ? "discharge" : params.mode === "swap" ? "swap" : "normal";
  const swapWeapon = mode === "swap" ? params.weapon : null;

  let editing = false;
  let draftFormation = [];
  let draftStandby = [];
  let pendingDischargeId = null;
  let pendingEquipId = null;
  const expandedIds = new Set();

  function toggleDetail(id) {
    if (expandedIds.has(id)) expandedIds.delete(id);
    else expandedIds.add(id);
    render();
  }

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

  function handleEquipClick(id) {
    pendingEquipId = id;
    render();
  }

  function confirmEquip(character) {
    equipStoredWeapon(character, swapWeapon.id);
    // {swapped: true} lets a caller that cares (weaponForge.js's own
    // "すぐに装備させる", which should cascade-close back to 鍛冶画面
    // once the swap actually happens) tell that apart from a plain
    // キャンセル -- weaponStorage.js's own caller of this mode ignores
    // the result either way and just re-renders.
    api.closeScene({ swapped: true });
  }

  function cancelEquip() {
    pendingEquipId = null;
    render();
  }

  function swapRow(character, locationLabel) {
    const isPending = pendingEquipId === character.id;
    if (isPending) {
      return h("div", { class: "slot" }, [
        h("div", { class: "slot__meta" }, [
          h("span", { class: "slot__id", text: `Lv.${character.level}` }),
          h("span", { class: "slot__name", text: `${character.name}（${locationLabel}）` }),
        ]),
        h("div", { class: "confirm-row" }, [
          h("span", {
            class: "confirm-row__text",
            text: `${character.name}に${getWeaponDisplayName(swapWeapon)}を装備させます。よろしいですか？`,
          }),
          button("実行する", { variant: "primary", onClick: () => confirmEquip(character) }),
          button("キャンセル", { variant: "ghost", onClick: cancelEquip }),
        ]),
      ]);
    }
    return h("div", { class: "slot" }, [
      h("div", { class: "slot__meta" }, [
        h("span", { class: "slot__id", text: `Lv.${character.level}` }),
        h("span", { class: "slot__name", text: `${character.name}（${locationLabel}）` }),
      ]),
      h("div", { class: "slot__actions" }, [
        button("選択", { variant: "primary", onClick: () => handleEquipClick(character.id) }),
      ]),
    ]);
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
    } else {
      actions.push(
        button("武器変更", { variant: "ghost", onClick: () => api.callScene("weaponStorage", { mode: "swap", character }) })
      );
    }

    if (listKey !== "formation") {
      return h("div", { class: "slot" }, [
        h("div", { class: "slot__meta" }, [
          h("span", { class: "slot__id", text: `Lv.${character.level}` }),
          h("span", { class: "slot__name", text: character.name }),
        ]),
        h("div", { class: "slot__actions" }, actions),
      ]);
    }

    // Formation members always show their HP gauge (per the player's
    // request, this needs no click), with the full stat/weapon
    // breakdown behind a 詳細表示 toggle -- a multi-line card like this
    // shown unconditionally for every member would make the screen very
    // tall, matching hiring.js/gallery.js's existing detail-toggle
    // pattern.
    const isExpanded = expandedIds.has(character.id);
    actions.push(
      button(isExpanded ? "詳細を隠す" : "詳細表示", { variant: "ghost", onClick: () => toggleDetail(character.id) })
    );
    const rowChildren = [
      h("div", { class: "row-between" }, [
        h("div", { class: "slot__meta" }, [
          h("span", { class: "slot__id", text: `Lv.${character.level}` }),
          h("span", { class: "slot__name", text: character.name }),
        ]),
        // 変調は詳細表示のトグルに関係なく常に表示するため、アクション
        // 行の右上に、アクションボタン列と縦に並べて右揃えで置く。
        h("div", { class: "slot__actions-group" }, [characterConditionBadge(character), h("div", { class: "slot__actions" }, actions)]),
      ]),
      characterHpGauge(character),
    ];
    if (isExpanded) {
      rowChildren.push(characterSynergyLine(character), characterStatLine(character), characterWeaponLine(character));
    }
    return h("div", { class: "panel" }, rowChildren);
  }

  function renderSwap() {
    const candidates = [
      ...state.formationSlots.map((c) => ({ character: c, location: "編成中" })),
      ...state.standbySlots.map((c) => ({ character: c, location: "待機中" })),
    ].filter((entry) => canEquip(entry.character, swapWeapon));

    renderScreen(container, {
      eyebrow: "SQUAD / SWAP",
      title: "部隊編成（持ち替え）",
      subtitle: "装備させる隊員を選んでください。",
      body: [
        candidates.length
          ? h("div", { class: "slot-list slot-list--grid" }, candidates.map((entry) => swapRow(entry.character, entry.location)))
          : h("p", { class: "lead", text: "共通のシナジーを持つ隊員がいません。" }),
      ],
      actions: [button("キャンセル", { variant: "ghost", onClick: () => api.closeScene() })],
    });
  }

  function render() {
    if (mode === "swap") {
      renderSwap();
      return;
    }

    const formationList = mode === "discharge" ? state.formationSlots : editing ? draftFormation : state.formationSlots;
    const standbyList = mode === "discharge" ? state.standbySlots : editing ? draftStandby : state.standbySlots;

    const body = [
      h("div", { class: "field-group" }, [
        h("p", { class: "field-label", text: `編成スロット（${formationList.length}/${FORMATION_LIMIT}）` }),
        formationList.length
          ? h("div", { class: "slot-list slot-list--grid" }, formationList.map((c) => characterRow(c, "formation")))
          : h("p", { class: "lead", text: EMPTY_FORMATION_MESSAGE }),
      ]),
      h("div", { class: "field-group" }, [
        h("p", { class: "field-label", text: `待機スロット（${standbyList.length}/${STANDBY_LIMIT}）` }),
        standbyList.length
          ? h("div", { class: "slot-list slot-list--grid" }, standbyList.map((c) => characterRow(c, "standby")))
          : h("p", { class: "lead", text: "待機中の隊員はいません。" }),
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
        button("武器", { onClick: () => api.closeScene({ openNext: "weaponStorage" }) }),
        button("資源", { onClick: () => api.closeScene({ openNext: "resourceStorage" }) }),
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
  return { onResume: () => render() };
}

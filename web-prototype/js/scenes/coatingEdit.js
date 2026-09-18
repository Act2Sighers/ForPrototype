import { renderScreen, button, h } from "../dom.js";
import state, { equipCoating, unequipCoating, unequipAllCoatings, unequipAllCoatingsForRoster } from "../state.js";
import { EQUIP_SLOTS, EQUIP_SLOT_LABELS, formatMastery, coatingEffectLine, availableCoatingsForSlot } from "../data/resourceCatalog.js";

// 編成/待機の現役隊員全員（除隊者は含めない -- 除隊した隊員の
// equippedCoatingsは「装備中」として数えない、つまりその糖衣は自動的に
// またプルダウンで選べるようになる）。
function activeRoster() {
  return [...state.formationSlots, ...state.standbySlots];
}

// 糖衣置き場にある糖衣（このランで持ち出し済み/手に入れた分のみ）。
function placedCoatings() {
  const takenOutIds = state.run?.takenOutItemIds ?? [];
  return state.warehouseItems.filter((item) => item.enabled && takenOutIds.includes(item.id));
}

// 未装備部位の要約行：「未装備部位: 2 / 5 （ 頭 ／ 胴 ）」のように、
// 頭/肩/腕/胴/脚の順で未装備の部位だけを挙げる。全部位装備済みなら
// 括弧は付けない。
function unequippedSummary(character) {
  const unequipped = EQUIP_SLOTS.filter((slot) => !character.equippedCoatings[slot]);
  if (unequipped.length === 0) return "未装備部位: 0 / 5";
  const names = unequipped.map((slot) => EQUIP_SLOT_LABELS[slot]).join(" ／ ");
  return `未装備部位: ${unequipped.length} / 5 （ ${names} ）`;
}

// 糖衣編集画面. 呼び出し元は squadFormation.js の隊員ごとの「糖衣編集」
// ボタン（params.characterで開いた時点から隊員がセット済み）と、
// coatingStorage.js の「糖衣編集」ボタン（隊員は空で開く）の2つ。
// 「隊員」枠クリックで squadFormation を「select」モード（隊員選択
// モード）で呼び、戻ってきた隊員をセットし直す。「糖衣構成詳細」枠は
// 隊員未選択の間グレーアウトし、選択後は頭/肩/腕/胴/脚の5部位ぶんの
// 行が並ぶ -- 各行は現在の装備＋効果内容の表示と、右揃えのプルダウン
// （availableCoatingsForSlotが返す「置き場にあって・誰にも装備されて
// いない」(attribute,effect,mastery)バケツ、"－"で未装備に戻す）から
// なる。プルダウンでの選択は即座に反映される（確定ボタンは無い）。
export function CoatingEditScene(container, params, api) {
  let character = params.character ?? null;

  function openCharacterSelect() {
    api.callScene("squadFormation", { mode: "select" });
  }

  function handleSlotChange(slot, rawValue) {
    if (!rawValue) {
      unequipCoating(character, slot);
    } else {
      const [attribute, effect, masteryText] = rawValue.split("|");
      equipCoating(character, slot, attribute, effect, Number(masteryText));
    }
    render();
  }

  function handleUnequipCharacter() {
    unequipAllCoatings(character);
    render();
  }

  function handleUnequipRoster() {
    unequipAllCoatingsForRoster();
    render();
  }

  function slotRow(slot) {
    const current = character.equippedCoatings[slot];
    const label = EQUIP_SLOT_LABELS[slot];
    const headerText = current ? `${label}: ${current.name} ／ ${formatMastery(current.mastery)}` : `${label}: (未装備)`;

    const options = availableCoatingsForSlot(placedCoatings(), activeRoster(), slot);
    const select = h(
      "select",
      { class: "select-dropdown", onChange: (e) => handleSlotChange(slot, e.target.value) },
      [
        h("option", { value: "", text: "－" }),
        ...options.map((opt) =>
          h("option", {
            value: `${opt.attribute}|${opt.effect}|${opt.mastery}`,
            text: `${opt.name}（${formatMastery(opt.mastery)}）×${opt.count}`,
          })
        ),
      ]
    );
    select.value = "";

    return h("div", { class: "field-group" }, [
      h("p", { class: "lead", text: headerText }),
      h("div", { class: "row-between" }, [
        current ? h("p", { class: "character-card__weapon", text: coatingEffectLine(current) }) : h("span"),
        select,
      ]),
    ]);
  }

  function render() {
    const characterBox = h(
      "div",
      { class: "panel forge-box forge-box--clickable", onClick: openCharacterSelect },
      [h("p", { class: "field-label", text: "隊員" }), h("p", { class: "lead", text: character ? character.name : "（未選択）" })]
    );

    const detailChildren = [h("p", { class: "field-label", text: "糖衣構成詳細" })];
    if (character) {
      detailChildren.push(h("p", { class: "lead", text: unequippedSummary(character) }));
      for (const slot of EQUIP_SLOTS) detailChildren.push(slotRow(slot));
    } else {
      detailChildren.push(h("p", { class: "lead", text: "（隊員を選択してください）" }));
    }
    const detailBox = h("div", { class: `panel forge-box${character ? "" : " forge-box--disabled"}` }, detailChildren);

    const rosterHasAnyCoating = activeRoster().some((c) => Object.values(c.equippedCoatings).some(Boolean));
    const characterHasAnyCoating = Boolean(character) && Object.values(character.equippedCoatings).some(Boolean);

    renderScreen(container, {
      eyebrow: "COATING / EDIT",
      title: "糖衣編集",
      body: [
        h("p", { class: "lead", text: "編集する隊員を選んでください。" }),
        h("div", { class: "enhance-layout" }, [characterBox, detailBox]),
      ],
      actions: [
        button("編集を終える", { variant: "ghost", onClick: () => api.closeScene() }),
        button("全隊員の糖衣を外す", { disabled: !rosterHasAnyCoating, onClick: handleUnequipRoster }),
        button("この隊員の糖衣を外す", { disabled: !characterHasAnyCoating, onClick: handleUnequipCharacter }),
      ],
    });
  }

  render();
  return {
    onResume: (result) => {
      if (result) character = result;
      render();
    },
  };
}

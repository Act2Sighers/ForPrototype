import { renderScreen, button, h } from "../dom.js";
import state from "../state.js";
import { CHARACTER_DATA, IMPLEMENTED_CHARACTER_IDS, WEAPON_TYPES, compatibleWeaponTypeIds } from "../data/resourceCatalog.js";
import { skillLabel } from "./battle.js";
import { CHARACTER_SKILL_ACQUISITIONS } from "../data/characterSkills.js";
import {
  arenaEnemyTemplate,
  buildArenaDefaultAllySlot,
  ARENA_LEVELS,
  ARENA_GROWTH_PROFILES,
  ARENA_WEAPON_QUALITIES,
  computeSkillTrees,
  computeArenaSkillBudgetUsed,
  arenaSkillBudgetFor,
} from "../data/arena.js";

const ALLY_MIN = 2;
const ALLY_MAX = 6;

// 訓練所（アリーナ画面）：プレイヤーが任意の味方編成・敵配置・諸設定を
// 決めて、その通りの戦闘（battle.jsのアリーナモード）を実行できる
// シミュレーション機能。
//
// Step4：味方ロースター（枠数/種族/レベル/能力値構成/武器/スキル構成）
// の編集UIを実装。設定は全てstate.arenaConfigを直接書き換える（保存済み
// プロフィールの一部として、既存のslotSnapshot/restoreFromSlotの仕組み
// にそのまま乗って永続化される -- state.jsのsetArenaConfigは「丸ごと
// 置き換え」（プリセット読込・インポート等）専用で、こうした細かい
// フィールド単位の対話的編集には使わない）。
// 敵ロースター詳細・一括設定・プリセット等は後続のステップで追加する。
export function ArenaSetupScene(container, params, api) {
  const expandedAllyIndices = new Set();

  function chip(label, isSelected, onClick, disabled = false) {
    return h("button", {
      class: `chip${isSelected ? " is-selected" : ""}`,
      disabled,
      onClick: disabled ? undefined : onClick,
      text: label,
    });
  }

  function enemySummaryLine(slot) {
    const data = arenaEnemyTemplate(slot.kind, slot.dataId);
    return `${data.name}×${slot.count} Lv.${slot.level}`;
  }

  // ---- 味方ロースターの増減 ----

  function addAlly() {
    if (state.arenaConfig.allies.length >= ALLY_MAX) return;
    const usedIds = new Set(state.arenaConfig.allies.map((a) => a.dataId));
    const nextId = IMPLEMENTED_CHARACTER_IDS.find((id) => !usedIds.has(id)) ?? IMPLEMENTED_CHARACTER_IDS[0];
    state.arenaConfig.allies.push(buildArenaDefaultAllySlot(nextId));
    render();
  }

  function removeAlly(index) {
    if (state.arenaConfig.allies.length <= ALLY_MIN) return;
    state.arenaConfig.allies.splice(index, 1);
    render();
  }

  // ---- 個別フィールドの更新（他フィールドとの整合性が崩れる場合は
  // ここで一緒にリセットする） ----

  // 種族を変えると、旧種族の武器種・スキル構成（成長ツリーの根本が
  // 別物になる）はそのまま引き継げないため、新種族が装備可能な先頭の
  // 武器種に差し替え、スキル構成は空（未強化）に戻す。
  function onSpeciesChange(slot, dataId) {
    slot.dataId = dataId;
    const compatible = compatibleWeaponTypeIds(dataId);
    slot.weaponTypeId = compatible[0] ?? null;
    slot.skillSelection = { trees: {}, acquisitions: [] };
    render();
  }

  // レベルを下げて現在のスキル構成が新しい予算を超えてしまう場合は、
  // 部分的に間引くような複雑な調整はせず、単純に空へ戻す（安全側）。
  function onLevelChange(slot, level) {
    slot.level = level;
    const budget = arenaSkillBudgetFor(level);
    if (computeArenaSkillBudgetUsed(slot.dataId, slot.skillSelection) > budget) {
      slot.skillSelection = { trees: {}, acquisitions: [] };
    }
    render();
  }

  // ---- スキル構成：ツリー1本を仮に変更した場合の予算消費量を計算する
  // （実際に選ぶ前に「選べるかどうか」をチップの無効化に使う）----

  function skillBudgetIfTreeChoice(dataId, selection, root, skillId) {
    return computeArenaSkillBudgetUsed(dataId, { trees: { ...selection.trees, [root]: skillId }, acquisitions: selection.acquisitions });
  }

  function skillBudgetIfAcquisitionAdded(dataId, selection, skillId) {
    return computeArenaSkillBudgetUsed(dataId, { trees: selection.trees, acquisitions: [...selection.acquisitions, skillId] });
  }

  // ---- 各セクション ----

  function speciesSection(slot) {
    return h("div", { class: "field-group" }, [
      h("p", { class: "field-label", text: "種族" }),
      h(
        "div",
        { class: "chip-row" },
        IMPLEMENTED_CHARACTER_IDS.map((id) => chip(CHARACTER_DATA[id].name, slot.dataId === id, () => onSpeciesChange(slot, id)))
      ),
    ]);
  }

  function levelSection(slot) {
    return h("div", { class: "field-group" }, [
      h("p", { class: "field-label", text: "レベル" }),
      h(
        "div",
        { class: "chip-row" },
        ARENA_LEVELS.map((level) => chip(`Lv.${level}`, slot.level === level, () => onLevelChange(slot, level)))
      ),
    ]);
  }

  function growthProfileSection(slot) {
    return h("div", { class: "field-group" }, [
      h("p", { class: "field-label", text: "能力値構成" }),
      h(
        "div",
        { class: "chip-row" },
        Object.values(ARENA_GROWTH_PROFILES).map((profile) =>
          chip(profile.label, slot.growthProfileId === profile.id, () => {
            slot.growthProfileId = profile.id;
            render();
          })
        )
      ),
    ]);
  }

  // 種類/品質を1つのfield-groupにまとめず別々に返す（DOM上、片方の
  // ラベル文字列で絞り込んだ時に、もう片方のチップまで一緒に拾って
  // しまわないようにするため -- 見た目の余白はCSS側の.field-group同士の
  // marginで揃う）。
  function weaponSection(slot) {
    const typeIds = compatibleWeaponTypeIds(slot.dataId);
    return [
      h("div", { class: "field-group" }, [
        h("p", { class: "field-label", text: "武器種" }),
        h(
          "div",
          { class: "chip-row" },
          typeIds.map((id) =>
            chip(WEAPON_TYPES[id].name, slot.weaponTypeId === id, () => {
              slot.weaponTypeId = id;
              render();
            })
          )
        ),
      ]),
      h("div", { class: "field-group" }, [
        h("p", { class: "field-label", text: "武器品質" }),
        h(
          "div",
          { class: "chip-row" },
          Object.values(ARENA_WEAPON_QUALITIES).map((quality) =>
            chip(quality.label, slot.weaponQualityId === quality.id, () => {
              slot.weaponQualityId = quality.id;
              render();
            })
          )
        ),
      ]),
    ];
  }

  function skillTreeSection(slot, tree) {
    const budget = arenaSkillBudgetFor(slot.level);
    const currentChoice = slot.skillSelection.trees[tree.root] ?? tree.root;
    return h("div", { class: "field-group" }, [
      h("p", { class: "field-label", text: `${skillLabel(tree.root)}の成長` }),
      h(
        "div",
        { class: "chip-row" },
        tree.nodes.map((node) => {
          const isSelected = currentChoice === node.skillId;
          const used = skillBudgetIfTreeChoice(slot.dataId, slot.skillSelection, tree.root, node.skillId);
          const disabled = !isSelected && used > budget;
          return chip(
            skillLabel(node.skillId),
            isSelected,
            () => {
              slot.skillSelection.trees[tree.root] = node.skillId;
              render();
            },
            disabled
          );
        })
      ),
    ]);
  }

  function skillAcquisitionSection(slot) {
    const budget = arenaSkillBudgetFor(slot.level);
    const ids = CHARACTER_SKILL_ACQUISITIONS[slot.dataId] ?? [];
    if (ids.length === 0) return null;
    return h("div", { class: "field-group" }, [
      h("p", { class: "field-label", text: "新規修得スキル" }),
      h(
        "div",
        { class: "chip-row" },
        ids.map((skillId) => {
          const checked = slot.skillSelection.acquisitions.includes(skillId);
          const used = checked
            ? computeArenaSkillBudgetUsed(slot.dataId, slot.skillSelection)
            : skillBudgetIfAcquisitionAdded(slot.dataId, slot.skillSelection, skillId);
          const disabled = !checked && used > budget;
          return chip(
            skillLabel(skillId),
            checked,
            () => {
              slot.skillSelection.acquisitions = checked
                ? slot.skillSelection.acquisitions.filter((id) => id !== skillId)
                : [...slot.skillSelection.acquisitions, skillId];
              render();
            },
            disabled
          );
        })
      ),
    ]);
  }

  // weaponSectionと同じ理由で、ツリーごと・新規修得欄それぞれを独立した
  // field-groupのまま平らな配列で返す（ネストさせない）。
  function skillSection(slot) {
    const trees = computeSkillTrees(slot.dataId);
    const budget = arenaSkillBudgetFor(slot.level);
    const used = computeArenaSkillBudgetUsed(slot.dataId, slot.skillSelection);
    return [
      h("p", { class: "field-label", text: `スキル構成（強化予算 ${used}/${budget}）` }),
      ...trees.map((tree) => skillTreeSection(slot, tree)),
      skillAcquisitionSection(slot),
    ].filter(Boolean);
  }

  function allySlotCard(slot, index) {
    const isExpanded = expandedAllyIndices.has(index);
    const children = [
      h("div", { class: "slot__meta" }, [
        h("span", { class: "slot__name", text: `${CHARACTER_DATA[slot.dataId].name} Lv.${slot.level}` }),
      ]),
      h("div", { class: "slot__actions" }, [
        button(isExpanded ? "詳細を隠す" : "詳細設定", {
          variant: "ghost",
          onClick: () => {
            if (isExpanded) expandedAllyIndices.delete(index);
            else expandedAllyIndices.add(index);
            render();
          },
        }),
        button("削除", { variant: "ghost", disabled: state.arenaConfig.allies.length <= ALLY_MIN, onClick: () => removeAlly(index) }),
      ]),
    ];
    if (isExpanded) {
      children.push(speciesSection(slot), levelSection(slot), growthProfileSection(slot), ...weaponSection(slot), ...skillSection(slot));
    }
    return h("div", { class: "panel" }, children);
  }

  function render() {
    const config = state.arenaConfig;

    const body = [
      h("div", { class: "field-group" }, [
        h("div", { class: "row-between" }, [
          h("p", { class: "field-label", text: `味方陣営（${config.allies.length}/${ALLY_MAX}）` }),
          button("＋ 味方を追加", { variant: "ghost", disabled: config.allies.length >= ALLY_MAX, onClick: addAlly }),
        ]),
      ]),
      h("div", { class: "slot-list" }, config.allies.map((slot, index) => allySlotCard(slot, index))),
      h("div", { class: "field-group" }, [
        h("p", { class: "field-label", text: "敵陣営" }),
        h("p", { class: "lead", text: config.enemies.map(enemySummaryLine).join(" / ") }),
      ]),
      h("p", { class: "lead", text: "敵陣営の詳細設定・一括設定・プリセットは今後のステップで追加されます。" }),
    ];

    renderScreen(container, {
      eyebrow: "TRAINING GROUNDS",
      title: "訓練所",
      subtitle: "任意の組み合わせで戦闘をシミュレーションできます。",
      body,
      onPause: () => api.callScene("pause"),
      actions: [button("戻る", { variant: "ghost", onClick: () => api.closeScene() })],
    });
  }

  render();
  return { onResume: () => render() };
}

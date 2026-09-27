import { renderScreen, button, h } from "../dom.js";
import state, { ARENA_PRESET_LIMIT, saveArenaPreset, loadArenaPreset, deleteArenaPreset } from "../state.js";
import { CHARACTER_DATA, IMPLEMENTED_CHARACTER_IDS, WEAPON_TYPES, compatibleWeaponTypeIds } from "../data/resourceCatalog.js";
import { skillLabel } from "./battle.js";
import { CHARACTER_SKILL_ACQUISITIONS } from "../data/characterSkills.js";
import {
  arenaEnemyTemplate,
  arenaEnemyCatalogEntries,
  arenaRandomizableEnemyEntries,
  buildArenaDefaultAllySlot,
  fillArenaSkillsByPriority,
  createArenaCharacter,
  createArenaEnemy,
  validateArenaConfig,
  ARENA_LEVELS,
  ARENA_GROWTH_PROFILES,
  ARENA_WEAPON_QUALITIES,
  ARENA_ENEMY_CATALOG_KINDS,
  ARENA_ENEMY_KIND_LABELS,
  ARENA_DEFAULT_LEVEL,
  isArenaBossKind,
  computeSkillTrees,
  computeArenaSkillBudgetUsed,
  arenaSkillBudgetFor,
} from "../data/arena.js";

const ALLY_MIN = 2;
const ALLY_MAX = 6;
const ENEMY_SLOT_MIN = 1;
const ENEMY_SLOT_MAX = 5;
const ENEMY_TOTAL_COUNT_MAX = 12;

// 訓練所（アリーナ画面）：プレイヤーが任意の味方編成・敵配置・諸設定を
// 決めて、その通りの戦闘（battle.jsのアリーナモード）を実行できる
// シミュレーション機能。
//
// Step4：味方ロースター（枠数/種族/レベル/能力値構成/武器/スキル構成）
// Step5：敵ロースター（5種族枠/配置体数/レベル/ボス枠制約）
// Step6：一括設定・ランダム編成・変調トグル・プリセット
// の編集UIを実装。設定は全てstate.arenaConfigを直接書き換える（保存済み
// プロフィールの一部として、既存のslotSnapshot/restoreFromSlotの仕組み
// にそのまま乗って永続化される -- state.jsのsetArenaConfigは「丸ごと
// 置き換え」（プリセット読込・インポート等）専用で、こうした細かい
// フィールド単位の対話的編集には使わない。プリセットの保存/読込だけは
// 例外的に丸ごと置き換えなので、setArenaConfig相当のstructuredClone
// コピーを行うstate.js側のsaveArenaPreset/loadArenaPresetを使う）。
// バトル本体へのアリーナモード配線（【パス】スキル・報酬算出・変調の
// 実際の反映）はStep7で行う。
export function ArenaSetupScene(container, params, api) {
  const expandedAllyIndices = new Set();
  const expandedEnemyIndices = new Set();

  function chip(label, isSelected, onClick, disabled = false) {
    return h("button", {
      class: `chip${isSelected ? " is-selected" : ""}`,
      disabled,
      onClick: disabled ? undefined : onClick,
      text: label,
    });
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

  // ---- 敵ロースターの増減 ----

  function totalEnemyCount(enemies) {
    return enemies.reduce((sum, slot) => sum + slot.count, 0);
  }

  // ボス・上位ボスは陣営全体で1枠までしか置けない（ユーザー指示）。
  // excludeIndexは「自分自身は数えない」ための除外（種別チップの無効化
  // 判定に使う -- 既にボス枠になっている自分自身のせいで自分の
  // ボス系統チップが無効化されてしまわないようにする）。
  function hasOtherBossSlot(enemies, excludeIndex) {
    return enemies.some((slot, i) => i !== excludeIndex && isArenaBossKind(slot.kind));
  }

  function addEnemySlot() {
    const enemies = state.arenaConfig.enemies;
    if (enemies.length >= ENEMY_SLOT_MAX || totalEnemyCount(enemies) >= ENEMY_TOTAL_COUNT_MAX) return;
    const usedIds = new Set(enemies.map((slot) => slot.dataId));
    const candidates = arenaEnemyCatalogEntries("normal");
    const next = candidates.find((entry) => !usedIds.has(entry.id)) ?? candidates[0];
    enemies.push({ kind: "normal", dataId: next.id, count: 1, level: ARENA_DEFAULT_LEVEL });
    render();
  }

  function removeEnemySlot(index) {
    if (state.arenaConfig.enemies.length <= ENEMY_SLOT_MIN) return;
    state.arenaConfig.enemies.splice(index, 1);
    render();
  }

  // 種別を変えると、旧種別のカタログのdataIdはそのまま引き継げないため
  // 新しいカタログの先頭種族に差し替える。ボス系統に変える場合は配置
  // 体数を1に固定する。
  function onEnemyKindChange(slot, kind) {
    slot.kind = kind;
    slot.dataId = arenaEnemyCatalogEntries(kind)[0].id;
    if (isArenaBossKind(kind)) slot.count = 1;
    render();
  }

  function onEnemyCountChange(slot, rawValue) {
    let count = parseInt(rawValue, 10);
    if (!Number.isFinite(count)) count = 1;
    const otherTotal = totalEnemyCount(state.arenaConfig.enemies) - slot.count;
    const maxAllowed = Math.max(1, ENEMY_TOTAL_COUNT_MAX - otherTotal);
    slot.count = Math.max(1, Math.min(count, maxAllowed));
    render();
  }

  function enemyKindSection(slot, index) {
    return h("div", { class: "field-group" }, [
      h("p", { class: "field-label", text: "種別" }),
      h(
        "div",
        { class: "chip-row" },
        ARENA_ENEMY_CATALOG_KINDS.map((kind) => {
          const isSelected = slot.kind === kind;
          const disabled = !isSelected && isArenaBossKind(kind) && hasOtherBossSlot(state.arenaConfig.enemies, index);
          return chip(ARENA_ENEMY_KIND_LABELS[kind], isSelected, () => onEnemyKindChange(slot, kind), disabled);
        })
      ),
    ]);
  }

  function enemySpeciesSection(slot) {
    const entries = arenaEnemyCatalogEntries(slot.kind);
    return h("div", { class: "field-group" }, [
      h("p", { class: "field-label", text: "種族" }),
      h(
        "div",
        { class: "chip-row" },
        entries.map((entry) =>
          chip(entry.name, slot.dataId === entry.id, () => {
            slot.dataId = entry.id;
            render();
          })
        )
      ),
    ]);
  }

  function enemyCountSection(slot) {
    const isBoss = isArenaBossKind(slot.kind);
    const otherTotal = totalEnemyCount(state.arenaConfig.enemies) - slot.count;
    const maxAllowed = ENEMY_TOTAL_COUNT_MAX - otherTotal;
    return h("div", { class: "field-group" }, [
      h("p", { class: "field-label", text: `配置体数（陣営合計 ${totalEnemyCount(state.arenaConfig.enemies)}/${ENEMY_TOTAL_COUNT_MAX}体）` }),
      h("div", { class: "qty-input-row" }, [
        h("input", {
          type: "number",
          class: "qty-input",
          min: "1",
          max: String(maxAllowed),
          value: String(slot.count),
          disabled: isBoss,
          onchange: (e) => onEnemyCountChange(slot, e.target.value),
        }),
      ]),
    ]);
  }

  function enemyLevelSection(slot) {
    return h("div", { class: "field-group" }, [
      h("p", { class: "field-label", text: "レベル" }),
      h(
        "div",
        { class: "chip-row" },
        ARENA_LEVELS.map((level) =>
          chip(`Lv.${level}`, slot.level === level, () => {
            slot.level = level;
            render();
          })
        )
      ),
    ]);
  }

  function enemySlotCard(slot, index) {
    const isExpanded = expandedEnemyIndices.has(index);
    const data = arenaEnemyTemplate(slot.kind, slot.dataId);
    const children = [
      h("div", { class: "slot__meta" }, [
        h("span", { class: "slot__name", text: `${data.name}×${slot.count} Lv.${slot.level}` }),
        h("span", { class: "tag", text: ARENA_ENEMY_KIND_LABELS[slot.kind] }),
      ]),
      h("div", { class: "slot__actions" }, [
        button(isExpanded ? "詳細を隠す" : "詳細設定", {
          variant: "ghost",
          onClick: () => {
            if (isExpanded) expandedEnemyIndices.delete(index);
            else expandedEnemyIndices.add(index);
            render();
          },
        }),
        button("削除", { variant: "ghost", disabled: state.arenaConfig.enemies.length <= ENEMY_SLOT_MIN, onClick: () => removeEnemySlot(index) }),
      ]),
    ];
    if (isExpanded) {
      children.push(enemyKindSection(slot, index), enemySpeciesSection(slot), enemyCountSection(slot), enemyLevelSection(slot));
    }
    return h("div", { class: "panel" }, children);
  }

  // ---- 一括設定・ランダム編成 ----

  // 「重複を許可」はランダム編成の挙動だけを左右する一時的なUI設定
  // （設定オブジェクト自体には含めない -- 保存/プリセットの対象は
  // あくまで結果の編成であって、次に押すランダムボタンの挙動ではない）。
  let allyAllowDuplicates = false;

  // 味方一括変更系：個々のonLevelChangeと同じ理由で、レベルを下げて
  // 予算超過になったスキル構成は空へ戻す。render()は呼び出し側で行う。
  function applyAllyLevel(level) {
    for (const slot of state.arenaConfig.allies) {
      slot.level = level;
      const budget = arenaSkillBudgetFor(level);
      if (computeArenaSkillBudgetUsed(slot.dataId, slot.skillSelection) > budget) {
        slot.skillSelection = { trees: {}, acquisitions: [] };
      }
    }
  }

  function applyEnemyLevel(level) {
    for (const slot of state.arenaConfig.enemies) slot.level = level;
  }

  function applyAllyGrowthProfile(profileId) {
    for (const slot of state.arenaConfig.allies) slot.growthProfileId = profileId;
  }

  function applyAllyWeaponQuality(qualityId) {
    for (const slot of state.arenaConfig.allies) slot.weaponQualityId = qualityId;
  }

  function randomizeAllyWeaponTypes() {
    for (const slot of state.arenaConfig.allies) {
      const types = compatibleWeaponTypeIds(slot.dataId);
      slot.weaponTypeId = types[Math.floor(Math.random() * types.length)];
    }
  }

  function refillAllySkills(priority) {
    for (const slot of state.arenaConfig.allies) {
      slot.skillSelection = fillArenaSkillsByPriority(slot.dataId, slot.level, priority);
    }
  }

  // 味方のランダム編成：人数(2〜6)も種族も毎回引き直し、既存の枠は
  // 種族ごと全て作り直す（レベル/能力値構成/武器/スキルは「初期値」と
  // 同じ組み方=buildArenaDefaultAllySlotに戻る）。実装済み種族は7人おり
  // ALLY_MAXは6なので、重複禁止でも必ず人数分選び切れる。
  function randomizeAllies() {
    const count = ALLY_MIN + Math.floor(Math.random() * (ALLY_MAX - ALLY_MIN + 1));
    const pool = IMPLEMENTED_CHARACTER_IDS.slice();
    const picks = [];
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      picks.push(pool[idx]);
      if (!allyAllowDuplicates) pool.splice(idx, 1);
    }
    state.arenaConfig.allies = picks.map((id) => buildArenaDefaultAllySlot(id));
    expandedAllyIndices.clear();
    render();
  }

  // 敵のランダム種族選出：ボス・上位ボスを除いた母集団から重複無しで
  // speciesCount種を選び、配置体数1固定・レベルは初期値で全枠を丸ごと
  // 作り直す（既存のボス枠も含めて置き換わる）。
  function randomizeEnemies(speciesCount) {
    const pool = arenaRandomizableEnemyEntries();
    const picks = [];
    for (let i = 0; i < speciesCount && pool.length > 0; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      picks.push(pool.splice(idx, 1)[0]);
    }
    state.arenaConfig.enemies = picks.map(({ kind, dataId }) => ({ kind, dataId, count: 1, level: ARENA_DEFAULT_LEVEL }));
    expandedEnemyIndices.clear();
    render();
  }

  // 配置体数の一括設定：ボス・上位ボス枠（常に1体固定）はそのまま残す。
  // それ以外の各枠へまず最低1体ずつ確保してから、入力値-1ぶんの
  // 追加分を表示順に残り予算の許す範囲で配っていく（先に「1体ずつ」を
  // 全枠へ確保しておかないと、先頭の枠を優先して埋めた結果、後方の枠が
  // 1体も割り当てられず陣営合計の上限(12)を超えてしまう恐れがあるため
  // -- 各枠は「配置体数0」という状態を取れない前提）。
  function applyEnemyCountBulk(value) {
    const nonBossSlots = state.arenaConfig.enemies.filter((slot) => !isArenaBossKind(slot.kind));
    const bossCount = state.arenaConfig.enemies.length - nonBossSlots.length;
    let remaining = ENEMY_TOTAL_COUNT_MAX - bossCount - nonBossSlots.length;
    for (const slot of nonBossSlots) {
      const extraWanted = Math.max(0, value - 1);
      const extraGranted = Math.max(0, Math.min(extraWanted, remaining));
      slot.count = 1 + extraGranted;
      remaining -= extraGranted;
    }
    render();
  }

  function bulkLevelSection(title, onApply) {
    return h("div", { class: "field-group" }, [
      h("p", { class: "field-label", text: title }),
      h(
        "div",
        { class: "chip-row" },
        ARENA_LEVELS.map((level) =>
          button(`Lv.${level}`, {
            variant: "ghost",
            onClick: () => {
              onApply(level);
              render();
            },
          })
        )
      ),
    ]);
  }

  function bulkAllySection() {
    return [
      bulkLevelSection("レベル一括設定（味方）", applyAllyLevel),
      h("div", { class: "field-group" }, [
        h("p", { class: "field-label", text: "能力値構成一括設定（味方）" }),
        h(
          "div",
          { class: "chip-row" },
          Object.values(ARENA_GROWTH_PROFILES).map((profile) =>
            button(profile.label, {
              variant: "ghost",
              onClick: () => {
                applyAllyGrowthProfile(profile.id);
                render();
              },
            })
          )
        ),
      ]),
      h("div", { class: "field-group" }, [
        h("p", { class: "field-label", text: "武器品質一括設定（味方）" }),
        h(
          "div",
          { class: "chip-row" },
          Object.values(ARENA_WEAPON_QUALITIES).map((quality) =>
            button(quality.label, {
              variant: "ghost",
              onClick: () => {
                applyAllyWeaponQuality(quality.id);
                render();
              },
            })
          )
        ),
      ]),
      h("div", { class: "field-group" }, [
        h("p", { class: "field-label", text: "武器種一括ランダム化（味方）" }),
        h("div", { class: "chip-row" }, [
          button("ランダム化を実行", {
            variant: "ghost",
            onClick: () => {
              randomizeAllyWeaponTypes();
              render();
            },
          }),
        ]),
      ]),
      h("div", { class: "field-group" }, [
        h("p", { class: "field-label", text: "スキル構成一括再構成（味方）" }),
        h("div", { class: "chip-row" }, [
          button("成長優先", {
            variant: "ghost",
            onClick: () => {
              refillAllySkills("growth");
              render();
            },
          }),
          button("新規修得優先", {
            variant: "ghost",
            onClick: () => {
              refillAllySkills("acquisition");
              render();
            },
          }),
        ]),
      ]),
      h("div", { class: "field-group" }, [
        h("p", { class: "field-label", text: "ランダム編成（味方、人数2〜6も引き直し）" }),
        h("div", { class: "chip-row" }, [
          chip("重複を許可", allyAllowDuplicates, () => {
            allyAllowDuplicates = !allyAllowDuplicates;
            render();
          }),
          button("ランダム編成を実行", { variant: "ghost", onClick: randomizeAllies }),
        ]),
      ]),
    ];
  }

  function bulkEnemySection() {
    return [
      bulkLevelSection("レベル一括設定（敵）", applyEnemyLevel),
      h("div", { class: "field-group" }, [
        h("p", { class: "field-label", text: "ランダム種族選出（敵、ボス・上位ボスは対象外）" }),
        h(
          "div",
          { class: "chip-row" },
          Array.from({ length: ENEMY_SLOT_MAX }, (_, i) => i + 1).map((n) => button(`${n}種`, { variant: "ghost", onClick: () => randomizeEnemies(n) }))
        ),
      ]),
      h("div", { class: "field-group" }, [
        h("p", { class: "field-label", text: "配置体数一括設定（敵、ボス・上位ボスは対象外）" }),
        h("div", { class: "qty-input-row" }, [
          h("input", {
            type: "number",
            class: "qty-input",
            min: "1",
            max: String(ENEMY_TOTAL_COUNT_MAX),
            value: "1",
            onchange: (e) => applyEnemyCountBulk(Math.max(1, parseInt(e.target.value, 10) || 1)),
          }),
        ]),
      ]),
    ];
  }

  function bulkAllSection() {
    return [
      bulkLevelSection("レベル一括設定（全員）", (level) => {
        applyAllyLevel(level);
        applyEnemyLevel(level);
      }),
      h("div", { class: "field-group" }, [
        h("p", { class: "field-label", text: "変調" }),
        h("div", { class: "chip-row" }, [
          chip("発生する", state.arenaConfig.conditionEnabled === true, () => {
            state.arenaConfig.conditionEnabled = true;
            render();
          }),
          chip("発生しない", state.arenaConfig.conditionEnabled === false, () => {
            state.arenaConfig.conditionEnabled = false;
            render();
          }),
        ]),
      ]),
    ];
  }

  // ---- プリセット ----
  // 名前は自由入力にせず「プリセットN」固定にし（このプロジェクトの
  // UIは一貫してチップ/ボタン駆動でテキスト入力欄を使わない方針のため）、
  // 代わりに保存時点の中身（人数/合計体数/保存日時）を毎回その場で
  // 要約表示することで、名前が無くても中身の見分けが付くようにする。
  function presetSection() {
    const rows = [];
    for (let i = 0; i < ARENA_PRESET_LIMIT; i++) {
      const preset = state.arenaPresets[i];
      const summary = preset
        ? `プリセット${i + 1}（味方${preset.config.allies.length}・敵${preset.config.enemies.reduce((sum, s) => sum + s.count, 0)}体・${new Date(preset.savedAt).toLocaleString()}）`
        : `プリセット${i + 1}（空）`;
      rows.push(
        h("div", { class: "panel" }, [
          h("div", { class: "slot__meta" }, [h("span", { class: "slot__name", text: summary })]),
          h("div", { class: "slot__actions" }, [
            button("保存", {
              variant: "ghost",
              onClick: () => {
                saveArenaPreset(i, `プリセット${i + 1}`);
                render();
              },
            }),
            button("読込", {
              variant: "ghost",
              disabled: !preset,
              onClick: () => {
                loadArenaPreset(i);
                expandedAllyIndices.clear();
                expandedEnemyIndices.clear();
                render();
              },
            }),
            button("削除", {
              variant: "ghost",
              disabled: !preset,
              onClick: () => {
                deleteArenaPreset(i);
                render();
              },
            }),
          ]),
        ])
      );
    }
    return [h("p", { class: "field-label", text: "プリセット（現在の設定を10枠まで保存できます）" }), h("div", { class: "slot-list" }, rows)];
  }

  // Step7：現在の設定一式から仮インスタンスを組み立て、battle.jsの
  // アリーナモードへ渡す。敵は種族枠ごとにcount体ぶん個別インスタンス化
  // する（同じ枠でも1体ずつ独立したHP/成長を持つ、実際の複数体
  // モンスターと同じ扱い）。ここで作るインスタンスはstate.formationSlots
  // /warehouseItems等の実データを一切経由しない、渡し切りの使い捨て
  // オブジェクト -- battle.js側もアリーナモードでは何も書き戻さない。
  function startArenaBattle() {
    const config = state.arenaConfig;
    if (!validateArenaConfig(config)) return;
    const allies = config.allies.map((slot) => createArenaCharacter(slot));
    const enemies = config.enemies.flatMap((slot) =>
      Array.from({ length: slot.count }, () => createArenaEnemy({ kind: slot.kind, dataId: slot.dataId, level: slot.level }))
    );
    api.callScene("battle", { mode: "arena", allies, enemies, conditionEnabled: config.conditionEnabled });
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
        h("div", { class: "row-between" }, [
          h("p", {
            class: "field-label",
            text: `敵陣営（${config.enemies.length}/${ENEMY_SLOT_MAX}種、合計${totalEnemyCount(config.enemies)}/${ENEMY_TOTAL_COUNT_MAX}体）`,
          }),
          button("＋ 種族を追加", {
            variant: "ghost",
            disabled: config.enemies.length >= ENEMY_SLOT_MAX || totalEnemyCount(config.enemies) >= ENEMY_TOTAL_COUNT_MAX,
            onClick: addEnemySlot,
          }),
        ]),
      ]),
      h("div", { class: "slot-list" }, config.enemies.map((slot, index) => enemySlotCard(slot, index))),
      h("p", { class: "field-label", text: "一括設定・ランダム編成" }),
      ...bulkAllySection(),
      ...bulkEnemySection(),
      ...bulkAllSection(),
      ...presetSection(),
    ];

    renderScreen(container, {
      eyebrow: "TRAINING GROUNDS",
      title: "訓練所",
      subtitle: "任意の組み合わせで戦闘をシミュレーションできます。",
      body,
      onPause: () => api.callScene("pause"),
      actions: [button("この設定で訓練を開始", { variant: "primary", onClick: startArenaBattle }), button("戻る", { variant: "ghost", onClick: () => api.closeScene() })],
    });
  }

  render();
  return { onResume: () => render() };
}

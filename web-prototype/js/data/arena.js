// 訓練所（アリーナモード）専用のデータ層。ここで生成するユニットは
// 全て「仮のインスタンス」であり、state.formationSlots/warehouseItems
// など実際のセーブデータには一切触れない・書き戻さない -- プレイヤーが
// 任意の組み合わせを気軽に試せる、影響の無いシミュレーション環境と
// いう位置付けのため（ユーザー指示）。
//
// 実際のラン中の雇用・レベルアップ・武器製造は resourceCatalog.js /
// characterSkills.js が担う各関数（createCharacterFromData・
// createMonsterFromData・levelUpMonsterGrowth・randomizeSkillProgression
// 等）を経由するが、それらは意図的にランダム性を持つ（雇用候補の
// バリエーションを出すため）。訓練所は「同じ設定なら毎回同じ強さで
// 戦える」ことが重要なテストツールなので、能力値構成・レベル到達分の
// 成長配分はこのファイル独自の決定論的なアルゴリズム
// （allocateGrowthForSum）で行う。武器の性能値のうち「◯◯支給品」系の
// 3ティアだけは、ユーザー指示により明示的にランダム（ガチャ的性質）の
// ままにする。
import {
  CHARACTER_DATA,
  IMPLEMENTED_CHARACTER_IDS,
  MONSTER_DATA,
  BOSS_MONSTER_DATA,
  ELITE_MONSTER_DATA,
  ELITE_BOSS_MONSTER_DATA,
  INITIAL_EMPLOYMENT_DATA,
  computeMaxHp,
  compatibleWeaponTypeIds,
  forgeWeaponWithStats,
  rollAmberSugarMineralStats,
} from "./resourceCatalog.js";
import { CHARACTER_BASE_SKILLS, CHARACTER_SKILL_GROWTH, CHARACTER_SKILL_ACQUISITIONS, computeSkillEnhancementTarget } from "./characterSkills.js";

const GROWTH_STAT_KEYS = ["attack", "defence", "power", "wisdom", "sociality"];

// ---------------------------------------------------------------------
// レベル
// ---------------------------------------------------------------------
// 隊員/モンスター共通、プレイヤーが選べる10段階（ユーザー指定）。
export const ARENA_LEVELS = [1, 5, 10, 15, 20, 25, 30, 40, 50, 99];

// ---------------------------------------------------------------------
// 能力値構成（隊員専用）
// ---------------------------------------------------------------------
// ratio: null は「オリジナル」（そのキャラクター本来の成長比率、
// CHARACTER_DATA[dataId].growthをそのまま使う）を示す特別値。
export const ARENA_GROWTH_PROFILES = {
  original: { id: "original", label: "オリジナル", ratio: null },
  balanced: { id: "balanced", label: "バランス<1/1/1/1/1>", ratio: { attack: 1, defence: 1, power: 1, wisdom: 1, sociality: 1 } },
  aggressive: { id: "aggressive", label: "好戦的<5/2/2/2/2>", ratio: { attack: 5, defence: 2, power: 2, wisdom: 2, sociality: 2 } },
  defensive: { id: "defensive", label: "保守的<2/5/2/2/2>", ratio: { attack: 2, defence: 5, power: 2, wisdom: 2, sociality: 2 } },
  intense: { id: "intense", label: "刺激的<2/2/5/2/2>", ratio: { attack: 2, defence: 2, power: 5, wisdom: 2, sociality: 2 } },
  intellectual: { id: "intellectual", label: "理知的<2/2/2/5/2>", ratio: { attack: 2, defence: 2, power: 2, wisdom: 5, sociality: 2 } },
  diplomatic: { id: "diplomatic", label: "外交的<2/2/2/2/5>", ratio: { attack: 2, defence: 2, power: 2, wisdom: 2, sociality: 5 } },
};

// 比率(ratio)をtargetSumぴったりに配分する決定論的な最大剰余法。
// ratio内の重み0のステータスは常に0のまま（「オリジナル」で本来伸び
// ない能力値を、配分の都合で無理やり伸ばしてしまわないため）。
// GROWTH_STAT_KEYS固定順で端数の大きい順に1ずつ配る（同点は先着順）ので、
// 同じ入力なら必ず同じ結果になる。
export function allocateGrowthForSum(ratio, targetSum) {
  const ratioSum = GROWTH_STAT_KEYS.reduce((sum, key) => sum + (ratio[key] ?? 0), 0);
  if (ratioSum <= 0 || targetSum <= 0) {
    return Object.fromEntries(GROWTH_STAT_KEYS.map((key) => [key, 0]));
  }
  const raw = GROWTH_STAT_KEYS.map((key) => (targetSum * (ratio[key] ?? 0)) / ratioSum);
  const floored = raw.map(Math.floor);
  let remainder = targetSum - floored.reduce((sum, value) => sum + value, 0);
  const order = GROWTH_STAT_KEYS.map((key, index) => ({ key, index, frac: raw[index] - floored[index] }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  const result = Object.fromEntries(GROWTH_STAT_KEYS.map((key, index) => [key, floored[index]]));
  for (let i = 0; i < remainder; i++) result[order[i % order.length].key] += 1;
  return result;
}

// 隊員のレベルLvに対応する成長合計（computeLevelの逆算：growthSum-4=Lv）。
export function characterGrowthSumForLevel(level) {
  return level + 4;
}

// モンスター/上位個体/ボス/上位ボスのレベルLvに対応する成長合計
// （computeMonsterLevelの逆算：growthSum-2=Lv、テンプレート由来のカタログ
// 全てで共通）。
export function monsterGrowthSumForLevel(level) {
  return level + 2;
}

// dataId（CHARACTER_DATAのキー）・能力値構成プリセットid・目標レベルから、
// 決定論的な成長値オブジェクトを組み立てる。
export function computeArenaCharacterGrowth(dataId, growthProfileId, level) {
  const profile = ARENA_GROWTH_PROFILES[growthProfileId] ?? ARENA_GROWTH_PROFILES.original;
  const ratio = profile.ratio ?? CHARACTER_DATA[dataId].growth;
  return allocateGrowthForSum(ratio, characterGrowthSumForLevel(level));
}

// ---------------------------------------------------------------------
// 敵カタログ横断ヘルパー（通常種/上位個体/ボス/上位ボス）
// ---------------------------------------------------------------------
// アリーナの敵種族選択が参照する4カタログを種別付きでまとめる。
export const ARENA_ENEMY_CATALOG_KINDS = ["normal", "elite", "boss", "eliteBoss"];

export const ARENA_ENEMY_KIND_LABELS = { normal: "通常種", elite: "上位個体", boss: "ボス", eliteBoss: "上位ボス" };

// ボス・上位ボスの各枠は、配置体数が常に1体固定（ユーザー指示）。
export function isArenaBossKind(kind) {
  return kind === "boss" || kind === "eliteBoss";
}

const ENEMY_CATALOGS_BY_KIND = {
  normal: MONSTER_DATA,
  elite: ELITE_MONSTER_DATA,
  boss: BOSS_MONSTER_DATA,
  eliteBoss: ELITE_BOSS_MONSTER_DATA,
};

// {kind, dataId}のペアで一意に敵テンプレートを引く（同じdataIdが複数
// カタログを跨いで重複することは無い前提だが、kindを明示することで
// 種族選択枠のUIが「通常種/上位個体/ボス/上位ボス」をタグ表示できる
// ようにする）。
export function arenaEnemyTemplate(kind, dataId) {
  const data = ENEMY_CATALOGS_BY_KIND[kind]?.[dataId];
  if (!data) throw new Error(`unknown arena enemy template: ${kind}/${dataId}`);
  return data;
}

// 指定した種別（通常種/上位個体/ボス/上位ボス）のカタログ全entryを、
// そのカタログの並び順のまま返す（種族選択チップ列の選択肢生成専用）。
export function arenaEnemyCatalogEntries(kind) {
  return Object.values(ENEMY_CATALOGS_BY_KIND[kind]);
}

// 種族選択の「ランダム選出」機能の対象母集団: 通常種+上位個体のみ
// （ボス・上位ボスは、ユーザー指示によりランダム抽選の対象から除外し、
// 手動選択でのみ選べるようにする）。
export function arenaRandomizableEnemyEntries() {
  const entries = [];
  for (const kind of ["normal", "elite"]) {
    for (const dataId of Object.keys(ENEMY_CATALOGS_BY_KIND[kind])) entries.push({ kind, dataId });
  }
  return entries;
}

export function arenaEnemyGrowth(kind, dataId, level) {
  const data = arenaEnemyTemplate(kind, dataId);
  return allocateGrowthForSum(data.growth, monsterGrowthSumForLevel(level));
}

// ---------------------------------------------------------------------
// 武器品質ティア
// ---------------------------------------------------------------------
// 固定ティア（模造品/実用品/一級品）はstatsが5値とも同じ固定値。
// ランダムティア（◯◯支給品）はrange[totalPoints最小,最大]からランダムに
// 選んだ合計値をrollAmberSugarMineralStatsで5値に配分する（性能値は
// 1つのステータスにつき最大4、資源システムの琥珀糖鉱石と同じ配分方式
// -- ユーザー指示により、この3ティアだけは明示的にランダムのまま）。
// WEAPON_SKILL_UPGRADE_THRESHOLD(14)との対応：一級品(合計20)・特製支給品
// (14〜20)は常に閾値以上、量産(0〜6)・一般(7〜13)は常に閾値未満になり、
// 「一級品か特製支給品でなければ改良後スキルにはならない」という
// ユーザー指定の条件を、既存の武器固有スキル改良ロジックだけで自然に
// 満たす。
export const ARENA_WEAPON_QUALITIES = {
  imitation: { id: "imitation", label: "模造品(オール0)", fixedStats: { sweetness: 0, hardness: 0, poisonResist: 0, stability: 0, flexibility: 0 } },
  practical: { id: "practical", label: "実用品(オール2)", fixedStats: { sweetness: 2, hardness: 2, poisonResist: 2, stability: 2, flexibility: 2 } },
  premium: { id: "premium", label: "一級品(オール4)", fixedStats: { sweetness: 4, hardness: 4, poisonResist: 4, stability: 4, flexibility: 4 } },
  mass: { id: "mass", label: "量産支給品(評価C以下)", randomRange: [0, 6] },
  standard: { id: "standard", label: "一般支給品(評価B)", randomRange: [7, 13] },
  special: { id: "special", label: "特製支給品(評価A以上)", randomRange: [14, 20] },
};

function rollArenaWeaponStats(qualityId) {
  const quality = ARENA_WEAPON_QUALITIES[qualityId];
  if (quality.fixedStats) return { ...quality.fixedStats };
  const [min, max] = quality.randomRange;
  const totalPoints = min + Math.floor(Math.random() * (max - min + 1));
  return rollAmberSugarMineralStats(totalPoints);
}

export function createArenaWeapon(weaponTypeId, qualityId) {
  return forgeWeaponWithStats(weaponTypeId, rollArenaWeaponStats(qualityId));
}

export { compatibleWeaponTypeIds as arenaCompatibleWeaponTypeIds };

// ---------------------------------------------------------------------
// スキル構成（隊員専用）：成長ツリーの木構造展開
// ---------------------------------------------------------------------
// CHARACTER_SKILL_GROWTH[dataId]はフラットな{from,to}の列（複数のツリー・
// 分岐を含みうる、例：ショコラ・ビターテイストのbitterFeelはcacaoFeel/
// milkFeelの2方向に分岐する）。これを「根本のスキルごとに1つのツリー」
// へ組み直し、各ノードに根本からのdepth（=強化を何回消費してそこへ
// 到達するか）とpath（根本からそのノードまでの経路、選択時に
// character.skillsへ書き込むのは経路の末尾＝現在のスキルidのみで良い）
// を持たせる。チェック欄UIは「ツリーごとに、これらのノードのうち
// 1つだけを選ぶラジオ群」として使う想定。
export function computeSkillTrees(dataId) {
  const entries = CHARACTER_SKILL_GROWTH[dataId] ?? [];
  const childrenOf = new Map();
  const froms = new Set();
  const tos = new Set();
  for (const { from, to } of entries) {
    froms.add(from);
    tos.add(to);
    if (!childrenOf.has(from)) childrenOf.set(from, []);
    childrenOf.get(from).push(to);
  }
  const roots = [...froms].filter((id) => !tos.has(id));
  return roots.map((root) => {
    const nodes = [];
    const walk = (skillId, depth, path) => {
      nodes.push({ skillId, depth, path });
      for (const child of childrenOf.get(skillId) ?? []) walk(child, depth + 1, [...path, child]);
    };
    walk(root, 0, [root]);
    return { root, nodes };
  });
}

// 各キャラクターの成長ツリーの根本を「Main/Prep」で分類したもの（battle.js
// のMAIN_MODULES/PREP_MODULESへの実際の登録先を目視で確認して手入力 --
// 7人とも根本はMainツリー1本、Prepツリー1〜2本という構成で揃っている。
// サンライト・サッカルムだけPrepツリーが2本（highPlot/lowPlot）ある点が
// 「初期値」のスキル埋め方の説明で名指しされている理由。battle.js側で
// これらのモジュールの登録先を変更した場合はここも合わせて直す必要が
// ある）。デフォルト埋め（fillArenaSkillsByPriority）専用の参照データ。
const CHARACTER_SKILL_TREE_ROLES = {
  flakeSugar: { mainRoot: "guardingHand", prepRoots: ["guardAlly"] },
  cubeSugar: { mainRoot: "attackingHand", prepRoots: ["retreatCall"] },
  honeyScrew: { mainRoot: "honeyBeat", prepRoots: ["festivalHunch"] },
  chocolatBitterTaste: { mainRoot: "bitterFeel", prepRoots: ["shadowJustice"] },
  lollipopSpiral: { mainRoot: "supportComfort", prepRoots: ["sisterCheer"] },
  flawlessNoColor: { mainRoot: "flush", prepRoots: ["check"] },
  sunlightSaccharum: { mainRoot: "prescription", prepRoots: ["highPlot", "lowPlot"] },
};

// tree内で、根本から数えてdepth段目にあたる「優先ノード」を返す
// （分岐がある場合は常にCHARACTER_SKILL_GROWTHで先に列挙されている方の
// 枝を辿る -- ショコラ・ビターテイストのbitterFeelがcacaoFeel側を優先
// するのはこの規則により自動的に決まる、キャラクター別の特別扱いでは
// ない）。depth段目まで伸ばせない場合はそのツリーの最大到達ノードを
// 返す。
function preferredNodeAtDepth(tree, depth) {
  let current = tree.nodes.find((n) => n.depth === 0);
  for (let d = 1; d <= depth; d++) {
    const next = tree.nodes.find((n) => n.depth === d && n.path[d - 1] === current.skillId);
    if (!next) break;
    current = next;
  }
  return current;
}

// selectionのtreeを1段だけ優先枝方向へ伸ばす（伸ばせなければfalseを
// 返す）。fillArenaSkillsByPriority専用の内部ヘルパー。
function growTreeOneStep(tree, selection) {
  if (!tree) return false;
  const currentChosen = selection.trees[tree.root] ?? tree.root;
  const currentNode = tree.nodes.find((n) => n.skillId === currentChosen);
  const nextNode = preferredNodeAtDepth(tree, currentNode.depth + 1);
  if (nextNode.depth === currentNode.depth) return false;
  selection.trees[tree.root] = nextNode.skillId;
  return true;
}

// dataId・レベルから、スキル構成の一括埋め直しを行う。priorityで
// 「成長優先」（デフォルトの並び：初期修得Mainスキルの成長1段階目→
// 初期修得Prepスキルの成長→初期修得Mainスキルの成長2段階目→
// （サンライトのみ）2つ目の初期修得Prepスキルの成長→残りを新規修得で
// 埋める）と「新規修得優先」（新規修得を表示順に先に埋めてから、余った
// 予算で同じ順番の成長を行う）を切り替える。「初期値」欄の説明は
// priority: "growth" の埋め方そのもの。
export function fillArenaSkillsByPriority(dataId, level, priority = "growth") {
  const selection = { trees: {}, acquisitions: [] };
  const roles = CHARACTER_SKILL_TREE_ROLES[dataId];
  if (!roles) return selection;
  const trees = computeSkillTrees(dataId);
  const mainTree = trees.find((t) => t.root === roles.mainRoot);
  const prepTrees = roles.prepRoots.map((root) => trees.find((t) => t.root === root));
  const growthSteps = [
    () => growTreeOneStep(mainTree, selection),
    () => growTreeOneStep(prepTrees[0], selection),
    () => growTreeOneStep(mainTree, selection),
    ...(prepTrees[1] ? [() => growTreeOneStep(prepTrees[1], selection)] : []),
  ];
  const acquisitionIds = CHARACTER_SKILL_ACQUISITIONS[dataId] ?? [];

  let remaining = computeSkillEnhancementTarget(level);
  const spendOnGrowth = () => {
    for (const step of growthSteps) {
      if (remaining <= 0) break;
      if (step()) remaining -= 1;
    }
  };
  const spendOnAcquisitions = () => {
    for (const skillId of acquisitionIds) {
      if (remaining <= 0) break;
      selection.acquisitions.push(skillId);
      remaining -= 1;
    }
  };

  if (priority === "acquisition") {
    spendOnAcquisitions();
    spendOnGrowth();
  } else {
    spendOnGrowth();
    spendOnAcquisitions();
  }
  return selection;
}

// dataIdのスキル選択状態: {rootSkillId: 選んだノードのskillId} + 新規修得
// skillIdの配列、から実際のcharacter.skills配列を組み立てる。ツリーは
// 選んだノードのskillIdだけを残す（applySkillEnhancementの「fromを
// 除いてtoを積む」置き換えを、途中経過を経ずに最終状態だけ直接作る形）。
export function resolveArenaSkillIds(dataId, selection) {
  const base = CHARACTER_BASE_SKILLS[dataId];
  if (!base) return null;
  const trees = computeSkillTrees(dataId);
  const skills = base.map((skillId) => {
    const tree = trees.find((t) => t.root === skillId);
    if (!tree) return skillId;
    const chosen = selection.trees?.[tree.root] ?? tree.root;
    return chosen;
  });
  for (const skillId of selection.acquisitions ?? []) skills.push(skillId);
  return skills;
}

// 選択状態が消費する強化予算（ツリーは選んだノードのdepth、新規修得は
// 1件につき1）。computeSkillEnhancementTarget(level)と比較して、予算
// 超過を検出するのに使う。
export function computeArenaSkillBudgetUsed(dataId, selection) {
  const trees = computeSkillTrees(dataId);
  let used = 0;
  for (const tree of trees) {
    const chosen = selection.trees?.[tree.root] ?? tree.root;
    const node = tree.nodes.find((n) => n.skillId === chosen);
    used += node ? node.depth : 0;
  }
  used += (selection.acquisitions ?? []).length;
  return used;
}

export function arenaSkillBudgetFor(level) {
  return computeSkillEnhancementTarget(level);
}

// ---------------------------------------------------------------------
// 仮ユニットの生成
// ---------------------------------------------------------------------
// createCharacterFromData（resourceCatalog.js）と同じ形のインスタンスを、
// 訓練所の設定一式から直接組み立てる。実データの雇用/レベルアップ経路
// （通常雇用のランダム成長・randomizeSkillProgressionのランダム強化）
// を一切経由しない、完全に明示的な生成。
export function createArenaCharacter({ dataId, level, growthProfileId = "original", weaponTypeId, weaponQualityId, skillSelection = {} }) {
  if (!IMPLEMENTED_CHARACTER_IDS.includes(dataId)) throw new Error(`arena: unimplemented character dataId: ${dataId}`);
  const data = CHARACTER_DATA[dataId];
  const growth = computeArenaCharacterGrowth(dataId, growthProfileId, level);
  const weapon = weaponTypeId ? createArenaWeapon(weaponTypeId, weaponQualityId) : null;
  return {
    id: `arena-${dataId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    dataId,
    name: data.name,
    level,
    growth,
    currentHp: computeMaxHp(growth),
    condition: 0,
    positiveCondition: 0,
    skills: resolveArenaSkillIds(dataId, skillSelection),
    // 予算の上限(computeSkillEnhancementTarget)ではなく、実際に
    // skillSelectionが消費した分を記録する（成長ツリーの内容が予算より
    // 少ない高レベル帯では上限と一致しないことがある -- 実際のランの
    // randomizeSkillProgressionと同じ扱い）。
    skillEnhancementCount: computeArenaSkillBudgetUsed(dataId, skillSelection),
    weapon,
    equippedCoatings: { head: null, shoulder: null, arm: null, torso: null, leg: null },
    synergies: data.synergies,
  };
}

// createMonsterFromData等（resourceCatalog.js）と同じ形のインスタンスを、
// 訓練所の設定（種別kind+dataId+レベル）から直接組み立てる。
export function createArenaEnemy({ kind, dataId, level }) {
  const data = arenaEnemyTemplate(kind, dataId);
  const growth = arenaEnemyGrowth(kind, dataId, level);
  return {
    id: `arena-${dataId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    dataId,
    name: data.name,
    level,
    growth,
    currentHp: computeMaxHp(growth),
    skills: [],
    weapon: null,
    attribute: data.attribute,
  };
}

// ---------------------------------------------------------------------
// 初期値（ユーザー指定の「初期値」欄そのもの）
// ---------------------------------------------------------------------
export const ARENA_DEFAULT_LEVEL = 5;
export const ARENA_DEFAULT_GROWTH_PROFILE_ID = "original";
export const ARENA_DEFAULT_WEAPON_QUALITY_ID = "practical"; // 実用品

// 味方陣営の初期値：実装済み7人のうち先頭3人（フレーク/キューブ/ハニー、
// IMPLEMENTED_CHARACTER_IDSの並び順）。
export const ARENA_DEFAULT_ALLY_DATA_IDS = IMPLEMENTED_CHARACTER_IDS.slice(0, 3);

// 1枠ぶんの味方初期設定（種族dataIdから残りを組み立てる）。武器種は
// 初期雇用と同じ組み合わせ（INITIAL_EMPLOYMENT_DATA）を使い、品質だけ
// ザラメ鉱石相当(低)ではなく実用品(オール2)にする。スキル構成は
// 「成長優先」のデフォルト埋め方（fillArenaSkillsByPriority）で埋める。
export function buildArenaDefaultAllySlot(dataId) {
  const level = ARENA_DEFAULT_LEVEL;
  return {
    dataId,
    level,
    growthProfileId: ARENA_DEFAULT_GROWTH_PROFILE_ID,
    weaponTypeId: INITIAL_EMPLOYMENT_DATA[dataId].weaponTypeId,
    weaponQualityId: ARENA_DEFAULT_WEAPON_QUALITY_ID,
    skillSelection: fillArenaSkillsByPriority(dataId, level, "growth"),
  };
}

// 敵陣営の初期値：カルメヤ犬×1・メレンゲ猫×1・チョコロック×1
// （ユーザー指定）。
export const ARENA_DEFAULT_ENEMY_SLOTS = [
  { kind: "normal", dataId: "karumeDog", count: 1 },
  { kind: "normal", dataId: "merengeCat", count: 1 },
  { kind: "normal", dataId: "chocoRock", count: 1 },
];

export function buildArenaDefaultEnemySlot(slot) {
  return { kind: slot.kind, dataId: slot.dataId, count: slot.count, level: ARENA_DEFAULT_LEVEL };
}

// アリーナ設定オブジェクト全体の初期値（state.js側の保存形と合わせる、
// Step2でstate.jsに保存/復元させる際にそのまま初期値として使う）。
export function buildArenaDefaultConfig() {
  return {
    allies: ARENA_DEFAULT_ALLY_DATA_IDS.map((dataId) => buildArenaDefaultAllySlot(dataId)),
    enemies: ARENA_DEFAULT_ENEMY_SLOTS.map((slot) => buildArenaDefaultEnemySlot(slot)),
    conditionEnabled: true,
  };
}

// ---------------------------------------------------------------------
// 設定オブジェクトの妥当性検証・文字列エクスポート/インポート
// ---------------------------------------------------------------------
// ユーザー指示：プリセットのエクスポート/インポートは「暗号化」までは
// 不要で、共有・バックアップ目的で十分な可逆エンコード（JSON→Base64）
// で良い。設定オブジェクト自体にプレイヤーが入力した文字列（プリセット
// 名など）は含まれず、id・数値・真偽値のみで構成されるため、UTF-8を
// 気にする必要のあるbtoa/atob単体でも安全に往復できる（念のため
// encodeURIComponent/decodeURIComponentで挟んでおく）。インポートは
// 「他人から受け取った/手で書き換えた文字列」を信頼せずに済むよう、
// 復元した内容をvalidateArenaConfigで検証し、不正なら失敗を示すnullを
// 返す。

function isValidArenaAllySlot(slot) {
  if (!slot || !IMPLEMENTED_CHARACTER_IDS.includes(slot.dataId)) return false;
  if (!ARENA_LEVELS.includes(slot.level)) return false;
  if (!ARENA_GROWTH_PROFILES[slot.growthProfileId]) return false;
  if (slot.weaponTypeId != null && !compatibleWeaponTypeIds(slot.dataId).includes(slot.weaponTypeId)) return false;
  if (slot.weaponQualityId != null && !ARENA_WEAPON_QUALITIES[slot.weaponQualityId]) return false;
  if (typeof slot.skillSelection !== "object" || slot.skillSelection === null) return false;
  return true;
}

function isValidArenaEnemySlot(slot) {
  if (!slot || !ARENA_ENEMY_CATALOG_KINDS.includes(slot.kind)) return false;
  try {
    arenaEnemyTemplate(slot.kind, slot.dataId);
  } catch {
    return false;
  }
  if (!ARENA_LEVELS.includes(slot.level)) return false;
  return Number.isInteger(slot.count) && slot.count >= 1 && slot.count <= 12;
}

// 訓練所の設定一式が、実際にcreateArenaCharacter/createArenaEnemyへ渡して
// 安全な形をしているかを検証する。インポート文字列だけでなく、将来の
// UI側の入力バリデーションにもそのまま使える想定。
export function validateArenaConfig(config) {
  if (!config || !Array.isArray(config.allies) || !Array.isArray(config.enemies)) return false;
  if (config.allies.length < 2 || config.allies.length > 6) return false;
  if (config.enemies.length < 1 || config.enemies.length > 5) return false;
  if (!config.allies.every(isValidArenaAllySlot)) return false;
  if (!config.enemies.every(isValidArenaEnemySlot)) return false;
  const totalEnemyCount = config.enemies.reduce((sum, slot) => sum + slot.count, 0);
  if (totalEnemyCount > 12) return false;
  const bossSlots = config.enemies.filter((slot) => slot.kind === "boss" || slot.kind === "eliteBoss");
  if (bossSlots.length > 1 || bossSlots.some((slot) => slot.count !== 1)) return false;
  if (typeof config.conditionEnabled !== "boolean") return false;
  return true;
}

export function encodeArenaConfig(config) {
  return btoa(encodeURIComponent(JSON.stringify(config)));
}

// 不正な文字列（破損・改ざん・全くの無関係な文字列）はnullを返す
// （JSON化・Base64デコードの失敗、および形式検証の失敗のどちらも）。
export function decodeArenaConfig(text) {
  let config;
  try {
    config = JSON.parse(decodeURIComponent(atob(text.trim())));
  } catch {
    return null;
  }
  return validateArenaConfig(config) ? config : null;
}

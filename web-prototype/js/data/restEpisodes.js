// 休憩イベント用のダミー台本71本（仮実装：内容は全て
// プレースホルダーのテキストで、報酬もザラメ鉱石×5で統一）。
//
// 構成（ユーザー仕様の[1〜71]通し番号に対応）：
//  [1-42]  隊員個別エピソード6段階×7人 -- 独白1→独白2→裏話1→裏話2→
//          真相→思い出の順に必ず抽選される（順序厳守）。抽選対象は
//          その隊員が編成にいる時のみ。
//  [43-48] フレーク&キューブのペアエピソード（6本）
//  [49-52] ハニー&ショコラのペアエピソード（4本）
//  [53-58] ロリポップ×他の個別アーク持ち6人、各1本ずつ（6本）
//  [59-64] サンライト×他の個別アーク持ち6人、各1本ずつ（6本）
//  [65-70] フローレス×他の個別アーク持ち6人、各1本ずつ（6本）
//  [71]    ダミー（個別アーク持ちの隊員が編成に1人もいない時の保険）
//
// 各descriptorは episode.js の抽選ロジック（pickRestEpisode）が使う
// メタ情報（id/requiredCharacterIds/characterId/stepIndex）と、実際に
// interpreterへ渡すscript本体を持つ。scriptの形はscripts.jsのビートと
// 同じ（単純な1本道：導入ナレーション→ザラメ鉱石×5のend）。
import { CHARACTER_DATA } from "./resourceCatalog.js";

// 隊員個別エピソード7人（過去に固有スキル実装の対象だった顔ぶれと同じ
// -- ペア枠[53-70]の「相手」も全員この中から選ばれる）。
export const NAMED_REST_CHARACTER_IDS = [
  "flakeSugar",
  "cubeSugar",
  "honeyScrew",
  "chocolatBitterTaste",
  "lollipopSpiral",
  "flawlessNoColor",
  "sunlightSaccharum",
];

// 表記用のファーストネーム（ペアエピソードのタイトル文言に使う -- 隊員
// 個別エピソード本文の［隊員名］にはCHARACTER_DATAのフルネームを使う）。
const FIRST_NAME = {
  flakeSugar: "フレーク",
  cubeSugar: "キューブ",
  honeyScrew: "ハニー",
  chocolatBitterTaste: "ショコラ",
  lollipopSpiral: "ロリポップ",
  flawlessNoColor: "フローレス",
  sunlightSaccharum: "サンライト",
};

function fullName(characterId) {
  return CHARACTER_DATA[characterId].name;
}

// 単純な1本道の台本：導入ナレーション1行→ザラメ鉱石×5を獲得して終了。
function simpleRewardScript(text) {
  return {
    startId: "b1",
    beats: {
      b1: { text, next: "end" },
      end: { type: "end", effects: [{ kind: "grantRigidResource", id: "coarseSugarMineral", amount: 5 }] },
    },
  };
}

// 探査記録画面（archive.js）でのタイトル表記用の全角数字（1〜6で足りる）。
const ZENKAKU_DIGITS = ["", "１", "２", "３", "４", "５", "６"];

const ARC_STEPS = [
  { key: "monologue1", titleLabel: "独白１", text: (name) => `これは${name}の独白その１です。` },
  { key: "monologue2", titleLabel: "独白２", text: (name) => `これは${name}の独白その２です。` },
  { key: "backstory1", titleLabel: "裏話１", text: (name) => `これは${name}の裏話その１です。` },
  { key: "backstory2", titleLabel: "裏話２", text: (name) => `これは${name}の裏話その２です。` },
  { key: "truth", titleLabel: "真相", text: (name) => `これは${name}の真相です。` },
  { key: "memory", titleLabel: "思い出", text: (name) => `これは${name}の思い出です。` },
];

// [1-42] 隊員個別エピソード：7人×6段階＝42本。タイトルは
// 「隊員フレークの独白１」のような短い表記（探査記録画面用、本文とは
// 別）。
function buildSoloEpisodes() {
  const episodes = [];
  for (const characterId of NAMED_REST_CHARACTER_IDS) {
    const name = fullName(characterId);
    const firstName = FIRST_NAME[characterId];
    ARC_STEPS.forEach((step, stepIndex) => {
      episodes.push({
        id: `rest-solo-${characterId}-${step.key}`,
        title: `隊員${firstName}の${step.titleLabel}`,
        requiredCharacterIds: [characterId],
        characterId,
        stepIndex,
        script: simpleRewardScript(step.text(name)),
      });
    });
  }
  return episodes;
}

// [43-48]/[49-52] 固定ペア（人数固定のエピソード数：フレーク&キューブは
// 6本、ハニー&ショコラは4本）。タイトルは「ハニーとショコラ その２」の
// ような表記。
function buildFixedDuoEpisodes(idA, idB, count) {
  const episodes = [];
  const labelA = FIRST_NAME[idA];
  const labelB = FIRST_NAME[idB];
  for (let i = 1; i <= count; i++) {
    episodes.push({
      id: `rest-duo-${idA}-${idB}-${i}`,
      title: `${labelA}と${labelB} その${ZENKAKU_DIGITS[i]}`,
      requiredCharacterIds: [idA, idB],
      script: simpleRewardScript(`これは${labelA}と${labelB}のエピソード［${i}］です。`),
    });
  }
  return episodes;
}

// [53-58]/[59-64]/[65-70] centerId×他の個別アーク持ち6人、各1本ずつ。
// タイトルは「ロリポップとキューブ」のような表記（番号なし、相手ごとに
// 1本しかないため）。
function buildStarDuoEpisodes(centerId) {
  const episodes = [];
  const centerLabel = FIRST_NAME[centerId];
  for (const partnerId of NAMED_REST_CHARACTER_IDS) {
    if (partnerId === centerId) continue;
    episodes.push({
      id: `rest-duo-${centerId}-${partnerId}`,
      title: `${centerLabel}と${FIRST_NAME[partnerId]}`,
      requiredCharacterIds: [centerId, partnerId],
      script: simpleRewardScript(`これは${centerLabel}と${FIRST_NAME[partnerId]}のエピソードです。`),
    });
  }
  return episodes;
}

// [71] ダミー：個別アーク持ちの隊員が編成に1人もいない場合の保険
// （requiredCharacterIdsが空＝常に抽選対象）。
const DUMMY_EPISODE = {
  id: "rest-dummy",
  title: "ダミー",
  requiredCharacterIds: [],
  script: simpleRewardScript("これはダミーのエピソードです。"),
};

export const REST_EPISODE_POOL = [
  ...buildSoloEpisodes(), // [1-42]
  ...buildFixedDuoEpisodes("flakeSugar", "cubeSugar", 6), // [43-48]
  ...buildFixedDuoEpisodes("honeyScrew", "chocolatBitterTaste", 4), // [49-52]
  ...buildStarDuoEpisodes("lollipopSpiral"), // [53-58]
  ...buildStarDuoEpisodes("sunlightSaccharum"), // [59-64]
  ...buildStarDuoEpisodes("flawlessNoColor"), // [65-70]
  DUMMY_EPISODE, // [71]
];

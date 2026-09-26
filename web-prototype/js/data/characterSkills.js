// キャラクタースキルの成長／新規修得（「スキル強化」システム）。武器
// スキル改良（resourceCatalog.jsのcomputeWeaponSkillId、性能値合計を
// 都度参照するだけの別方式）とは違い、こちらは「キャラクターのレベルが
// 5刻みの閾値（10, 15, 20, …）に達するたびに、その時点で実行可能な
// 項目（未実行の成長／新規修得）のうちプレイヤーが選んだ1つだけを実行
// できる」という、明示的な選択を伴う進行システム。
// このファイルは純粋なデータ＋ロジックのみを持ち、シーン（UI）側には
// 一切依存しない -- js/data/resourceCatalog.js（キャラクター生成）と
// js/scenes/skillEnhance.js・squadFormation.js・exploration.js（強化
// 画面の呼び出し）の両方から参照される。

// 各キャラクターの初期修得スキル（レベル1から所持、強化の対象外）。
// ここに登場しないキャラクターは「未実装」扱いで、battle.js側は
// character.skillsがnull/undefinedの間、従来通りモジュール選択を一切
// 制限しない。
export const CHARACTER_BASE_SKILLS = {
  flakeSugar: ["easyAdapt", "guardAlly", "quickAttack", "firstAid", "guardingHand"],
  cubeSugar: ["easyAdapt", "retreatCall", "quickAttack", "firstAid", "attackingHand"],
  honeyScrew: ["easyAdapt", "festivalHunch", "quickAttack", "firstAid", "honeyBeat"],
  chocolatBitterTaste: ["easyAdapt", "shadowJustice", "quickAttack", "firstAid", "bitterFeel"],
  lollipopSpiral: ["easyAdapt", "sisterCheer", "quickAttack", "firstAid", "supportComfort"],
  flawlessNoColor: ["easyAdapt", "check", "quickAttack", "firstAid", "flush"],
  sunlightSaccharum: ["easyAdapt", "highPlot", "lowPlot", "quickAttack", "firstAid", "prescription"],
};

// スキル成長：{from, to}の連なり（fromが丸ごとtoに置き換わる）。
// ショコラ・ビターテイストのビターフィールだけは、修得済みなら常に
// カカオフィール/ミルクフィール両方が選択肢に並ぶ（能力値による自動
// 分岐は行わない、というユーザー指示）。片方を選ぶと、その時点でもう
// 片方の前提条件（bitterFeelを所持していること）が自然に外れる。
export const CHARACTER_SKILL_GROWTH = {
  flakeSugar: [
    { from: "guardAlly", to: "noPassing" },
    { from: "guardingHand", to: "protectiveCode" },
    { from: "protectiveCode", to: "protectiveOrigin" },
  ],
  cubeSugar: [
    { from: "retreatCall", to: "neverLetGo" },
    { from: "attackingHand", to: "attackingArt" },
    { from: "attackingArt", to: "attackingFrontier" },
  ],
  honeyScrew: [
    { from: "festivalHunch", to: "festivalAdvice" },
    { from: "honeyBeat", to: "honeyBeeBeat" },
    { from: "honeyBeeBeat", to: "honeyBeastBeat" },
  ],
  chocolatBitterTaste: [
    { from: "shadowJustice", to: "shadowJusticeDuty" },
    { from: "bitterFeel", to: "cacaoFeel" },
    { from: "bitterFeel", to: "milkFeel" },
    { from: "cacaoFeel", to: "blackFeel" },
    { from: "milkFeel", to: "whiteFeel" },
  ],
  lollipopSpiral: [
    { from: "sisterCheer", to: "sisterCheerUpgrade" },
    { from: "supportComfort", to: "perfectSupport" },
    { from: "perfectSupport", to: "legendarySupport" },
  ],
  flawlessNoColor: [
    { from: "check", to: "doubleCheck" },
    { from: "flush", to: "straightFlush" },
    { from: "straightFlush", to: "royalStraightFlush" },
  ],
  sunlightSaccharum: [
    { from: "highPlot", to: "highBet" },
    { from: "lowPlot", to: "lowBet" },
    { from: "prescription", to: "prescriptionTheory" },
    { from: "prescriptionTheory", to: "proof" },
  ],
};

// 新規修得：前提条件は無く、未修得の間はずっと候補になる。
export const CHARACTER_SKILL_ACQUISITIONS = {
  flakeSugar: ["sugarTalkFront", "shieldSmash", "prayingHands"],
  cubeSugar: ["sugarTalkBack", "roughStrike", "mourningHand"],
  honeyScrew: ["loudVoice", "playfulSwing", "rokkakuCrystal"],
  chocolatBitterTaste: ["digAround", "bookworm", "needARest"],
  lollipopSpiral: ["petPet", "youngestSisterBusy", "scold"],
  flawlessNoColor: ["escort", "jackpot", "easyGame"],
  sunlightSaccharum: ["decoy", "lifeSaving", "lostKnowledge"],
};

// レベル10, 15, 20, ... の閾値を何回超えたか＝スキル強化の実施目標回数
// （Lv9以下は0、Lv10-14は1、Lv15-19は2、…）。
export function computeSkillEnhancementTarget(level) {
  return Math.max(0, Math.floor(level / 5) - 1);
}

// dataIdの初期修得スキルのコピーを返す（未実装キャラクターはnull --
// battle.js側の「制限なし」フォールバックをそのまま活かすため、空配列
// ではなくnullにする）。
export function baseSkillIdsFor(dataId) {
  const base = CHARACTER_BASE_SKILLS[dataId];
  return base ? [...base] : null;
}

// 現在の所持スキル(skillIds)から、まだ実行していない強化項目のうち
// 前提条件を満たすもの（成長ならfromを所持かつtoを未所持、新規修得なら
// 単に未所持）を全て返す。
export function pendingSkillEnhancements(dataId, skillIds) {
  const items = [];
  for (const entry of CHARACTER_SKILL_GROWTH[dataId] ?? []) {
    if (skillIds.includes(entry.from) && !skillIds.includes(entry.to)) {
      items.push({ type: "growth", from: entry.from, to: entry.to });
    }
  }
  for (const skillId of CHARACTER_SKILL_ACQUISITIONS[dataId] ?? []) {
    if (!skillIds.includes(skillId)) items.push({ type: "acquire", skillId });
  }
  return items;
}

// 1件の強化を実際に適用する（character.skills/skillEnhancementCountを
// 直接書き換える）。成長は対象replaceの通り、修得済みスキルは失われる。
export function applySkillEnhancement(character, item) {
  if (item.type === "growth") {
    character.skills = character.skills.filter((id) => id !== item.from);
    character.skills.push(item.to);
  } else {
    character.skills.push(item.skillId);
  }
  character.skillEnhancementCount = (character.skillEnhancementCount ?? 0) + 1;
}

// 雇用候補生成時など、既に一定レベルに達しているキャラクターについて
// 「今までにtargetCount回、有効な強化をランダムに実行してきた」体で
// character.skillsをまとめて進める。前提条件を満たす候補が尽きたら
// そこで打ち切る（この場合character.skillEnhancementCountはtargetCount
// より小さい値のまま残り、以後も「未実行分がある」とは判定されない --
// pendingSkillEnhancementsが実際には空になっているため）。
export function randomizeSkillProgression(character, targetCount) {
  if (!character.skills) return;
  for (let i = 0; i < targetCount; i++) {
    const pending = pendingSkillEnhancements(character.dataId, character.skills);
    if (pending.length === 0) break;
    const pick = pending[Math.floor(Math.random() * pending.length)];
    applySkillEnhancement(character, pick);
  }
}

// このキャラクターが今すぐスキル強化画面を必要としているか。呼び出し
// 元（squadFormation.js/exploration.js）は、隊員の能力値が成長する
// 全てのタイミングの直後にこれを呼び、trueならapi.callScene("skillEnhance",
// {character})の直後の処理をこの関数が肩代わりする（内部でcallScene
// する）。falseなら何もしていないので、呼び出し元はそのまま次の処理に
// 進めばよい。
export function maybeStartSkillEnhancement(api, character) {
  if (!character.skills) return false;
  const target = computeSkillEnhancementTarget(character.level);
  if ((character.skillEnhancementCount ?? 0) >= target) return false;
  if (pendingSkillEnhancements(character.dataId, character.skills).length === 0) return false;
  api.callScene("skillEnhance", { character });
  return true;
}

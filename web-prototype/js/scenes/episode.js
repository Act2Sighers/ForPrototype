import { renderScreen, button, h, resourceHud } from "../dom.js";
import { rollJudgement } from "../dice.js";
import state, {
  grantResource,
  grantTieredResource,
  grantAmberSugarMineral,
  grantTimeEatsItem,
  recordEpisodeSeen,
  recordRescue,
} from "../state.js";
import {
  RIGID_RESOURCES,
  NATURAL_RESOURCES,
  CHARACTER_STAT_LABELS,
  CHARACTER_STAT_FULL_LABELS,
  WEAPON_STAT_LABELS,
  CHARACTER_STAT_BY_WEAPON_STAT,
  RIGID_QUALITY_LABELS,
  rigidResourceTierName,
  naturalResourceTierName,
  computeStats,
  computeEffectiveMaxHp,
  pickHighestStatCharacter,
  applyHpDamage,
  refreshWeaponPrefix,
  findTimeEatsDef,
} from "../data/resourceCatalog.js";
import { DUNGEON_SCRIPTS, EPISODE_ARCHIVE_ENTRIES } from "../data/scripts.js";

// 遭遇イベント（judge済みの隊員個別能力値でのD6判定）で使う5つの能力値
// キー・武器性能値キー。CHARACTER_STAT_LABELS/WEAPON_STAT_LABELSの
// キー一覧をそのまま使ってもよいが、hpを含む/含まないの取り違えを
// 避けるため、ここで明示的に列挙しておく。
const JUDGEABLE_CHARACTER_STAT_KEYS = ["attack", "defence", "power", "wisdom", "sociality"];
const WEAPON_STAT_KEYS = ["sweetness", "hardness", "poisonResist", "stability", "flexibility"];

function pickRandomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// 「判定難易度」= 現在の到達マス数を使った雇用/武器取引と同じ考え方の
// 数式（ラン進捗率グレード上昇のcomputeProgressLevel等参照）。切り上げ。
function currentDifficulty() {
  return Math.ceil((state.run.visitedNodeIds.length + 1) / 2);
}

// 難易度に応じて分岐する報酬/ペナルティ共通の帯テーブル引き。bandsは
// 昇順の{max, value}の配列で、最後の要素はmaxを省略した「それ以上」
// の受け皿とする。
function bandByDifficulty(difficulty, bands) {
  for (const band of bands) {
    if (band.max === undefined || difficulty <= band.max) return band.value;
  }
  return bands[bands.length - 1].value;
}

// 遭遇イベントの品質帯/減少量帯の閾値（L・M）：ダンジョンの最深部の
// 深度（state.run.dungeonParams.longestReachableNodeCount）だけから
// 算出する -- 難易度Dには依存しない（個数側の倍率がDの役目、品質/
// 減少量側の閾値はLの役目、という別軸の調整）。判定難易度がL以下なら
// 帯1、[L+1,M]なら帯2、[M+1,∞)なら帯3。深度12（旧仕様の唯一の値）では
// L=2・M=5になり、既存の固定閾値と一致する。
function judgementTierThresholds() {
  const longest = state.run.dungeonParams.longestReachableNodeCount;
  return {
    low: Math.round((longest / 2) * (2 / 6)),
    high: Math.round((longest / 2) * (5 / 6)),
  };
}

// judgementTierThresholds()のlow/highと、帯ごとの値3つ（品質やペナルティ
// 量）を組み合わせて、bandByDifficulty用の帯テーブルを組み立てる。
function tierBandsFrom(thresholds, values) {
  return [
    { max: thresholds.low, value: values[0] },
    { max: thresholds.high, value: values[1] },
    { value: values[2] },
  ];
}

function speciesFor(category, id) {
  return category === "natural" ? NATURAL_RESOURCES[id] : RIGID_RESOURCES[id];
}
function tierNameFor(category, id, tier) {
  return category === "natural" ? naturalResourceTierName(id, tier) : rigidResourceTierName(id, tier);
}

function interpolate(text, context) {
  return text.replace(/\{\{name\}\}/g, context.selectedCharacter?.name ?? "");
}

// Applies one terminal beat's outcome and describes what happened, for
// display right under the branch's final line (see render()'s
// effectDescriptions handling). Named "effects" rather than "reward"
// since some of these are plainly bad for the player. colorClass
// defaults to blue/red for a plain gain/loss, but a quantity that
// already has its own dedicated color (HP, or a weapon stat that feeds
// a 能力値 -- see theme.css's .stat-* classes) uses that instead, per
// the user's request that stat colors take priority over plain
// positive/negative coloring.
function applyEffect(effect, context) {
  switch (effect.kind) {
    case "grantRigidResource": {
      // Flat-quantity species only (no quality tiers) -- e.g. ザラメ鉱石.
      const species = RIGID_RESOURCES[effect.id];
      const before = state.run.resources.rigid[effect.id];
      grantResource("rigid", effect.id, effect.amount);
      const after = state.run.resources.rigid[effect.id];
      return { text: `${species.name}×${effect.amount} を獲得！（${before} → ${after}）`, colorClass: "effect-positive" };
    }
    case "grantNaturalResource": {
      // grantRigidResourceの自然系資源版（ベースクリーム等のフラット付与）。
      const species = NATURAL_RESOURCES[effect.id];
      const before = state.run.resources.natural[effect.id];
      grantResource("natural", effect.id, effect.amount);
      const after = state.run.resources.natural[effect.id];
      return { text: `${species.name}×${effect.amount} を獲得！（${before} → ${after}）`, colorClass: "effect-positive" };
    }
    case "grantTimeEats": {
      // 購入フローを経由せず時間食を直接付与する（オープニングの初期投資等）。
      const def = findTimeEatsDef(effect.mode, effect.defId);
      grantTimeEatsItem(effect.mode, effect.defId, effect.qty);
      return { text: `${def.name}×${effect.qty} を獲得！`, colorClass: "effect-positive" };
    }
    case "grantTieredRigidResource": {
      const { before, after } = grantTieredResource("rigid", effect.id, effect.tier, effect.amount);
      const name = rigidResourceTierName(effect.id, effect.tier);
      return { text: `${name}×${effect.amount} を獲得！（${before} → ${after}）`, colorClass: "effect-positive" };
    }
    case "damageHighestStatCharacter": {
      const target = pickHighestStatCharacter(state.formationSlots, effect.statKey);
      if (!target) return null;
      const before = target.currentHp ?? computeStats(target).hp;
      applyHpDamage(target, effect.amount);
      const after = target.currentHp;
      const hpLabel = `${CHARACTER_STAT_LABELS.hp}(${CHARACTER_STAT_FULL_LABELS.hp})`;
      return {
        text: `${target.name}の${hpLabel}が ${before - after} 減少…（${before} → ${after}）`,
        colorClass: "stat-hp",
      };
    }
    case "damageSelectedCharacterWeaponStat": {
      const character = context.selectedCharacter;
      if (!character?.weapon) return null;
      const before = character.weapon.stats[effect.statKey];
      character.weapon.stats[effect.statKey] = Math.max(effect.min ?? 0, before - effect.amount);
      refreshWeaponPrefix(character.weapon);
      const after = character.weapon.stats[effect.statKey];
      const charKey = CHARACTER_STAT_BY_WEAPON_STAT[effect.statKey];
      return {
        text: `${character.name}の武器の${WEAPON_STAT_LABELS[effect.statKey]}が ${before - after} 減少…（${before} → ${after}）`,
        colorClass: `stat-${charKey}`,
      };
    }
    // 遭遇イベント（判定難易度式）の成功影響：判定難易度×倍率×難易度D
    // の個数を品質無しでそのまま付与（ザラメ鉱石/ベースクリーム）。
    case "grantScaledResource": {
      const species = speciesFor(effect.category, effect.id);
      const amount = context.difficulty * effect.multiplier * state.run.dungeonParams.difficultyValue;
      const before = state.run.resources[effect.category][effect.id];
      grantResource(effect.category, effect.id, amount);
      const after = state.run.resources[effect.category][effect.id];
      return { text: `${species.name}×${amount} を獲得！（${before} → ${after}）`, colorClass: "effect-positive" };
    }
    // 品質帯付きのタイヤ資源を[台本側の基準個数]×難易度D個付与（剛体系
    // 6種/自然系5種）。品質は判定難易度をjudgementTierThresholds()由来の
    // 帯（剛体は低/中/高、自然は中/上/特上）で引く。
    case "grantTieredResourceByDifficulty": {
      const values = effect.category === "natural" ? ["mid", "high", "premium"] : ["low", "mid", "high"];
      const bands = tierBandsFrom(judgementTierThresholds(), values);
      const tier = bandByDifficulty(context.difficulty, bands);
      const amount = effect.amount * state.run.dungeonParams.difficultyValue;
      const { before, after } = grantTieredResource(effect.category, effect.id, tier, amount);
      const name = tierNameFor(effect.category, effect.id, tier);
      return { text: `${name}×${amount} を獲得！（${before} → ${after}）`, colorClass: "effect-positive" };
    }
    // 琥珀糖鉱石は{tier:count}バケットではなく個別インスタンス方式
    // （grantAmberSugarMineral）なので専用ケースとして分ける。品質帯は
    // 剛体系タイヤ資源と同じ（低/中/高）、個数は[台本側の基準個数]×
    // 難易度D。
    case "grantAmberByDifficulty": {
      const bands = tierBandsFrom(judgementTierThresholds(), ["low", "mid", "high"]);
      const tier = bandByDifficulty(context.difficulty, bands);
      const amount = effect.amount * state.run.dungeonParams.difficultyValue;
      const before = state.run.resources.rigid.amberSugarMineral.length;
      for (let i = 0; i < amount; i++) grantAmberSugarMineral(tier);
      const after = state.run.resources.rigid.amberSugarMineral.length;
      const name = `${RIGID_RESOURCES.amberSugarMineral.name}（${RIGID_QUALITY_LABELS[tier]}品質）`;
      return { text: `${name}×${amount} を獲得！（${before} → ${after}）`, colorClass: "effect-positive" };
    }
    // 遭遇イベントの失敗影響①：判定難易度×倍率のHPを減少（最低0）。
    // 0になった場合は戦闘終了時の生存救助と同じ式（最大HPの1/4）で
    // その場で復活させ、パーティ全滅判定に引っかからないようにする。
    case "damageSelectedCharacterByDifficulty": {
      const character = context.selectedCharacter;
      if (!character) return null;
      const before = character.currentHp ?? computeStats(character).hp;
      const amount = context.difficulty * effect.multiplier;
      applyHpDamage(character, amount);
      let after = character.currentHp;
      let revivedText = "";
      if (after <= 0) {
        character.currentHp = Math.ceil(computeEffectiveMaxHp(character) / 4);
        after = character.currentHp;
        revivedText = `　${character.name}は倒れかけたが、なんとか持ち直した…（${after}まで回復）`;
        // 戦闘のreviveIncapacitatedAlliesと同じ「戦闘不能のまま生存」
        // 救済なので、リザルト画面の減点カウンタも同様に積み上げる。
        recordRescue(1);
      }
      const hpLabel = `${CHARACTER_STAT_LABELS.hp}(${CHARACTER_STAT_FULL_LABELS.hp})`;
      return {
        text: `${character.name}の${hpLabel}が ${before - Math.max(0, before - amount)} 減少…（${before} → ${Math.max(0, before - amount)}）${revivedText}`,
        colorClass: "stat-hp",
      };
    }
    // 遭遇イベントの失敗影響②：武器の性能値をランダムに1つ選んで、
    // 判定難易度帯（judgementTierThresholds()由来、減少量1/2/3）に
    // 応じた量だけ減少（最低0）。難易度Dはここには影響しない。
    case "damageSelectedCharacterRandomWeaponStatByDifficulty": {
      const character = context.selectedCharacter;
      if (!character?.weapon) return null;
      const statKey = pickRandomFrom(WEAPON_STAT_KEYS);
      const bands = tierBandsFrom(judgementTierThresholds(), [1, 2, 3]);
      const amount = bandByDifficulty(context.difficulty, bands);
      const before = character.weapon.stats[statKey];
      character.weapon.stats[statKey] = Math.max(0, before - amount);
      refreshWeaponPrefix(character.weapon);
      const after = character.weapon.stats[statKey];
      const charKey = CHARACTER_STAT_BY_WEAPON_STAT[statKey];
      return {
        text: `${character.name}の武器の${WEAPON_STAT_LABELS[statKey]}が ${before - after} 減少…（${before} → ${after}）`,
        colorClass: `stat-${charKey}`,
      };
    }
    // 複数の候補effectから1つだけランダムに選んで適用する（成功/失敗
    // それぞれの影響候補リストから1つ選ぶ、遭遇イベント用の仕組み）。
    case "randomOneOf": {
      return applyEffect(pickRandomFrom(effect.pool), context);
    }
    default:
      throw new Error(`Unknown episode effect kind: "${effect.kind}"`);
  }
}

// mode（"opening"/"encounter"/"rest"/"ending"/"recall"）ごとに読むべき
// 台本が変わる -- オープニング/エンディングはダンジョン固有の1本、
// 遭遇/休憩はそれぞれの抽選プールからランダムに1本選ぶ（data/scripts.js
// のDUNGEON_SCRIPTS参照）。recallは探査記録画面（宿舎、archive.js）
// から呼ばれる回想専用モードで、params.scriptIdで指定された既読の台本
// を、報酬適用なし・判定バイパスありで読み返すだけ。
const MODES_WITH_SKIP = new Set(["encounter", "rest"]);

const MODE_TITLES = {
  opening: "オープニング",
  encounter: "遭遇",
  rest: "休憩",
  ending: "エンディング",
};

function pickRandomScript(pool) {
  return pool[Math.floor(Math.random() * pool.length)];
}

// opening/ending/encounterは全てDUNGEON_SCRIPTS側で{id, title, script}
// のdescriptor形になっているので、休憩（pickRestEpisode）・回想
// （EPISODE_ARCHIVE_ENTRIESからのid引き）と同じ形をそのまま返せる。
function resolveScript(mode) {
  const dungeonScripts = DUNGEON_SCRIPTS[state.run.dungeonId];
  switch (mode) {
    case "opening":
      return dungeonScripts.opening;
    case "ending":
      return dungeonScripts.ending;
    case "encounter":
      return pickRandomScript(dungeonScripts.encounterPool);
    default:
      throw new Error(`episode scene requires a valid params.mode, got: ${mode}`);
  }
}

// 休憩イベントの抽選（js/data/restEpisodes.jsのREST_EPISODE_POOL、
// descriptorの配列から1つ選ぶ）：
//  1. 在籍判定 -- requiredCharacterIdsの全員が現在の編成にいるものだけ
//     を候補にする。
//  2. 隊員個別エピソード（characterId持ち）は、その隊員の進捗
//     （state.restEpisodeProgress）が指す「次の1段階」だけが候補になる
//     （独白1→独白2→…の順序厳守。既に全段階消化済みの隊員は候補なし）。
//  3. 未抽選（state.seenEpisodeIds未収録）のものがあれば、その中から
//     一様ランダムに選ぶ。無ければ、候補全体（＝既に全て抽選済み）から
//     一様ランダムに選ぶ。
// ダミー（[71]、requiredCharacterIds: []）は常に候補に入るため、
// eligibleが空になることはない。
function candidateEligible(descriptor) {
  // c.idは隊員インスタンス固有のid（createCharacterFromData参照）で、
  // カタログ上のキャラクター種別を表すのはc.dataIdの方。
  const inFormation = new Set(state.formationSlots.map((c) => c.dataId));
  if (!descriptor.requiredCharacterIds.every((id) => inFormation.has(id))) return false;
  if (descriptor.characterId) {
    const progress = state.restEpisodeProgress[descriptor.characterId] ?? 0;
    return descriptor.stepIndex === progress;
  }
  return true;
}

function pickRestEpisode() {
  const pool = DUNGEON_SCRIPTS[state.run.dungeonId].restPool;
  const eligible = pool.filter(candidateEligible);
  const unseen = eligible.filter((d) => !state.seenEpisodeIds.includes(d.id));
  return pickRandomScript(unseen.length > 0 ? unseen : eligible);
}

// 台本 (script) interpreter shared by every オープニング/遭遇/休憩/
// エンディング event: params.modeからDUNGEON_SCRIPTSを引いて台本を1つ
// 確定し（mountのたびに1回だけ -- 再描画のたびに抽選し直さないよう
// resolveScriptの呼び出しはここだけ）、以降this sceneはそれを歩く
// だけ -- 台本の形はdata/scripts.js参照。
export function EpisodeScene(container, params, api) {
  const mode = params.mode;
  const isRecall = mode === "recall";
  // 休憩イベントだけ選定ロジックが特殊（在籍判定/順序厳守/未抽選優先）
  // なので、resolveScript()とは別にpickRestEpisode()で選んだdescriptor
  // を保持しておく -- 台本終了時にrecordEpisodeSeenへ渡す（下のgoto
  // 参照）。回想モード（探査記録画面、宿舎から入る）は
  // params.scriptIdで指定された既読の台本をEPISODE_ARCHIVE_ENTRIESから
  // 引く。
  const descriptor =
    mode === "rest"
      ? pickRestEpisode()
      : isRecall
      ? EPISODE_ARCHIVE_ENTRIES.find((entry) => entry.id === params.scriptId)
      : resolveScript(mode);
  const script = descriptor.script;
  const context = { selectedCharacter: null };
  let current = null;
  let currentBeatId = null;
  // 回想モード限定：「戻る」ボタン用のビートid履歴（goto呼び出しの
  // たびに直前のビートidを積む。endビートは積まれない -- 終端に達したら
  // 即座に呼び出し元へ戻るため）。
  const history = [];
  // Set once a branch's terminal "end" beat has run its effects -- the
  // last line stays on screen with the effect text appended below it
  // (rather than the scene closing immediately), and the player needs
  // one more click to actually leave. null before that point; an array
  // (possibly empty, e.g. the エンディング script has no effects) once
  // it happens.
  let effectDescriptions = null;
  // 戦闘イベント外でのダメージ効果（damageHighestStatCharacter）によって
  // 編成スロットの隊員全員のHPが0になった場合に立てるフラグ。立って
  // いる間は、このエピソードを閉じる操作がゲームオーバー画面への遷移に
  // 差し替わる。
  let partyWiped = false;

  // A "judgement" beat resolves into an ordinary line the moment it's
  // entered (so the dice only roll once, not on every re-render), with
  // an auto-generated line describing the roll. 成功/失敗 gets its own
  // colored span rather than being plain text.
  // 「difficultyJudgement」ビート：能力値をランダムに1つ選び、その値
  // ぶんD6を振った成功数(4以上の出目の数)が判定難易度（現在の到達マス数
  // ベース、currentDifficulty参照）以上なら成功。判定に使った難易度は
  // その後のeffect側（randomOneOf経由のgrantScaledResource等）が
  // 参照できるよう、context.difficultyに保存しておく（judgementビート
  // 同様、一度きり・毎回の再描画では振り直さない）。
  function resolveDifficultyJudgement(beat) {
    const character = context.selectedCharacter;
    // 判定に使う能力値は、直前のcharacterSelectビート（resolveBeat側）で
    // 既に選ばれ、プレイヤーにも提示済みのものをそのまま使う -- ここで
    // 改めて抽選し直すと、選択画面で見せた能力値と実際の判定がズレる。
    const statKey = context.judgementStatKey ?? pickRandomFrom(JUDGEABLE_CHARACTER_STAT_KEYS);
    const statValue = computeStats(character)[statKey];
    const difficulty = currentDifficulty();
    context.difficulty = difficulty;
    const { rolls, successCount } = rollJudgement(statValue);
    const success = successCount >= difficulty;
    const prefix = `${character.name}の${CHARACTER_STAT_LABELS[statKey]}（${CHARACTER_STAT_FULL_LABELS[statKey]}${statValue}）で判定：D6を${statValue}回振り、出目は［${rolls.join(
      "、"
    )}］。4以上の出目は${successCount}個。判定難易度${difficulty}に対し、成功数は${
      success ? "以上だったため" : "届かなかったため"
    }、判定は【`;
    const resultSpan = h("span", { class: success ? "effect-positive" : "effect-negative", text: success ? "成功" : "失敗" });
    return { textNodes: [prefix, resultSpan, "】。"], next: success ? beat.success : beat.failure };
  }

  // 回想モードでは、判定ビート（judgement/difficultyJudgement）は
  // サイコロを振らず、プレイヤーが成功/失敗の分岐を任意に選べる
  // 選択肢として提示する（state.run が無い可能性がある回想モードから
  // currentDifficulty/rollJudgementを呼ばないためでもある）。
  function manualBranchChoice(beat) {
    return {
      text: "（回想モード：判定はスキップされます。分岐を選んでください）",
      choices: [
        { label: "成功", next: beat.success },
        { label: "失敗", next: beat.failure },
      ],
    };
  }

  // 「characterSelect」ビート：この先がdifficultyJudgementビートに
  // つながっているなら、判定に使う能力値をこの時点で抽選し、context に
  // 保持しておく（difficultyJudgement側はこの値をそのまま使う）。
  // プレイヤーが隊員を選ぶ前に、何の能力値で判定されるのか分かるように
  // するための前倒し -- 以前はdifficultyJudgement側でしか抽選しておらず、
  // 選択画面には一切出せていなかった。
  function resolveCharacterSelect(beat) {
    const nextBeat = script.beats[beat.next];
    if (!isRecall && nextBeat?.type === "difficultyJudgement") {
      context.judgementStatKey = pickRandomFrom(JUDGEABLE_CHARACTER_STAT_KEYS);
    }
    return beat;
  }

  function resolveBeat(beat) {
    if (beat.type === "characterSelect") return resolveCharacterSelect(beat);
    if (beat.type === "difficultyJudgement") return isRecall ? manualBranchChoice(beat) : resolveDifficultyJudgement(beat);
    if (beat.type !== "judgement") return beat;
    if (isRecall) return manualBranchChoice(beat);
    const character = context.selectedCharacter;
    const statValue = computeStats(character)[beat.statKey];
    const { rolls, successCount } = rollJudgement(statValue);
    const success = successCount > 0;
    const prefix = `${character.name}の${beat.statLabel}（${statValue}）で判定：D6を${statValue}回振り、出目は［${rolls.join("、")}］。出目に4以上が${
      success ? "含まれていたため" : "無かったため"
    }、判定は【`;
    const resultSpan = h("span", { class: success ? "effect-positive" : "effect-negative", text: success ? "成功" : "失敗" });
    return { textNodes: [prefix, resultSpan, "】。"], next: success ? beat.success : beat.failure };
  }

  function goto(beatId) {
    const beat = resolveBeat(script.beats[beatId]);
    if (beat.type === "end") {
      if (isRecall) {
        // 回想モードでは報酬処理を一切行わず（state.runが無い可能性が
        // あるため、effectはそもそも適用できない）、読み終えたら即座に
        // 呼び出し元（探査記録画面）へ戻る。
        api.closeScene();
        return;
      }
      // 台本を1本読み切った（＝endビートに到達した）タイミングで、
      // その1本を既読として記録する（休憩の隊員個別エピソードだけは
      // 進捗も1段階進める -- descriptor.characterId参照）。
      recordEpisodeSeen(descriptor.id, descriptor.characterId);
      const descriptions = (beat.effects ?? []).map((effect) => applyEffect(effect, context)).filter(Boolean);
      // 戦闘イベント外であれどこであれ、編成スロットの隊員全員のHPが0に
      // なった時点でゲームオーバーとする（変調の過剰蓄積による実効最大
      // HPの低下が原因の場合も含む -- applyHpDamage/increaseConditionは
      // どちらもcurrentHpをそのまま0まで下げ得る）。
      partyWiped = state.formationSlots.length > 0 && state.formationSlots.every((c) => c.currentHp <= 0);
      if (descriptions.length === 0 && !partyWiped) {
        // Nothing to show (e.g. the エンディング script, which has no
        // effects since the run is already over) -- close right away
        // instead of making the player click a second time just to
        // dismiss an empty effect area.
        api.closeScene();
        return;
      }
      effectDescriptions = descriptions;
      render();
      return;
    }
    if (isRecall && currentBeatId !== null) history.push(currentBeatId);
    current = beat;
    currentBeatId = beatId;
    effectDescriptions = null;
    render();
  }

  // 回想モード限定：履歴を1つ戻って再表示する（末尾のendビートは
  // historyに積まれないので、goBackでendに戻ることはない）。
  function goBack() {
    if (history.length === 0) return;
    const previousId = history.pop();
    current = resolveBeat(script.beats[previousId]);
    currentBeatId = previousId;
    effectDescriptions = null;
    render();
  }

  function selectCharacter(character, nextId) {
    context.selectedCharacter = character;
    goto(nextId);
  }

  function render() {
    const isFinished = effectDescriptions !== null;
    const textContent = current.textNodes ?? [interpolate(current.text ?? "", context)];
    const speaker = current.speaker ?? ""; // blank nameplate for the narrator (観測者)

    const textboxChildren = [];
    if (speaker) textboxChildren.push(h("p", { class: "episode-textbox__name", text: speaker }));
    textboxChildren.push(h("p", {}, textContent));
    if (effectDescriptions) {
      for (const effect of effectDescriptions) {
        textboxChildren.push(h("p", { class: `episode-effect ${effect.colorClass}`, text: effect.text }));
      }
    }

    const closeOrGameOver = () => (partyWiped ? api.navigateTo("result", { mode: "gameover" }) : api.closeScene());

    const stage = h("div", { class: "episode-stage" }, [
      h(
        "div",
        {
          class: "episode-textbox",
          onClick: isFinished
            ? closeOrGameOver
            : current.next && !current.choices
            ? () => goto(current.next)
            : undefined,
        },
        textboxChildren
      ),
    ]);

    const body = [stage];
    if (!isFinished && current.choices) {
      body.push(
        h(
          "div",
          { class: "chip-row" },
          current.choices.map((choice) =>
            button(choice.label, { variant: "primary", onClick: () => goto(choice.next) })
          )
        )
      );
    } else if (!isFinished && current.type === "characterSelect") {
      const judgementStatKey = context.judgementStatKey;
      if (judgementStatKey) {
        body.push(
          h("p", { class: "episode-effect", text: `今回の判定能力値：${CHARACTER_STAT_FULL_LABELS[judgementStatKey]}（${CHARACTER_STAT_LABELS[judgementStatKey]}）` })
        );
      }
      body.push(
        h(
          "div",
          { class: "slot-list" },
          state.formationSlots.map((character) =>
            h("div", { class: "slot" }, [
              h("div", { class: "slot__meta" }, [
                h("span", { class: "slot__id", text: `Lv.${character.level}` }),
                h("span", { class: "slot__name", text: character.name }),
                judgementStatKey
                  ? h("span", { class: "slot__id", text: `${CHARACTER_STAT_LABELS[judgementStatKey]}${computeStats(character)[judgementStatKey]}` })
                  : null,
              ]),
              h("div", { class: "slot__actions" }, [
                button("選択する", { variant: "primary", onClick: () => selectCharacter(character, current.next) }),
              ]),
            ])
          )
        )
      );
    }

    const actions = [];
    if (MODES_WITH_SKIP.has(mode)) {
      actions.push(button("スキップ（テスト用）", { variant: "ghost", onClick: () => api.closeScene() }));
    }
    if (isRecall && history.length > 0 && !isFinished) {
      actions.push(button("戻る", { variant: "ghost", onClick: goBack }));
    }
    if (isFinished) {
      actions.push(button(partyWiped ? "結果を見る" : "閉じる", { variant: "primary", onClick: closeOrGameOver }));
    } else if (current.next && !current.choices && current.type !== "characterSelect") {
      // If advancing leads straight into an effect-less "end" beat, this
      // click will close the scene immediately (see goto() above) rather
      // than show an effects screen -- so label it "閉じる" rather than
      // "すすめる" to match what it actually does. 回想モードのendは
      // effectsの有無に関わらず常に即座に閉じる（goto参照）ので、常に
      // 「閉じる」になる。
      const nextBeat = script.beats[current.next];
      const nextClosesImmediately = nextBeat?.type === "end" && (isRecall || !(nextBeat.effects ?? []).length);
      actions.push(button(nextClosesImmediately ? "閉じる" : "すすめる", { variant: "primary", onClick: () => goto(current.next) }));
    }

    renderScreen(container, {
      eyebrow: "EPISODE",
      title: isRecall ? descriptor.title : MODE_TITLES[mode],
      corner: resourceHud(state.run?.resources),
      onPause: () => api.callScene("pause"),
      body,
      actions,
    });
  }

  goto(script.startId);

  return { onResume: () => render() };
}

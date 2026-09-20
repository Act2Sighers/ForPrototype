// 台本 (episode scripts): each is a graph of "beats" walked by
// episode.js's interpreter, keyed by id under `beats`, starting at
// `startId`. A beat is one of:
//  - a narration line: { text, next } to advance automatically, or
//    { text, choices: [{ label, next }, ...] } to branch on a click.
//    "\n" inside `text` is a manual line break (rendered via CSS
//    white-space: pre-line); "{{name}}" is replaced with whichever
//    character the player selected earlier in the same branch, if any.
//  - { type: "characterSelect", text, next }: shows the player's
//    current 編成 as a pick-one list; the pick is stored for later
//    {{name}} interpolation and for "judgement"/effects further down
//    this same branch.
//  - { type: "judgement", statKey, statLabel, success, failure }: rolls
//    the selected character's statKey in D6 (one die per stat point),
//    succeeding if any die lands >=4, then branches to `success` or
//    `failure`. Resolved into an ordinary narration line the moment the
//    beat is entered, so the roll only ever happens once.
//  - a terminal beat, `{ type: "end", effects: [...] }`: applies its
//    effects (see episode.js's applyEffect) and closes the episode.
//    Called "effects" rather than "reward" since some are negative
//    (e.g. HP loss) -- see the 遭遇 script's 上を見る branch.
import { CHARACTER_STAT_LABELS } from "./resourceCatalog.js";

export const OPENING_SCRIPT = {
  startId: "b1",
  beats: {
    b1: {
      text: "先刻、王女は私に、件の第一部隊の観測者となる命を下した。",
      next: "b2",
    },
    b2: {
      text: "不安だが、逆らうわけにもいくまい。\n私は種銭を受け取り、王城直営の雇用所へ向かった……。",
      next: "end",
    },
    end: {
      type: "end",
      effects: [{ kind: "grantRigidResource", id: "coarseSugarMineral", amount: 200 }],
    },
  },
};

export const ENDING_SCRIPT = {
  startId: "b1",
  beats: {
    b1: {
      text: "意を決して踏み込んだはいいが、まさかこの洞窟がこんなにも短いとは。敵性個体もほとんどいない上に、最奥に宝箱の1つも無いなんて！",
      next: "b2",
    },
    b2: {
      text: "そんな私の落胆を他所に、隊員たちは自分たちが無事にこの任務を終えられたことに安堵しているようだった。",
      next: "b3",
    },
    b3: {
      text: "私としても、優性個体たちをこんな任務で無駄に消耗させでもしたら、王女にどんな刑を下されるか分かったものじゃない。\nこの場は首が飛ばずに済んだだけでも良しとするか……。",
      next: "end",
    },
    end: { type: "end", effects: [] },
  },
};

export const ENCOUNTER_SCRIPT = {
  startId: "b1",
  beats: {
    b1: {
      text: "頭上まで高く伸びた甘蔗繊維質が、森の木々のように道の左右に生え揃っている。",
      next: "b2",
    },
    b2: {
      text: "この植物は、成長して一定以上の硬性を獲得してからは、通常の手段では採取できなくなってしまう。",
      next: "b3",
    },
    b3: {
      text: "これだけの量を全て持ち帰れたら、企業に引っ張りだこだろうな。",
      choices: [
        { label: "上を見る", next: "up1" },
        { label: "下を見る", next: "down1" },
      ],
    },

    // 【分岐：上を見る】
    up1: {
      text: "頭上を覆う甘蔗の隙間から、砂糖菓子のような太陽が覗いている。",
      next: "up2",
    },
    up2: {
      text: "私がそのようにぼんやりと空を眺めていると、隊員の1人が急に私の背中を強く押した──",
      next: "up3",
    },
    up3: {
      text: "突然のことに戸惑い、振り返る。\nどうやら、自重に耐えられなくなった木の先端が落下してきていたらしい。",
      next: "up4",
    },
    up4: {
      text: "私が先ほどまでにいた場所には、硬質な枝が深々と突き刺さっていた。",
      next: "up5",
    },
    up5: {
      text: "私のことを押した隊員は、その拍子に切り傷を負ってしまったようだったが、それを気にもとめず、駆け寄ってきて私に手を差し伸べた。",
      next: "up6",
    },
    up6: {
      text: "次に同じことがいつ起こるかも分からない。\n私は隊員たちを連れて、急いでその場を後にすることにした……。",
      next: "up-end",
    },
    "up-end": {
      type: "end",
      effects: [{ kind: "damageHighestStatCharacter", statKey: "wisdom", amount: 10 }],
    },

    // 【分岐：下を見る】
    down1: {
      text: "ふと足元に目を向けると、1本だけ、まだ成長しきっていない甘蔗が残っていることに気付いた。日頃の行いが良かったのだろうか。",
      next: "down2",
    },
    down2: {
      text: "ただそうは言っても、非力な私では切ることは愚か、引き抜くことすらできない。",
      next: "down3",
    },
    down3: {
      text: "とはいえ、この機を逃す理由は無い。私は隊員たちに声をかけた。",
      next: "down-select",
    },
    "down-select": {
      type: "characterSelect",
      text: "隊員を一人選んでください。",
      next: "down-judge",
    },
    "down-judge": {
      type: "judgement",
      statKey: "destruction",
      statLabel: CHARACTER_STAT_LABELS.destruction,
      success: "down-success1",
      failure: "down-fail1",
    },

    "down-success1": {
      text: "{{name}}は、渾身の力でその甘蔗に衝撃を与える。\nすると、甘蔗は根元でポッキリと折れて地面に転がった。",
      next: "down-success2",
    },
    "down-success2": {
      text: "私がそれに感謝を述べると、{{name}}は「当然のことをしたまで」とでもいうかのように、誇らしげにしてみせた。",
      next: "down-success-end",
    },
    "down-success-end": {
      type: "end",
      effects: [{ kind: "grantTieredRigidResource", id: "sugarCaneFiber", tier: "mid", amount: 1 }],
    },

    "down-fail1": {
      text: "{{name}}は、渾身の力でその甘蔗に衝撃を与える。\n……しかし、甘蔗は微動だにせず、代わりに武器の方が歪んでしまった。",
      next: "down-fail2",
    },
    "down-fail2": {
      text: "凹んだ武器を見て、{{name}}は大きく肩を落とす。\n私は彼女にかける言葉が見つからず、こちらとしても迂闊なことを頼んでしまった、と謝った……。",
      next: "down-fail-end",
    },
    "down-fail-end": {
      type: "end",
      effects: [{ kind: "damageSelectedCharacterWeaponStat", statKey: "sweetness", amount: 1, min: 0 }],
    },
  },
};

// 休憩イベント用の台本。仮実装として、遭遇イベント用の台本の内容を
// そのまま複製したもの（休憩専用の内容は今後用意する）。
export const REST_SCRIPT = structuredClone(ENCOUNTER_SCRIPT);

// ダンジョンごとに用意する台本一式。オープニング/エンディングは固定の
// 1本を読み、遭遇/休憩はそれぞれの抽選プールからランダムに1つだけ選ぶ
// （episode.jsのmode方式が使う -- 現状はどちらのプールも1本しか無いので
// 実質固定だが、複数本を想定した抽選ロジックのまま扱っておく）。
export const DUNGEON_SCRIPTS = {
  "test-dungeon": {
    opening: OPENING_SCRIPT,
    ending: ENDING_SCRIPT,
    encounterPool: [ENCOUNTER_SCRIPT],
    restPool: [REST_SCRIPT],
  },
};

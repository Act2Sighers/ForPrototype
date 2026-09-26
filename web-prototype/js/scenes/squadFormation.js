import { renderScreen, button, h } from "../dom.js";
import {
  characterHpGauge,
  characterStatLine,
  characterWeaponLine,
  characterCoatingLine,
  characterSynergyLine,
  characterConditionBadge,
  characterSkillLine,
} from "../characterCard.js";
import state, { FORMATION_LIMIT, STANDBY_LIMIT, dischargeCharacter, equipStoredWeapon, consumeTimeEatsItem } from "../state.js";
import { computeWeaponRating, canEquip, getWeaponDisplayName, applyTimeEatsToCharacter } from "../data/resourceCatalog.js";
import { maybeStartSkillEnhancement } from "../data/characterSkills.js";

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
//    (via "武器"/"荷物", a sibling-swap -- see api.closeScene's
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
//  - "feed" (配給モード) / "feedAll" (全員配給モード): called from
//    resourceStorage.js's荷物置き場, per time-eats stack's「配給する」
//    ボタン（対象人数が1人ならfeed、全員ならfeedAll）、params.timeEatsItem
//    にそのスタック（state.run.timeEatsInventoryのエントリそのもの）を
//    渡す。どちらも現在の全隊員（編成＋待機）を並べ、レベル/HP/変調を
//    常に表示する。feedは隊員ごとの「選択」→確認→
//    resourceCatalog.jsのapplyTimeEatsToCharacterで変換処理を行い、
//    成長ポイントが出たら熟成画面(maturation)を呼ぶ。feedAllは画面下部
//    の「全員に配給する」1回で全隊員に順番に同じ処理を行う（熟成画面が
//    挟まるたびに一旦中断し、閉じたら次の隊員へ進む -- processFeedAllNext
//    参照）。どちらも「キャンセル」で何もせず呼び出し元へ戻る。
export function SquadFormationScene(container, params, api) {
  const mode =
    params.mode === "discharge" ? "discharge" :
    params.mode === "swap" ? "swap" :
    params.mode === "feed" ? "feed" :
    params.mode === "feedAll" ? "feedAll" :
    params.mode === "select" ? "select" :
    "normal";
  const swapWeapon = mode === "swap" ? params.weapon : null;
  const timeEatsItem = mode === "feed" || mode === "feedAll" ? params.timeEatsItem : null;
  // feedAll専用：処理対象を最初に一度だけ確定させ、カーソルで1人ずつ
  // 進める（熟成画面を挟むたびにこのシーン自体は一旦suspendされるが、
  // 配列そのものは同じ参照のまま保たれる）。
  const feedAllCharacters = mode === "feedAll" ? [...state.formationSlots, ...state.standbySlots] : [];
  let feedAllCursor = 0;
  // 熟成画面／スキル強化画面のどちらが閉じて戻ってきた時も、次に何を
  // すべきかをここに積んでおく（onResume参照）。「熟成→スキル強化
  // （必要な回数ぶん連続）→次の処理」という流れを、呼び出す画面の
  // 種類を問わない同じ仕組みで表現できる。
  let afterChildScene = null;

  // 隊員の能力値成長（熟成画面が閉じた直後）ごとに呼ぶ：その隊員が
  // まだ実行すべきスキル強化を残していれば連続でスキル強化画面を挟み、
  // 無くなったらthenFnへ進む。
  function afterGrowth(character, thenFn) {
    if (maybeStartSkillEnhancement(api, character)) {
      afterChildScene = () => afterGrowth(character, thenFn);
      return;
    }
    thenFn();
  }

  let editing = false;
  let draftFormation = [];
  let draftStandby = [];
  let pendingDischargeId = null;
  let pendingEquipId = null;
  let pendingFeedId = null;
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

  // ①-④の変換処理を行い、qtyを1減らす。⑤：成長ポイントが出たら熟成
  // 画面を呼び、無ければそのまま閉じる（feedモードは1人で完結するので、
  // どちらの場合も最終的に自分自身を閉じて呼び出し元へ戻る -- onResume
  // 参照）。
  function runConversion(character) {
    const result = applyTimeEatsToCharacter(character, timeEatsItem);
    consumeTimeEatsItem(timeEatsItem, 1);
    return result;
  }

  function confirmFeed(character) {
    pendingFeedId = null;
    const result = runConversion(character);
    if (result.growthPoints >= 1) {
      api.callScene("maturation", {
        character,
        growthPoints: result.growthPoints,
        levelBefore: result.levelBefore,
        levelAfter: result.levelAfter,
      });
      afterChildScene = () => afterGrowth(character, () => api.closeScene());
    } else {
      api.closeScene();
    }
  }

  function feedRow(character) {
    const isPending = pendingFeedId === character.id;
    const head = h("div", { class: "row-between" }, [
      h("div", { class: "slot__meta" }, [
        h("span", { class: "slot__id", text: `Lv.${character.level}` }),
        h("span", { class: "slot__name", text: character.name }),
      ]),
      characterConditionBadge(character),
    ]);
    if (isPending) {
      return h("div", { class: "panel" }, [
        head,
        characterHpGauge(character),
        h("div", { class: "confirm-row" }, [
          h("span", { class: "confirm-row__text", text: `${character.name}に${timeEatsItem.name}を与えます。よろしいですか？` }),
          button("実行する", { variant: "primary", onClick: () => confirmFeed(character) }),
          button("キャンセル", { variant: "ghost", onClick: () => { pendingFeedId = null; render(); } }),
        ]),
      ]);
    }
    return h("div", { class: "panel" }, [
      head,
      characterHpGauge(character),
      h("div", { class: "slot__actions" }, [
        button("選択", { variant: "primary", onClick: () => { pendingFeedId = character.id; render(); } }),
      ]),
    ]);
  }

  function feedAllRow(character) {
    return h("div", { class: "panel" }, [
      h("div", { class: "row-between" }, [
        h("div", { class: "slot__meta" }, [
          h("span", { class: "slot__id", text: `Lv.${character.level}` }),
          h("span", { class: "slot__name", text: character.name }),
        ]),
        characterConditionBadge(character),
      ]),
      characterHpGauge(character),
    ]);
  }

  // feedAllモードの本体：カーソル位置から1人ずつ変換処理を行い、成長
  // ポイントが出た隊員がいたらそこで熟成画面を呼んで中断する（閉じたら
  // onResumeがこの関数を呼び直し、カーソルの続きから再開する）。全員
  // 処理し終えたら自分自身を閉じて呼び出し元へ戻る。
  function processFeedAllNext() {
    while (feedAllCursor < feedAllCharacters.length) {
      const character = feedAllCharacters[feedAllCursor];
      feedAllCursor += 1;
      const result = applyTimeEatsToCharacter(character, timeEatsItem);
      if (result.growthPoints >= 1) {
        api.callScene("maturation", {
          character,
          growthPoints: result.growthPoints,
          levelBefore: result.levelBefore,
          levelAfter: result.levelAfter,
        });
        afterChildScene = () => afterGrowth(character, processFeedAllNext);
        return;
      }
    }
    api.closeScene();
  }

  function handleFeedAllClick() {
    consumeTimeEatsItem(timeEatsItem, 1);
    feedAllCursor = 0;
    processFeedAllNext();
  }

  function renderFeed() {
    const isAll = mode === "feedAll";
    const characters = isAll ? feedAllCharacters : [...state.formationSlots, ...state.standbySlots];
    const rowFn = isAll ? feedAllRow : feedRow;
    const actions = [button("キャンセル", { variant: "ghost", onClick: () => api.closeScene() })];
    if (isAll) {
      actions.push(button("全員に配給する", { variant: "primary", onClick: handleFeedAllClick }));
    }
    renderScreen(container, {
      eyebrow: isAll ? "SQUAD / FEED ALL" : "SQUAD / FEED",
      title: isAll ? "部隊編成（全員配給）" : "部隊編成（配給）",
      subtitle: isAll
        ? `「全員に配給する」を押すと、${timeEatsItem.name}を隊員全員に与えます。`
        : `${timeEatsItem.name}を与える隊員の「選択」を押してください。`,
      body: [
        characters.length
          ? h("div", { class: "slot-list slot-list--grid" }, characters.map(rowFn))
          : h("p", { class: "lead", text: "隊員がいません。" }),
      ],
      onPause: () => api.callScene("pause"),
      actions,
    });
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
        button("武器変更", { variant: "ghost", onClick: () => api.callScene("weaponStorage", { mode: "swap", character }) }),
        button("糖衣編集", { variant: "ghost", onClick: () => api.callScene("coatingEdit", { character }) })
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
      rowChildren.push(
        characterSynergyLine(character),
        characterStatLine(character),
        characterWeaponLine(character),
        characterSkillLine(character),
        characterCoatingLine(character)
      );
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
      onPause: () => api.callScene("pause"),
      actions: [button("キャンセル", { variant: "ghost", onClick: () => api.closeScene() })],
    });
  }

  // "select" (隊員選択モード)：糖衣編集画面の「隊員」枠から呼ばれる。
  // swapと違いシナジーなどの絞り込みは無く、編成/待機の全隊員を並べる
  // だけ -- 選んだ隊員をそのまま呼び出し元へ返す（確認ステップも無い、
  // 破壊的な操作ではないため）。
  function selectPickRow(character, locationLabel) {
    return h("div", { class: "slot" }, [
      h("div", { class: "slot__meta" }, [
        h("span", { class: "slot__id", text: `Lv.${character.level}` }),
        h("span", { class: "slot__name", text: `${character.name}（${locationLabel}）` }),
      ]),
      h("div", { class: "slot__actions" }, [button("選択", { variant: "primary", onClick: () => api.closeScene(character) })]),
    ]);
  }

  function renderSelect() {
    const candidates = [
      ...state.formationSlots.map((c) => ({ character: c, location: "編成中" })),
      ...state.standbySlots.map((c) => ({ character: c, location: "待機中" })),
    ];
    renderScreen(container, {
      eyebrow: "SQUAD / SELECT",
      title: "部隊編成（隊員選択）",
      subtitle: "編集する隊員を選んでください。",
      body: [
        candidates.length
          ? h("div", { class: "slot-list slot-list--grid" }, candidates.map((entry) => selectPickRow(entry.character, entry.location)))
          : h("p", { class: "lead", text: "隊員がいません。" }),
      ],
      onPause: () => api.callScene("pause"),
      actions: [button("編集画面に戻る", { variant: "ghost", onClick: () => api.closeScene() })],
    });
  }

  function render() {
    if (mode === "swap") {
      renderSwap();
      return;
    }
    if (mode === "select") {
      renderSelect();
      return;
    }
    if (mode === "feed" || mode === "feedAll") {
      renderFeed();
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
    let headActions;
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
      // 「編成を変える」は画面下部から退避させ、タイトル直下の右揃え
      // 行（headActions）へ移す -- 兄弟画面（武器/糖衣/荷物置き場）と
      // 画面下部のボタン構成を揃えるため（マップ/部隊編成/武器/糖衣/
      // 荷物の5つで固定、うち「部隊編成」は自分自身を指すダミー）。
      headActions = [button("編成を変える", { variant: "primary", onClick: enterEdit })];
      actions = [
        button("マップ", { onClick: () => api.closeScene() }),
        button("部隊編成", { disabled: true }),
        button("武器", { onClick: () => api.closeScene({ openNext: "weaponStorage" }) }),
        button("糖衣", { onClick: () => api.closeScene({ openNext: "coatingStorage" }) }),
        button("荷物", { onClick: () => api.closeScene({ openNext: "resourceStorage" }) }),
      ];
      subtitle = "編成スロットの隊員が戦闘に参加します。";
    }

    renderScreen(container, {
      eyebrow: mode === "discharge" ? "SQUAD / DISCHARGE" : "SQUAD",
      title: mode === "discharge" ? "部隊編成（除隊）" : "部隊編成",
      subtitle,
      headActions,
      onPause: () => api.callScene("pause"),
      body,
      actions,
    });
  }

  render();
  return {
    // 熟成画面／スキル強化画面のどちらが閉じて戻ってきた時も、
    // afterChildSceneに積んである「次にすべきこと」をそのまま実行する
    // （confirmFeed/processFeedAllNextがそこにafterGrowthを積んでいる
    // -- 積んでいなければ通常の再描画で良い）。
    onResume: () => {
      if (afterChildScene) {
        const fn = afterChildScene;
        afterChildScene = null;
        fn();
        return;
      }
      render();
    },
  };
}

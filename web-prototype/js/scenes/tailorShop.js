import { renderScreen, button, h } from "../dom.js";
import state, { craftAndStoreCoating } from "../state.js";
import {
  NATURAL_RESOURCES,
  RIGID_RESOURCES,
  COATING_PATTERN_MATERIALS,
  COATING_FLAVOR_MATERIALS,
  nameCoating,
  formatMastery,
  describeCoating,
} from "../data/resourceCatalog.js";

const BASE_CREAM_COST = 10;
// Real 2s by default, matching 武器製造画面's own pacing/hook convention
// (window.__FORGE_FAST__) -- window.__TAILOR_FAST__ speeds this up for
// tests without touching production behavior.
const PRODUCE_DELAY_MS = typeof window !== "undefined" && window.__TAILOR_FAST__ ? 20 : 2000;

// A pattern/flavor reservation (from pickLowestQualityNatural/
// pickLowestQualityFrame) is one of {tierBreakdown}/{instanceIds}/
// {flatQuantity} -- sum it down to a plain count, same idea as
// weaponForge.js's own local frameQuantity.
function reservationQuantity(reservation) {
  if (reservation.tierBreakdown) return Object.values(reservation.tierBreakdown).reduce((a, b) => a + b, 0);
  if (reservation.instanceIds) return reservation.instanceIds.length;
  return reservation.flatQuantity;
}

// 仕立画面. Lays out the recipe as パターン×フレーバー＝作成結果:
//  - 原料１（パターン、自然資源）と原料２（フレーバー、剛体資源）は
//    どちらも空の状態で開き、枠をクリックするたびに資源置き場画面の
//    専用モード（パターン選択／フレーバー選択）を呼び出して選び直せる
//    （既にセットされていても、いつでも選び直せる -- 鍛冶画面のフレーム
//    と違って一度きりの確定ではない）。パターン/フレーバーは別々の
//    資源プール（自然資源/剛体資源）から取るので、互いの選択がもう
//    片方の候補を減らすことはない。
//  - 「作成結果」枠は、両方セットされた時点で（数量が足りていなくても）
//    グレーアウトが外れ、「作成予想」を表示する（過去の作成回数から、
//    このパターン・フレーバーの組み合わせが何着目のどの熟練度に
//    当たるかを逆算する -- state.jsのcoatingCraftCounts参照）。
//  - 「作成開始！」（両方が必要数量ぶんセットされ、ベースクリーム
//    ×10以上を持っている時だけ有効）は「作成中…」を2秒間挟んで
//    「作成完了！」に変わる。「作成完了！」を押すと、原料１/原料２・
//    作成結果をすべてクリアして最初の状態に戻る（画面は閉じない --
//    同じ来店中に何着でも作り続けられる）。
export function TailorShopScene(container, params, api) {
  let patternPick = null;
  let flavorPick = null;
  let pendingSelection = null; // "pattern" | "flavor" | null
  let phase = "idle"; // "idle" | "producing" | "result"
  let resultCoating = null;
  let resultExpanded = false;

  function patternRequired() {
    return patternPick ? COATING_PATTERN_MATERIALS[patternPick.speciesId].quantity : null;
  }
  function flavorRequired() {
    return flavorPick ? COATING_FLAVOR_MATERIALS[flavorPick.speciesId].quantity : null;
  }

  function canCraft() {
    if (!patternPick || !flavorPick) return false;
    if (reservationQuantity(patternPick) < patternRequired()) return false;
    if (reservationQuantity(flavorPick) < flavorRequired()) return false;
    return (state.run.resources.natural.baseCream ?? 0) >= BASE_CREAM_COST;
  }

  function warningText() {
    if (!patternPick) return "原料１（パターン）が選択されていません。";
    if (!flavorPick) return "原料２（フレーバー）が選択されていません。";
    if (reservationQuantity(patternPick) < patternRequired()) return "原料１（パターン）の数量が不足しています。";
    if (reservationQuantity(flavorPick) < flavorRequired()) return "原料２（フレーバー）の数量が不足しています。";
    if ((state.run.resources.natural.baseCream ?? 0) < BASE_CREAM_COST) return "ベースクリームが不足しています。";
    return null;
  }

  // 作成予想：過去にこのattribute/effectの組み合わせを作った回数から、
  // 今回の作成が何着目のどの熟練度に当たるかを逆算する。5回ごとに
  // 新しい一着が始まる（熟練度は0扱い、名前は初回のみ「？？？」）ので、
  // pastCraftCount % 5 がそのまま「現在の熟練度」、
  // floor(pastCraftCount / 5) + 1 が「何着目か」になる。
  function previewText() {
    if (!patternPick || !flavorPick) return null;
    const { effect } = COATING_PATTERN_MATERIALS[patternPick.speciesId];
    const { attribute } = COATING_FLAVOR_MATERIALS[flavorPick.speciesId];
    const pastCraftCount = state.coatingCraftCounts[`${attribute}_${effect}`] ?? 0;
    const name = pastCraftCount === 0 ? "？？？" : nameCoating(attribute, effect);
    const pieceLabel = pastCraftCount >= 5 ? ` ${Math.floor(pastCraftCount / 5) + 1}着目` : "";
    return `${name}${pieceLabel} ${formatMastery(pastCraftCount % 5)}`;
  }

  function openPatternSelect() {
    pendingSelection = "pattern";
    api.callScene("resourceStorage", { mode: "patternSelect" });
  }

  function openFlavorSelect() {
    pendingSelection = "flavor";
    api.callScene("resourceStorage", { mode: "flavorSelect" });
  }

  function startCraft() {
    if (!canCraft()) return;
    phase = "producing";
    render();
    setTimeout(() => {
      resultCoating = craftAndStoreCoating(patternPick, flavorPick);
      phase = "result";
      render();
    }, PRODUCE_DELAY_MS);
  }

  function finishCraft() {
    patternPick = null;
    flavorPick = null;
    phase = "idle";
    resultCoating = null;
    resultExpanded = false;
    render();
  }

  function toggleResultDetail() {
    resultExpanded = !resultExpanded;
    render();
  }

  function render() {
    const patternBox = h(
      "div",
      {
        class: `panel forge-box${phase === "idle" ? " forge-box--clickable" : ""}`,
        onClick: phase === "idle" ? openPatternSelect : undefined,
      },
      [
        h("p", { class: "field-label", text: "原料１（パターン）" }),
        h("p", {
          class: "lead",
          text: patternPick ? `${NATURAL_RESOURCES[patternPick.speciesId].name}×${reservationQuantity(patternPick)}` : "（未選択）",
        }),
      ]
    );

    const flavorBox = h(
      "div",
      {
        class: `panel forge-box${phase === "idle" ? " forge-box--clickable" : ""}`,
        onClick: phase === "idle" ? openFlavorSelect : undefined,
      },
      [
        h("p", { class: "field-label", text: "原料２（フレーバー）" }),
        h("p", {
          class: "lead",
          text: flavorPick ? `${RIGID_RESOURCES[flavorPick.speciesId].name}×${reservationQuantity(flavorPick)}` : "（未選択）",
        }),
      ]
    );

    const resultChildren = [h("p", { class: "field-label", text: "作成結果" })];
    if (phase === "result" && resultCoating) {
      resultChildren.push(h("p", { class: "lead", text: resultCoating.name }));
      resultChildren.push(
        h("div", { class: "slot__actions" }, [
          button(resultExpanded ? "詳細を隠す" : "詳細表示", { variant: "ghost", onClick: toggleResultDetail }),
        ])
      );
      if (resultExpanded) resultChildren.push(h("p", { class: "lead", text: describeCoating(resultCoating) }));
    } else if (patternPick && flavorPick) {
      resultChildren.push(h("p", { class: "lead", text: previewText() }));
    } else {
      resultChildren.push(h("p", { class: "lead", text: "（未作成）" }));
    }
    const resultBox = h("div", { class: `panel forge-box${!patternPick || !flavorPick ? " forge-box--disabled" : ""}` }, resultChildren);

    const body = [
      h("p", {
        class: "lead",
        text: `原料（パターン／フレーバー）を選択してください。1回の作成につき、ベースクリーム×${BASE_CREAM_COST}を消費します。`,
      }),
      h("div", { class: "forge-formula" }, [
        patternBox,
        h("span", { class: "forge-formula__operator", text: "×" }),
        flavorBox,
        h("span", { class: "forge-formula__operator", text: "＝" }),
        resultBox,
      ]),
    ];
    const warning = phase === "idle" ? warningText() : null;
    if (warning) body.push(h("p", { class: "lead", style: "color: var(--danger-strong)", text: warning }));

    const actions = [button("店を出る", { variant: "ghost", disabled: phase === "producing", onClick: () => api.closeScene() })];
    if (phase === "idle") {
      actions.push(button("作成開始！", { variant: "primary", disabled: !canCraft(), onClick: startCraft }));
    } else if (phase === "producing") {
      actions.push(button("作成中…", { variant: "primary", disabled: true }));
    } else {
      actions.push(button("作成完了！", { variant: "primary", onClick: finishCraft }));
    }

    renderScreen(container, {
      eyebrow: "WORKSHOP / TAILOR",
      title: "仕立て屋",
      body,
      onPause: () => api.callScene("pause"),
      actions,
    });
  }

  render();
  return {
    onResume: (result) => {
      if (result?.speciesId) {
        if (pendingSelection === "pattern") patternPick = result;
        else if (pendingSelection === "flavor") flavorPick = result;
      }
      pendingSelection = null;
      render();
    },
  };
}

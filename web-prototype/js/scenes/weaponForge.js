import { renderScreen, button, h } from "../dom.js";
import state, { craftAndStoreWeapon } from "../state.js";
import { WEAPON_TYPES, RIGID_RESOURCES, SYNERGIES, describeWeapon, getWeaponDisplayName, pickLowestQualityFrame } from "../data/resourceCatalog.js";

const BASE_CREAM_COST = 5;
// Real 2s by default -- purely for player feel (see the user's own
// comparison to 探索イベント's pacing), so a debug hook speeds it up
// for tests the same way __EXPLORATION_FAST__ does there.
const PRODUCE_DELAY_MS = typeof window !== "undefined" && window.__FORGE_FAST__ ? 20 : 2000;

function frameQuantity(reservation) {
  if (reservation.tierBreakdown) return Object.values(reservation.tierBreakdown).reduce((a, b) => a + b, 0);
  if (reservation.instanceIds) return reservation.instanceIds.length;
  return reservation.flatQuantity;
}

function weaponSynergyNames(weaponTypeId) {
  return WEAPON_TYPES[weaponTypeId].synergies.map((id) => SYNERGIES[id].name).join(" / ");
}

// 武器製造画面. Called from smithy.js with params.weaponTypeId (already
// gated there on hasEnoughFrame). Lays out the recipe as
// フレーム×モジュール＝結果:
//  - フレーム (原料１) is fixed the moment this screen mounts --
//    pickLowestQualityFrame reserves the required quantity from the
//    player's lowest-quality holdings once, and it's never
//    recomputed, matching the spec (only モジュール can be changed).
//  - モジュール (原料２) starts empty; clicking its box calls
//    resourceStorage.js in its own "moduleSelect" mode (passing the
//    フレーム reservation along so that screen can't offer units
//    already earmarked as フレーム -- see resourcesMinusFrameReservation),
//    which returns the chosen unit's exact stats.
//  - "製造開始！" (enabled once a module is picked and the player holds
//    >=5 ベースクリーム) walks フレーム／モジュール／ベースクリーム
//    payment plus the actual craftAndStoreWeapon call through a
//    "producing" phase (no interaction at all during the wait, exactly
//    like phase②'s progress bars) into a "result" phase showing the
//    new weapon. "すぐに装備させる" there reuses squadFormation's own
//    "swap" mode outright (the weapon is already sitting in
//    storedWeapons at this point, same as any other 未装備武器) --
//    completing that swap cascades this screen closed too, all the way
//    back to 鍛冶画面, rather than leaving a now-stale result on screen.
export function WeaponForgeScene(container, params, api) {
  const weaponTypeId = params.weaponTypeId;
  const frame = WEAPON_TYPES[weaponTypeId].frame;
  const frameReservation = pickLowestQualityFrame(state.run.resources, frame.speciesId, frame.quantity);

  let modulePick = null;
  let phase = "idle"; // "idle" | "producing" | "result"
  let resultWeapon = null;
  let resultExpanded = false;

  function canProduce() {
    return Boolean(modulePick) && (state.run.resources.natural.baseCream ?? 0) >= BASE_CREAM_COST;
  }

  function warningText() {
    if (!modulePick) return "原料２（モジュール）が選択されていません。";
    if ((state.run.resources.natural.baseCream ?? 0) < BASE_CREAM_COST) return "ベースクリームが不足しています。";
    return null;
  }

  function openModuleSelect() {
    api.callScene("resourceStorage", { mode: "moduleSelect", frameReservation });
  }

  function startProduce() {
    if (!canProduce()) return;
    phase = "producing";
    render();
    setTimeout(() => {
      resultWeapon = craftAndStoreWeapon(weaponTypeId, frameReservation, modulePick);
      phase = "result";
      render();
    }, PRODUCE_DELAY_MS);
  }

  function toggleResultDetail() {
    resultExpanded = !resultExpanded;
    render();
  }

  function equipNow() {
    api.callScene("squadFormation", { mode: "swap", weapon: resultWeapon });
  }

  function render() {
    const frameBox = h("div", { class: "panel forge-box" }, [
      h("p", { class: "field-label", text: "原料１（フレーム）" }),
      h("p", { class: "lead", text: `${RIGID_RESOURCES[frameReservation.speciesId].name}×${frameQuantity(frameReservation)}` }),
    ]);

    const moduleBox = h(
      "div",
      {
        class: `panel forge-box${phase === "idle" ? " forge-box--clickable" : ""}`,
        onClick: phase === "idle" ? openModuleSelect : undefined,
      },
      [
        h("p", { class: "field-label", text: "原料２（モジュール）" }),
        h("p", { class: "lead", text: modulePick ? modulePick.displayName : "（未選択）" }),
      ]
    );

    const resultChildren = [h("p", { class: "field-label", text: "製造結果" })];
    if (phase === "result" && resultWeapon) {
      resultChildren.push(h("p", { class: "lead", text: getWeaponDisplayName(resultWeapon) }));
      resultChildren.push(
        h("div", { class: "slot__actions" }, [
          button(resultExpanded ? "詳細を隠す" : "詳細表示", { variant: "ghost", onClick: toggleResultDetail }),
          button("すぐに装備させる", { variant: "primary", onClick: equipNow }),
        ])
      );
      if (resultExpanded) {
        resultChildren.push(h("p", { class: "lead", text: describeWeapon(resultWeapon) }));
        resultChildren.push(h("p", { class: "lead", text: `シナジー：${weaponSynergyNames(resultWeapon.baseTypeId)}` }));
      }
    } else {
      resultChildren.push(h("p", { class: "lead", text: "（未製造）" }));
    }
    const resultBox = h("div", { class: `panel forge-box${phase !== "result" ? " forge-box--disabled" : ""}` }, resultChildren);

    const body = [
      h("p", {
        class: "lead",
        text: `原料（フレーム／モジュール）を選択してください。1回の製造につき、ベースクリーム×${BASE_CREAM_COST}を消費します。`,
      }),
      h("div", { class: "forge-formula" }, [
        frameBox,
        h("span", { class: "forge-formula__operator", text: "×" }),
        moduleBox,
        h("span", { class: "forge-formula__operator", text: "＝" }),
        resultBox,
      ]),
    ];
    const warning = phase === "idle" ? warningText() : null;
    if (warning) body.push(h("p", { class: "lead", style: "color: var(--danger-strong)", text: warning }));

    const actions = [];
    if (phase === "idle") {
      actions.push(button("キャンセル", { variant: "ghost", onClick: () => api.closeScene() }));
      actions.push(button("製造開始！", { variant: "primary", disabled: !canProduce(), onClick: startProduce }));
    } else if (phase === "producing") {
      actions.push(button("製造中…", { variant: "primary", disabled: true }));
    } else {
      actions.push(button("製造完了！", { variant: "primary", onClick: () => api.closeScene() }));
    }

    renderScreen(container, {
      eyebrow: "WORKSHOP / SMITHY / FORGE",
      title: "武器製造",
      body,
      onPause: () => api.callScene("pause"),
      actions,
    });
  }

  render();
  return {
    onResume: (result) => {
      if (result?.swapped) {
        api.closeScene();
        return;
      }
      if (result?.speciesId) {
        modulePick = result;
      }
      render();
    },
  };
}

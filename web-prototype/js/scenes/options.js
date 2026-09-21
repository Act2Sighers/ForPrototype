import { renderScreen, button, h } from "../dom.js";
import state, {
  setBattleTuning,
  STAMINA_RANGE_CAP_MIN,
  STAMINA_RANGE_CAP_MAX,
  STAMINA_CORRECTION_MULTIPLIER_MIN,
  STAMINA_CORRECTION_MULTIPLIER_MAX,
  STAMINA_NATURAL_DECAY_MIN,
  STAMINA_NATURAL_DECAY_MAX,
} from "../state.js";

// オプション画面：現状は「体幹関連係数」のみ。実プレイでスマッシュ/
// プロテクトが強すぎると感じた手応えを受け、バトルの体幹まわりの数式
// （被ダメージ補正倍率・変動幅の上限・毎ターンの自然逓減量）を調整
// できるデバッグオプション。値はセーブデータの一部ではなく、アプリ
// 全体のグローバル設定（state.battleTuning、state.js参照）としてこの
// セッション中保持される。
function tuningRow({ label, description, key, min, max, step }) {
  const currentValue = state.battleTuning[key];
  const inputId = `tuning-${key}`;
  return h("div", { class: "panel" }, [
    h("div", { class: "field-group" }, [
      h("label", { class: "field-label", for: inputId, text: label }),
      h("p", { class: "lead", text: description }),
      h("div", { class: "qty-input-row" }, [
        h("input", {
          id: inputId,
          type: "number",
          class: "qty-input",
          min: String(min),
          max: String(max),
          step: String(step),
          value: String(currentValue),
          onchange: (e) => {
            const raw = Number(e.target.value);
            const clamped = Number.isFinite(raw) ? Math.min(max, Math.max(min, raw)) : currentValue;
            setBattleTuning(key, clamped);
            e.target.value = String(clamped);
          },
        }),
      ]),
    ]),
  ]);
}

export function OptionsScene(container, params, api) {
  const body = [
    h("p", { class: "field-label", text: "体幹関連係数" }),
    tuningRow({
      label: "体幹変動幅上限",
      description: "体幹の絶対値がこの値までしか変動しなくなります（例：5なら装甲5〜脆弱性5の範囲に収まります）。",
      key: "staminaRangeCap",
      min: STAMINA_RANGE_CAP_MIN,
      max: STAMINA_RANGE_CAP_MAX,
      step: 1,
    }),
    tuningRow({
      label: "体幹補正倍率",
      description: "体幹による被ダメージの変化倍率です（×補正倍率^(-1×体幹)。例：補正倍率2.0なら体幹1につき半減/倍増）。",
      key: "staminaCorrectionMultiplier",
      min: STAMINA_CORRECTION_MULTIPLIER_MIN,
      max: STAMINA_CORRECTION_MULTIPLIER_MAX,
      step: 0.1,
    }),
    tuningRow({
      label: "体幹自然逓減量",
      description: "毎ターン終了時に体幹が0へ向けて逓減する量です（正の体幹はこの分だけ減少、負の体幹はこの分だけ増加、いずれも0を超えては動きません）。",
      key: "staminaNaturalDecay",
      min: STAMINA_NATURAL_DECAY_MIN,
      max: STAMINA_NATURAL_DECAY_MAX,
      step: 1,
    }),
  ];

  renderScreen(container, {
    eyebrow: "SETTINGS",
    title: "オプション",
    body,
    actions: [button("戻る", { variant: "ghost", onClick: () => api.closeScene() })],
  });
  return {};
}

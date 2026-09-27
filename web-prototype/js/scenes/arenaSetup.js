import { renderScreen, button, h } from "../dom.js";
import state from "../state.js";
import { CHARACTER_DATA } from "../data/resourceCatalog.js";
import { arenaEnemyTemplate } from "../data/arena.js";

// 訓練所（アリーナ画面）：プレイヤーが任意の味方編成・敵配置・諸設定を
// 決めて、その通りの戦闘（battle.jsのアリーナモード）を実行できる
// シミュレーション機能。実際の設定項目（味方ロースター/敵ロースター/
// 一括設定・ランダム・テンプレート・プリセット）は後続のステップで
// 追加する -- このステップではワールド画面からの入場動線と、Step1/2で
// 用意したデータ層（state.arenaConfig）が実際に読み書きできることの
// 配線だけを行う。
export function ArenaSetupScene(container, params, api) {
  function allySummaryLine(slot) {
    return `${CHARACTER_DATA[slot.dataId].name} Lv.${slot.level}`;
  }

  function enemySummaryLine(slot) {
    const data = arenaEnemyTemplate(slot.kind, slot.dataId);
    return `${data.name}×${slot.count} Lv.${slot.level}`;
  }

  function render() {
    const config = state.arenaConfig;

    const body = [
      h("div", { class: "field-group" }, [
        h("p", { class: "field-label", text: "味方陣営" }),
        h("p", { class: "lead", text: config.allies.map(allySummaryLine).join(" / ") }),
      ]),
      h("div", { class: "field-group" }, [
        h("p", { class: "field-label", text: "敵陣営" }),
        h("p", { class: "lead", text: config.enemies.map(enemySummaryLine).join(" / ") }),
      ]),
      h("p", { class: "lead", text: "詳細な設定項目は今後のステップで追加されます。" }),
    ];

    renderScreen(container, {
      eyebrow: "TRAINING GROUNDS",
      title: "訓練所",
      subtitle: "任意の組み合わせで戦闘をシミュレーションできます。",
      body,
      onPause: () => api.callScene("pause"),
      actions: [button("戻る", { variant: "ghost", onClick: () => api.closeScene() })],
    });
  }

  render();
  return { onResume: () => render() };
}

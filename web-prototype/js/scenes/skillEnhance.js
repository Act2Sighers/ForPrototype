import { renderScreen, button, h } from "../dom.js";
import { skillLabel } from "./battle.js";
import { pendingSkillEnhancements, applySkillEnhancement } from "../data/characterSkills.js";

// 隊員の能力値が成長する全てのタイミング（熟成画面/探索イベント）の
// 直後に、squadFormation.js/exploration.js側のmaybeStartSkillEnhancement
// 呼び出し経由でのみ呼ばれる。責務は単純：渡された隊員の現在の未実行
// 強化項目を並べ、プレイヤーが選んだ1つだけを実行して閉じるだけ。
// 退出用ボタン・ポーズボタンは無い（この画面自体を素通りする手段が
// 無い -- 呼び出し元が「まだ強化が必要」と判断した時にしか呼ばれない
// ため、選ばずに閉じる理由が無い）。
export function SkillEnhanceScene(container, params, api) {
  const { character } = params;
  // pendingSkillEnhancements()はレンダーの度に新しいオブジェクトを返す
  // ため、選択中の項目をオブジェクト参照で覚えておくと次のrender()で
  // 誰とも一致しなくなり、確認行が二度と出せなくなる。内容から作る
  // 安定したキーで比較する。
  function itemKey(item) {
    return item.type === "growth" ? `growth:${item.from}->${item.to}` : `acquire:${item.skillId}`;
  }
  let pendingChoiceKey = null;

  function itemLabel(item) {
    if (item.type === "growth") return `成長: 【${skillLabel(item.from)}】→【${skillLabel(item.to)}】`;
    return `修得: 【${skillLabel(item.skillId)}】`;
  }

  function confirmChoice(item) {
    applySkillEnhancement(character, item);
    api.closeScene();
  }

  function itemRow(item) {
    const label = itemLabel(item);
    if (pendingChoiceKey === itemKey(item)) {
      return h("div", { class: "panel" }, [
        h("div", { class: "confirm-row" }, [
          h("span", { class: "confirm-row__text", text: `${label}を実行します。よろしいですか？` }),
          button("実行する", { variant: "primary", onClick: () => confirmChoice(item) }),
          button("キャンセル", { variant: "ghost", onClick: () => { pendingChoiceKey = null; render(); } }),
        ]),
      ]);
    }
    return h("div", { class: "panel" }, [
      h("div", { class: "row-between" }, [
        h("span", { class: "slot__name", text: label }),
        button("選択", { variant: "primary", onClick: () => { pendingChoiceKey = itemKey(item); render(); } }),
      ]),
    ]);
  }

  function render() {
    const items = pendingSkillEnhancements(character.dataId, character.skills);
    renderScreen(container, {
      eyebrow: "SKILL UP",
      title: "スキル強化",
      subtitle: `${character.name}（Lv.${character.level}）\n実行したいスキル強化項目を選んでください。`,
      body: items.map(itemRow),
    });
  }

  render();
  return { onResume: () => render() };
}

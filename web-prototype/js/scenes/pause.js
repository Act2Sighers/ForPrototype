import { renderScreen, button, h } from "../dom.js";
import { autoSave } from "../state.js";

export function PauseScene(container, params, api) {
  renderScreen(container, {
    eyebrow: "PAUSED",
    title: "ポーズ",
    body: h("p", { class: "lead", text: "任意のタイミングで実行できる操作です。" }),
    actions: [
      button("再開する", { variant: "primary", onClick: () => api.closeScene() }),
      button("セーブ", { onClick: () => api.callScene("saveSlot", { mode: "save" }) }),
      button("ロード", { onClick: () => api.callScene("saveSlot", { mode: "load" }) }),
      button("オプション", { onClick: () => api.callScene("options") }),
      button("タイトルへ", {
        variant: "danger",
        onClick: () => {
          // Auto-saves the current progress so leaving without a manual
          // save first never loses it — see state.js's autoSave().
          autoSave();
          api.navigateTo("title");
        },
      }),
    ],
  });
  return {};
}

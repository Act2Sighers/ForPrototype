import { renderScreen, button, h, resourceHud } from "../dom.js";
import { SCENE_LABELS } from "../labels.js";
import state from "../state.js";

// Novel-style presentation: a portrait area + a bottom textbox. Choice
// branching is planned but out of scope for this skeleton — right now
// there is exactly one line, and advancing it closes the scene.
export function EpisodeScene(container, params, api) {
  const callerLabel = SCENE_LABELS[params.fromScene] ?? "呼び出し元画面";
  const line = `ストーリーを表示します。${callerLabel}に戻ります。`;

  function finish() {
    api.closeScene();
  }

  renderScreen(container, {
    eyebrow: "EPISODE",
    title: "エピソード",
    corner: resourceHud(state.run?.resources),
    body: h("div", { class: "episode-stage" }, [
      h("div", { class: "episode-textbox", onClick: finish }, [
        h("p", { class: "episode-textbox__name", text: "ナレーション" }),
        h("p", { text: line }),
      ]),
    ]),
    actions: [
      button("ポーズ", { variant: "ghost", onClick: () => api.callScene("pause") }),
      button("すすめる", { variant: "primary", onClick: finish }),
    ],
  });

  return {};
}

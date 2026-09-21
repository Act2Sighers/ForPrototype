import { renderScreen, button, h } from "../dom.js";
import state from "../state.js";
import { EPISODE_ARCHIVE_ENTRIES } from "../data/scripts.js";

// 探査記録画面（宿舎から入る）：これまでに読み終えた台本
// （オープニング/遭遇/エンディング/休憩71本）を一覧表示し、クリックで
// episode.jsの回想モード（mode: "recall"）を呼び出して読み返せる。
// 並び順はEPISODE_ARCHIVE_ENTRIESの並び順（ダンジョン固有3本→隊員
// エピソード71本）をそのまま使い、未読（state.seenEpisodeIdsに無い）
// ものは表示しない。
export function ArchiveScene(container, params, api) {
  function entryRow(entry) {
    return h("div", { class: "panel", onClick: () => api.callScene("episode", { mode: "recall", scriptId: entry.id }) }, [
      h("div", { class: "slot__meta" }, [h("span", { class: "slot__name", text: entry.title })]),
    ]);
  }

  function render() {
    const seenEntries = EPISODE_ARCHIVE_ENTRIES.filter((entry) => state.seenEpisodeIds.includes(entry.id));

    const body = [
      seenEntries.length
        ? h("div", { class: "slot-list" }, seenEntries.map(entryRow))
        : h("p", { class: "lead", text: "まだ読んだ記録がありません。" }),
    ];

    renderScreen(container, {
      eyebrow: "ARCHIVE",
      title: "探査記録",
      subtitle: "これまでに読んだ記録を読み返せます。",
      body,
      onPause: () => api.callScene("pause"),
      actions: [button("戻る", { variant: "ghost", onClick: () => api.closeScene() })],
    });
  }

  render();
  return { onResume: () => render() };
}

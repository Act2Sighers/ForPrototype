import { renderScreen, button, h } from "../dom.js";
import state, { retryRun, endRun, settleRunEnd, autoSave } from "../state.js";

const MODE_INFO = {
  clear: { label: "クリア", className: "is-clear" },
  gameover: { label: "ゲームオーバー", className: "is-gameover" },
};

// computeRunScoreのbreakdownキー -> 内訳表示の見出し。resourceQuality
// だけ「品質加点」という総称ラベルにする（種別ごとの明細までは出さない）。
const SCORE_BREAKDOWN_LABELS = {
  reachedNode: "到達マス数",
  characterLevel: "隊員レベル合計",
  weaponPerformance: "武器性能合計",
  defeatedMonsterLevel: "討伐レベル合計",
  rescuePenalty: "戦闘後救済",
  resourceQuality: "資源品質加点",
};

export function ResultScene(container, params, api) {
  const mode = params.mode;
  if (mode !== "clear" && mode !== "gameover") {
    throw new Error('result scene requires params.mode of "clear" or "gameover"');
  }
  const info = MODE_INFO[mode];
  const visitedCount = state.run?.visitedNodeIds.length ?? 0;

  // The run ends the moment its result is shown, regardless of which
  // button the player picks next: formation/standby move to retired now
  // (see settleRunEnd's own guard against running twice for this run,
  // which also computes state.run.finalScore before that happens).
  settleRunEnd(mode);
  const score = state.run?.finalScore ?? { total: 0, breakdown: {} };

  renderScreen(container, {
    eyebrow: "RESULT",
    title: "リザルト",
    body: [
      h("p", { class: `result-banner ${info.className}`, text: info.label }),
      h("div", { class: "result-grid" }, [
        h("div", { class: "stat-tile" }, [
          h("p", { class: "stat-tile__label", text: "到達マス数" }),
          h("p", { class: "stat-tile__value", text: String(visitedCount) }),
        ]),
        h("div", { class: "stat-tile" }, [
          h("p", { class: "stat-tile__label", text: "スコア" }),
          h("p", { class: "stat-tile__value", text: String(score.total) }),
        ]),
      ]),
      h("div", { class: "panel" }, [
        h("p", { class: "field-label", text: "スコア内訳" }),
        ...Object.entries(score.breakdown).map(([key, value]) =>
          h("p", { class: "row-between" }, [
            h("span", { text: SCORE_BREAKDOWN_LABELS[key] ?? key }),
            h("span", { text: value >= 0 ? `+${value}` : String(value) }),
          ])
        ),
      ]),
    ],
    actions: [
      button("再挑戦", {
        variant: "primary",
        onClick: () => {
          retryRun();
          api.navigateTo("map");
        },
      }),
      button("挑戦終了", {
        onClick: () => {
          endRun();
          api.navigateTo("world");
        },
      }),
      button("タイトルへ", {
        variant: "ghost",
        onClick: () => {
          endRun();
          // Auto-save with no run in progress so an autosave-load lands
          // at the world screen rather than resuming a concluded run.
          autoSave();
          api.navigateTo("title");
        },
      }),
    ],
  });

  return {};
}

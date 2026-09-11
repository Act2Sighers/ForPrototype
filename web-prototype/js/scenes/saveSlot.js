import { renderScreen, button, h } from "../dom.js";
import state, { saveToSlot, deleteSlot, duplicateSlot, loadSlot } from "../state.js";

const MODE_LABEL = { save: "セーブ", load: "ロード" };

// Every action that touches save data (save / overwrite / load / delete /
// duplicate) requires one confirm tap before it actually runs.
const CONFIRM_TEXT = {
  save: "このスロットにセーブします。よろしいですか？",
  overwrite: "このスロットのデータを上書きします。よろしいですか？",
  load: "このデータをロードします。よろしいですか？",
  delete: "このデータを消去します。元に戻せません。よろしいですか？",
  duplicate: "空きスロットにこのデータを複製します。よろしいですか？",
};

export function SaveSlotScene(container, params, api) {
  const mode = params.mode;
  if (mode !== "save" && mode !== "load") {
    throw new Error('saveSlot scene requires params.mode of "save" or "load"');
  }

  // At most one slot can have a pending (unconfirmed) action at a time.
  let pending = null; // { index, action }

  function formatSlot(slot) {
    if (!slot) return "（空きスロット）";
    const date = new Date(slot.savedAt);
    return `${slot.label} ・ ${date.toLocaleString("ja-JP")}`;
  }

  function runAction(action, index) {
    if (action === "save" || action === "overwrite") saveToSlot(index);
    else if (action === "delete") deleteSlot(index);
    else if (action === "duplicate") duplicateSlot(index);
    else if (action === "load") {
      loadSlot(index);
      // A save made mid-dungeon carries its run along; resume straight
      // into the map instead of always dropping the player at world.
      api.navigateTo(state.run ? "map" : "world");
      return;
    }
    pending = null;
    render();
  }

  function actionButton(label, action, index, variant, opts = {}) {
    return button(label, {
      variant,
      disabled: opts.disabled ?? false,
      onClick: () => {
        pending = { index, action };
        render();
      },
    });
  }

  function render() {
    const body = h("div", { class: "slot-list" });

    state.saveSlots.forEach((slot, index) => {
      const isEmpty = slot === null;
      const isPending = pending?.index === index;

      const rowClasses = ["slot"];
      if (isEmpty) rowClasses.push("slot--empty");
      if (isPending) rowClasses.push("slot--pending");

      let right;
      if (isPending) {
        right = h("div", { class: "confirm-row" }, [
          h("span", { class: "confirm-row__text", text: CONFIRM_TEXT[pending.action] }),
          button("実行する", {
            variant: pending.action === "delete" ? "danger" : "primary",
            onClick: () => runAction(pending.action, index),
          }),
          button("キャンセル", {
            variant: "ghost",
            onClick: () => {
              pending = null;
              render();
            },
          }),
        ]);
      } else {
        const actions = [];
        if (mode === "save") {
          actions.push(
            isEmpty
              ? actionButton("セーブする", "save", index, "primary")
              : actionButton("上書き", "overwrite", index, "danger")
          );
        } else if (!isEmpty) {
          actions.push(
            actionButton("ロード", "load", index, "primary"),
            actionButton("複製", "duplicate", index, "frost", {
              disabled: !state.saveSlots.some((s) => s === null),
            }),
            actionButton("消去", "delete", index, "danger")
          );
        }
        right = h("div", { class: "slot__actions" }, actions);
      }

      body.appendChild(
        h("div", { class: rowClasses.join(" ") }, [
          h("div", { class: "slot__meta" }, [
            h("span", { class: "slot__id", text: `SLOT ${index + 1}` }),
            h("span", { class: "slot__name", text: formatSlot(slot) }),
          ]),
          right,
        ])
      );
    });

    renderScreen(container, {
      eyebrow: `SAVE DATA / ${mode.toUpperCase()}`,
      title: `セーブスロット選択（${MODE_LABEL[mode]}）`,
      subtitle:
        mode === "save"
          ? "空きスロットへのセーブ、または既存スロットへの上書きができます。"
          : "セーブデータのロード・消去・空きスロットへの複製ができます。",
      body,
      actions: [button("戻る", { variant: "ghost", onClick: () => api.closeScene() })],
    });
  }

  render();
  return {};
}

import { renderScreen, button, h } from "../dom.js";
import state, { saveToSlot, deleteSlot, duplicateSlot, loadSlot } from "../state.js";

const MODE_LABEL = { save: "セーブ", load: "ロード" };

export function SaveSlotScene(container, params, api) {
  const mode = params.mode;
  if (mode !== "save" && mode !== "load") {
    throw new Error('saveSlot scene requires params.mode of "save" or "load"');
  }

  // Tracks a slot index awaiting a second click to confirm overwrite.
  let pendingOverwriteIndex = null;

  function formatSlot(slot) {
    if (!slot) return "（空きスロット）";
    const date = new Date(slot.savedAt);
    return `${slot.label} ・ ${date.toLocaleString("ja-JP")}`;
  }

  function render() {
    const body = h("div", { class: "slot-list" });

    state.saveSlots.forEach((slot, index) => {
      const isEmpty = slot === null;
      const isPending = pendingOverwriteIndex === index;

      const rowClasses = ["slot"];
      if (isEmpty) rowClasses.push("slot--empty");
      if (isPending) rowClasses.push("slot--pending");

      const actions = [];

      if (mode === "save") {
        if (isEmpty) {
          actions.push(
            button("セーブする", {
              variant: "primary",
              onClick: () => {
                saveToSlot(index);
                render();
              },
            })
          );
        } else if (isPending) {
          actions.push(
            button("上書きを確定", {
              variant: "danger",
              onClick: () => {
                saveToSlot(index);
                pendingOverwriteIndex = null;
                render();
              },
            }),
            button("取消", {
              variant: "ghost",
              onClick: () => {
                pendingOverwriteIndex = null;
                render();
              },
            })
          );
        } else {
          actions.push(
            button("上書き", {
              variant: "danger",
              onClick: () => {
                pendingOverwriteIndex = index;
                render();
              },
            })
          );
        }
      } else {
        // load mode
        if (!isEmpty) {
          actions.push(
            button("ロード", {
              variant: "primary",
              onClick: () => {
                loadSlot(index);
                api.navigateTo("dungeonSelect");
              },
            }),
            button("複製", {
              variant: "frost",
              disabled: !state.saveSlots.some((s) => s === null),
              onClick: () => {
                duplicateSlot(index);
                render();
              },
            }),
            button("消去", {
              variant: "danger",
              onClick: () => {
                deleteSlot(index);
                render();
              },
            })
          );
        }
      }

      body.appendChild(
        h("div", { class: rowClasses.join(" ") }, [
          h("div", { class: "slot__meta" }, [
            h("span", { class: "slot__id", text: `SLOT ${index + 1}` }),
            h("span", { class: "slot__name", text: formatSlot(slot) }),
          ]),
          h("div", { class: "slot__actions" }, actions),
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

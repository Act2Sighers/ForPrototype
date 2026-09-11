// Stack-based scene manager.
//
// This mirrors the two navigation primitives from the design doc:
//   - navigateTo(id, params): "遷移する" — closes every suspended screen
//     and moves to a fresh one. The stack is reset to a single entry.
//   - callScene(id, params):  "呼び出す" — suspends the current screen
//     and opens a new one on top of it.
//   - closeScene(result):     the generic "戻る" — pops the top screen
//     and resumes whatever was suspended underneath it.
//
// This shape was chosen because it maps directly onto how the same
// navigation will likely be built in Unity later: a small stack of UI
// controllers, not a page-per-scene setup.

export class SceneManager {
  constructor(root, registry, { onStackChange } = {}) {
    this.root = root;
    this.registry = registry;
    this.stack = [];
    this.onStackChange = onStackChange;

    this.api = {
      navigateTo: (id, params) => this._navigateTo(id, params),
      callScene: (id, params) => this._callScene(id, params),
      closeScene: (result) => this._closeScene(result),
      stackIds: () => this.stack.map((entry) => entry.id),
    };
  }

  _mount(id, params) {
    const factory = this.registry[id];
    if (!factory) throw new Error(`Unknown scene id: "${id}"`);
    const el = document.createElement("div");
    el.className = "screen";
    el.dataset.scene = id;
    this.root.appendChild(el);
    const instance = factory(el, params ?? {}, this.api) ?? {};
    return { id, params, el, instance };
  }

  _setActive(entry) {
    for (const e of this.stack) e.el.classList.remove("is-active");
    if (entry) entry.el.classList.add("is-active");
  }

  _navigateTo(id, params) {
    while (this.stack.length) {
      const entry = this.stack.pop();
      entry.instance.onExit?.();
      entry.el.remove();
    }
    const entry = this._mount(id, params);
    this.stack.push(entry);
    this._setActive(entry);
    this._emitStackChange();
  }

  _callScene(id, params) {
    const top = this.stack[this.stack.length - 1];
    top?.instance.onSuspend?.();
    const entry = this._mount(id, params);
    this.stack.push(entry);
    this._setActive(entry);
    this._emitStackChange();
  }

  _closeScene(result) {
    const top = this.stack.pop();
    if (!top) return;
    top.instance.onExit?.();
    top.el.remove();
    const under = this.stack[this.stack.length - 1];
    if (under) {
      this._setActive(under);
      under.instance.onResume?.(result);
    }
    this._emitStackChange();
  }

  _emitStackChange() {
    this.onStackChange?.(this.stack.map((entry) => entry.id));
  }
}

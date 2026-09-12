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

  // Pushes a new entry onto the stack and *then* runs its factory —
  // deliberately in that order. A scene's factory can call
  // api.callScene(...) synchronously during its own construction (e.g.
  // to immediately layer another scene on top, as map.js does for the
  // start-of-run hiring event); if the entry weren't on the stack yet
  // when that nested call looks up "the current top", it would find
  // whatever was there before this scene started mounting and insert
  // itself in the wrong place. Pushing first means `this.stack` always
  // reflects reality, even mid-construction.
  _pushMounted(id, params) {
    const factory = this.registry[id];
    if (!factory) throw new Error(`Unknown scene id: "${id}"`);
    const el = document.createElement("div");
    el.className = "screen";
    el.dataset.scene = id;
    this.root.appendChild(el);
    const entry = { id, params, el, instance: {} };
    this.stack.push(entry);
    entry.instance = factory(el, params ?? {}, this.api) ?? {};
    return entry;
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
    this._pushMounted(id, params);
    this._setActive(this.stack[this.stack.length - 1]);
    this._emitStackChange();
  }

  _callScene(id, params) {
    const top = this.stack[this.stack.length - 1];
    top?.instance.onSuspend?.();
    this._pushMounted(id, params);
    this._setActive(this.stack[this.stack.length - 1]);
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

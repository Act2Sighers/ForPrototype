import { renderScreen, button, h } from "../dom.js";
import {
  CHARACTER_BASE,
  CHARACTER_STAT_LABELS,
  CHARACTER_STAT_FULL_LABELS,
  WEAPON_STAT_LABELS,
  weaponStatRankLabel,
  getWeaponDisplayName,
  growCharacterStat,
} from "../data/resourceCatalog.js";

const GROWTH_STAT_KEYS = ["attack", "defense", "destruction", "wisdom", "coordination"];

function weaponDetailLine(character) {
  if (!character.weapon) {
    return h("p", { class: "maturation-weapon", text: "武器：なし" });
  }
  const weapon = character.weapon;
  const statText = Object.keys(WEAPON_STAT_LABELS)
    .map((key) => `${WEAPON_STAT_LABELS[key]}: ${weaponStatRankLabel(weapon.stats[key])}(${weapon.stats[key]})`)
    .join(" / ");
  return h("p", { class: "maturation-weapon", text: `武器: ${getWeaponDisplayName(weapon)} ［ ${statText} ］` });
}

// 熟成画面. 時間食の変換処理（squadFormation.jsのconfirmFeed/
// processFeedAllNext、実体はresourceCatalog.jsのapplyTimeEatsToCharacter）
// で成長ポイントが1以上出た時だけ呼ばれる -- レベルアップは必ず伴う
// ので、見出しの「レベルアップ！」は常に表示する。params:
// {character, growthPoints, levelBefore, levelAfter}。
// 画面下部には「割り振りを確定」しかなく（キャンセル不可 -- レベル
// アップ自体を取り消す手段は無いため）、成長ポイントを使い切るまでは
// グレーアウトしたまま押せない。確定するとgrowCharacterStatで各能力値
// の成長値に加算し、呼び出し元（squadFormation.js）へ戻る。
export function MaturationScene(container, params, api) {
  const { character, growthPoints, levelBefore, levelAfter } = params;
  const allocations = { attack: 0, defense: 0, destruction: 0, wisdom: 0, coordination: 0 };

  function remainingPoints() {
    return growthPoints - GROWTH_STAT_KEYS.reduce((sum, key) => sum + allocations[key], 0);
  }

  function handleAllocChange(key, rawValue) {
    let value = parseInt(rawValue, 10);
    if (!Number.isFinite(value) || value < 0) value = 0;
    const otherTotal = GROWTH_STAT_KEYS.reduce((sum, k) => sum + (k === key ? 0 : allocations[k]), 0);
    const maxForThis = growthPoints - otherTotal;
    if (value > maxForThis) value = maxForThis;
    allocations[key] = value;
    render();
  }

  function confirmAllocation() {
    for (const key of GROWTH_STAT_KEYS) {
      if (allocations[key] > 0) growCharacterStat(character, key, allocations[key]);
    }
    api.closeScene();
  }

  function allocRow(key) {
    const current = CHARACTER_BASE[key] + character.growth[key];
    const allocated = allocations[key];
    const next = current + allocated;
    const otherTotal = GROWTH_STAT_KEYS.reduce((sum, k) => sum + (k === key ? 0 : allocations[k]), 0);
    const maxForThis = growthPoints - otherTotal;
    return h("div", { class: "maturation-stat-row" }, [
      h("span", {
        class: `maturation-stat-row__label stat-${key}`,
        text: `${CHARACTER_STAT_LABELS[key]}(${CHARACTER_STAT_FULL_LABELS[key]}):`,
      }),
      h("span", { class: "maturation-stat-row__current", text: String(current) }),
      h("span", { class: "maturation-stat-row__arrow", text: "→" }),
      h("span", { class: "maturation-stat-row__next", text: String(next) }),
      h("div", { class: "qty-input-row" }, [
        h("span", { class: "field-label", text: "割り振り" }),
        h("input", {
          type: "number",
          class: "qty-input",
          min: "0",
          max: String(maxForThis),
          value: String(allocated),
          onchange: (e) => handleAllocChange(key, e.target.value),
        }),
      ]),
    ]);
  }

  function render() {
    const remaining = remainingPoints();
    renderScreen(container, {
      eyebrow: "MATURATION",
      title: "熟成画面",
      subtitle: `成長ポイントを能力値に割り振ってください。\n（成長ポイント: ${remaining} / ${growthPoints}）`,
      body: [
        h("div", { class: "maturation-header" }, [
          h("span", { class: "maturation-header__name", text: character.name }),
          h("span", { class: "maturation-header__level", text: `Lv.${levelBefore} → Lv.${levelAfter}` }),
          h("span", { class: "maturation-header__levelup", text: "レベルアップ！" }),
        ]),
        weaponDetailLine(character),
        ...GROWTH_STAT_KEYS.map(allocRow),
      ],
      actions: [
        button("割り振りを確定", { variant: "primary", disabled: remaining !== 0, onClick: confirmAllocation }),
      ],
    });
  }

  render();
  return { onResume: () => render() };
}

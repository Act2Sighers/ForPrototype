const { test, expect } = require('@playwright/test');

// 訓練所（アリーナ画面）：味方/敵ロースターの初期値・編集・一括設定・
// プリセットが仕様通り機能することを検証する。戦闘そのものの検証は
// training-grounds-battle.spec.js側で行う。

async function openTrainingGrounds(page) {
  await page.goto('/index.html');
  await page.waitForSelector('.screen-title');
  await page.getByRole('button', { name: 'はじめから', exact: true }).click();
  await page.locator('.screen.is-active').getByRole('button', { name: '訓練所', exact: true }).click();
  await page.locator('.screen.is-active').getByRole('button', { name: '入場', exact: true }).click();
  await page.waitForSelector('.screen.is-active .screen-title:text("訓練所")');
}

function scope(page) {
  return page.locator('.screen.is-active');
}

function groupByLabel(page, text) {
  return scope(page).locator('.field-group', { has: page.locator('.field-label', { hasText: text }) }).first();
}

test('初期値：味方3人・敵3種（カルメヤ犬/メレンゲ猫/チョコロック）・変調は発生する', async ({ page }) => {
  await openTrainingGrounds(page);

  const allyHeader = await scope(page).locator('.field-label').first().innerText();
  expect(allyHeader).toContain('味方陣営（3/6）');

  const allyNames = await scope(page).locator('.slot-list').nth(0).locator('.slot__name').allInnerTexts();
  expect(allyNames.join(' ')).toContain('フレーク・シュガー');
  expect(allyNames.join(' ')).toContain('キューブ・シュガー');
  expect(allyNames.join(' ')).toContain('ハニー・スクリュー');

  const enemyNames = await scope(page).locator('.slot-list').nth(1).locator('.slot__name').allInnerTexts();
  expect(enemyNames.join(' ')).toContain('カルメヤ犬');
  expect(enemyNames.join(' ')).toContain('メレンゲ猫');
  expect(enemyNames.join(' ')).toContain('チョコロック');

  const conditionSelected = await groupByLabel(page, '変調').locator('.chip.is-selected').innerText();
  expect(conditionSelected).toBe('発生する');
});

test('味方ロースター：追加/削除の上限・下限、種族変更で武器・スキルがリセットされる', async ({ page }) => {
  await openTrainingGrounds(page);
  const allyCards = () => scope(page).locator('.slot-list').nth(0).locator('.panel');

  await allyCards().nth(0).getByRole('button', { name: '詳細設定', exact: true }).click();
  await groupByLabel(page, '種族').locator('.chip-row .chip', { hasText: 'フローレス・ノーカラー' }).click();
  await expect(allyCards().nth(0).locator('.slot__name')).toContainText('フローレス・ノーカラー');
  const weaponTypes = await groupByLabel(page, '武器種').locator('.chip-row .chip').allInnerTexts();
  expect(weaponTypes).toEqual(['フォーク', 'ナイフ', 'ストロー', 'カミザラ', 'タイマー', 'ピザカッター', 'スライサー']);
  // スキル構成は種族変更のたびに空へリセットされる（フラッシュ系統ツリーの
  // 根本「フラッシュ」チップが未強化状態で選択されている）。
  await expect(groupByLabel(page, 'フラッシュの成長').locator('.chip.is-selected')).toHaveText('フラッシュ');

  await scope(page).getByRole('button', { name: '＋ 味方を追加', exact: true }).click();
  await scope(page).getByRole('button', { name: '＋ 味方を追加', exact: true }).click();
  await scope(page).getByRole('button', { name: '＋ 味方を追加', exact: true }).click();
  await expect(scope(page).locator('.field-label').first()).toHaveText(/味方陣営（6\/6）/);
  await expect(scope(page).getByRole('button', { name: '＋ 味方を追加', exact: true })).toBeDisabled();

  for (let i = 0; i < 4; i++) await allyCards().nth(0).getByRole('button', { name: '削除', exact: true }).click();
  await expect(scope(page).locator('.field-label').first()).toHaveText(/味方陣営（2\/6）/);
  await expect(allyCards().nth(0).getByRole('button', { name: '削除', exact: true })).toBeDisabled();
});

test('敵ロースター：ボス系統は陣営全体で1枠のみ、配置体数は合計12体まで', async ({ page }) => {
  await openTrainingGrounds(page);
  const enemyCards = () => scope(page).locator('.slot-list').nth(1).locator('.panel');

  await enemyCards().nth(0).getByRole('button', { name: '詳細設定', exact: true }).click();
  await groupByLabel(page, '種別').getByRole('button', { name: 'ボス', exact: true }).click();
  await expect(groupByLabel(page, '配置体数').locator('.qty-input')).toBeDisabled();

  await enemyCards().nth(1).getByRole('button', { name: '詳細設定', exact: true }).click();
  const secondSlotKindGroup = scope(page).locator('.slot-list').nth(1).locator('.panel').nth(1).locator('.field-group', { has: page.locator('.field-label', { hasText: '種別' }) }).first();
  await expect(secondSlotKindGroup.getByRole('button', { name: 'ボス', exact: true })).toBeDisabled();
  await expect(secondSlotKindGroup.getByRole('button', { name: '上位ボス', exact: true })).toBeDisabled();

  const total = await scope(page).locator('.field-label', { hasText: '敵陣営' }).innerText();
  expect(total).toMatch(/合計3\/12体/); // ボス枠(1)+他2枠(各1)
});

test('一括設定・ランダム編成・プリセットが機能する', async ({ page }) => {
  await openTrainingGrounds(page);

  // 人数別ランダムボタン：指定した人数ちょうどになる。
  await scope(page).getByRole('button', { name: '5人でランダム編成', exact: true }).click();
  await expect(scope(page).locator('.field-label').first()).toHaveText(/味方陣営（5\/6）/);

  // レベル一括設定（全員）。
  await groupByLabel(page, 'レベル一括設定（全員）').getByRole('button', { name: 'Lv.30', exact: true }).click();
  const allyCards = () => scope(page).locator('.slot-list').nth(0).locator('.panel');
  const enemyCards = () => scope(page).locator('.slot-list').nth(1).locator('.panel');
  await expect(allyCards().nth(0).locator('.slot__name')).toContainText('Lv.30');
  await expect(enemyCards().nth(0).locator('.slot__name')).toContainText('Lv.30');

  // プリセット保存→設定変更→読込で復元される。
  const preset1 = scope(page).locator('.slot-list').last().locator('.panel').nth(0);
  await preset1.getByRole('button', { name: '保存', exact: true }).click();
  await scope(page).getByRole('button', { name: '2人でランダム編成', exact: true }).click();
  await expect(scope(page).locator('.field-label').first()).toHaveText(/味方陣営（2\/6）/);
  await preset1.getByRole('button', { name: '読込', exact: true }).click();
  await expect(scope(page).locator('.field-label').first()).toHaveText(/味方陣営（5\/6）/);
});

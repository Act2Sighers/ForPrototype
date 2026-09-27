const { test, expect } = require('@playwright/test');
const { setUpBattlePage, getState, autoResolveAllies } = require('./helpers');

// F2：Prepフェイズの行動が全員分確定するまで「オードブル開始！」は
// 表示されず、確定した瞬間に現れ、クリックするとPrepの順次処理へ移って
// 消えることの検証。
test('全員確定で「オードブル開始！」が現れ、押すとPrep処理へ進んで消える', async ({ browser }) => {
  const { page, errors } = await setUpBattlePage(browser);
  await page.evaluate(() => window.__battleTestHooks__.forceEnemies([{ dataId: 'karumeDog', level: 1 }]));

  const prompt = page.locator('.battle-center__start-prompt');
  await expect(prompt).toHaveCount(0);

  await autoResolveAllies(page);
  const ready = await page.evaluate(() => window.__battleTestHooks__.isReady());
  expect(ready).toBe(true);
  await expect(prompt).toBeVisible();
  await expect(prompt).toHaveText('オードブル開始！');

  // D8のPrepフェイズ用「行動実行！」ボタンは、システム都合（既存の
  // 回帰テスト群がPrepフェイズのトリガーとして使い続けている）で
  // 意図的に残されている -- 併存を確認する。
  await expect(page.locator('.battle-execute-btn')).toBeVisible();

  await prompt.click();
  await page.waitForFunction(() => window.__battleTestHooks__.getState().phase !== 'prep', { timeout: 3000 });
  await expect(prompt).toHaveCount(0);

  const state = await getState(page);
  expect(state.phase).not.toBe('prep');
  expect(errors).toEqual([]);
  await page.close();
});

const { test, expect } = require('@playwright/test');
const { setUpBattlePage, getState, autoResolveAllies } = require('./helpers');

// G3：window.__battleTestHooks__を使い、DOMクリックに頼らずPrep→Main→
// 戦闘終了までの基本フローが機能することを検証する。forceEnemiesで
// 弱い敵1体に固定し、ランダム戦闘生成に頼らず短時間で決着させる。
test('forceEnemies + フック経由の行動確定でPrepからMainへ正しく遷移する', async ({ browser }) => {
  const { page, errors } = await setUpBattlePage(browser);

  await page.evaluate(() => window.__battleTestHooks__.forceEnemies([{ dataId: 'karumeDog', level: 1 }]));
  let state = await getState(page);
  expect(state.phase).toBe('prep');
  expect(state.enemies).toHaveLength(1);
  expect(state.enemies[0].name).toContain('カルメヤ犬');

  await autoResolveAllies(page);
  const ready = await page.evaluate(() => window.__battleTestHooks__.isReady());
  expect(ready).toBe(true);

  await page.evaluate(() => window.__battleTestHooks__.runPrepExecution());
  state = await getState(page);
  expect(state.phase).not.toBe('prep');
  expect(state.log.length).toBeGreaterThan(0);

  // Mainフェイズで味方の手番が残っていれば流し切り、戦闘終了まで進める。
  for (let round = 0; round < 30 && !state.battleOutcome; round++) {
    if (state.phase === 'main') {
      const actorId = state.mainOrder[state.mainCursor];
      const actor = [...state.allies, ...state.enemies].find((u) => u.id === actorId);
      if (actor && actor.faction === 'ally' && !actor.incapacitated) await autoResolveAllies(page);
      else break; // 敵の手番はCPU側で自動実行される（進展待ち）
    }
    await page.waitForTimeout(20);
    state = await getState(page);
  }

  expect(state.battleOutcome).toBe('victory');
  await expect(page.getByRole('button', { name: '戦闘を終える', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await page.close();
});

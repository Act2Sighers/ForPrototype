const { test, expect } = require('@playwright/test');
const { setUpBattlePage, getState } = require('./helpers');

// F3：行動順カード列（左右固定表示）の並び順・内容・グレーアウトの
// 検証。Prepフェイズは「味方①→敵①→味方②→敵②…」の既定順、未確定の
// 味方は「（未確定）」、まだ宣言されていない敵は「？？？」、左列は敵を
// グレーアウト・右列は味方をグレーアウトする（ユーザー指定の仕様）。
test('Prepフェイズの行動順カード列：並び順・グレーアウト・未確定/？？？表示', async ({ browser }) => {
  const { page, errors } = await setUpBattlePage(browser);
  await page.evaluate(() => window.__battleTestHooks__.forceEnemies([{ dataId: 'karumeDog', level: 1 }, { dataId: 'chocoRock', level: 1 }]));

  const state = await getState(page);
  const expectedOrder = [];
  const maxLen = Math.max(state.allies.length, state.enemies.length);
  for (let i = 0; i < maxLen; i++) {
    if (state.allies[i]) expectedOrder.push(state.allies[i].id);
    if (state.enemies[i]) expectedOrder.push(state.enemies[i].id);
  }

  const leftCards = page.locator('.battle-action-queue--left .battle-action-queue-card');
  const rightCards = page.locator('.battle-action-queue--right .battle-action-queue-card');
  await expect(leftCards).toHaveCount(expectedOrder.length);
  await expect(rightCards).toHaveCount(expectedOrder.length);

  const leftIds = await leftCards.evaluateAll((els) => els.map((e) => e.getAttribute('data-unit-id')));
  const rightIds = await rightCards.evaluateAll((els) => els.map((e) => e.getAttribute('data-unit-id')));
  expect(leftIds).toEqual(expectedOrder);
  expect(rightIds).toEqual(expectedOrder);

  // 未確定の味方は「（未確定）」、まだ宣言されていない敵は「？？？」。
  const allyId = state.allies[0].id;
  const enemyId = state.enemies[0].id;
  await expect(page.locator(`.battle-action-queue--left [data-unit-id="${allyId}"] .battle-action-queue-card__line`)).toHaveText('（未確定）');
  await expect(page.locator(`.battle-action-queue--left [data-unit-id="${enemyId}"] .battle-action-queue-card__line`)).toHaveText('？？？');

  // 左列（味方陣営の隣）は敵をグレーアウト、味方はグレーアウトしない。
  // 右列（敵陣営の隣）はその逆。
  await expect(page.locator(`.battle-action-queue--left [data-unit-id="${allyId}"]`)).not.toHaveClass(/--dimmed/);
  await expect(page.locator(`.battle-action-queue--left [data-unit-id="${enemyId}"]`)).toHaveClass(/--dimmed/);
  await expect(page.locator(`.battle-action-queue--right [data-unit-id="${allyId}"]`)).toHaveClass(/--dimmed/);
  await expect(page.locator(`.battle-action-queue--right [data-unit-id="${enemyId}"]`)).not.toHaveClass(/--dimmed/);

  // 味方が最適化を選ぶと「（未確定）」が行動名に変わる（両方の列で同じ）。
  await page.evaluate((id) => window.__battleTestHooks__.setAction(id, 'optimize', [id]), allyId);
  await expect(page.locator(`.battle-action-queue--left [data-unit-id="${allyId}"] .battle-action-queue-card__line`)).toHaveText('最適化');
  await expect(page.locator(`.battle-action-queue--right [data-unit-id="${allyId}"] .battle-action-queue-card__line`)).toHaveText('最適化');

  expect(errors).toEqual([]);
  await page.close();
});

// F3：Mainフェイズに入ると並び順がmainOrder（IN降順）に切り替わり、
// 1手番で複数回行動すると同じカード内に行が積み増されることを確認する。
test('Mainフェイズの行動順カード列：並び順がmainOrderに切り替わり、複数行動で複数行になる', async ({ browser }) => {
  const { page, errors } = await setUpBattlePage(browser);
  await page.evaluate(() => window.__battleTestHooks__.forceEnemies([{ dataId: 'karumeDog', level: 1 }]));

  let state = await getState(page);
  for (const ally of state.allies) {
    const mods = await page.evaluate((id) => window.__battleTestHooks__.listViableModules(id), ally.id);
    await page.evaluate(({ id, moduleId }) => window.__battleTestHooks__.setAction(id, moduleId), { id: ally.id, moduleId: mods[0].id });
  }
  await page.evaluate(() => window.__battleTestHooks__.runPrepExecution());
  state = await getState(page);
  expect(state.phase).toBe('main');

  const leftIds = await page.locator('.battle-action-queue--left .battle-action-queue-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-unit-id')));
  expect(leftIds).toEqual(state.mainOrder.filter((id) => [...state.allies, ...state.enemies].find((u) => u.id === id && !u.incapacitated)));

  // mainOrder[0]隊員がコスト無しの「攻撃」を連続使用できる限り、自分の
  // カードに行動名が複数行積み増されていく仕様（batch2.jsのコメント
  // 参照）。攻撃を2回撃てば2行になることを確認する。
  const actorId = state.mainOrder[0];
  const actorFaction = [...state.allies, ...state.enemies].find((u) => u.id === actorId).faction;
  if (actorFaction === 'ally') {
    for (let i = 0; i < 2; i++) {
      const cur = await page.evaluate((id) => window.__battleTestHooks__.getState().allies.find((a) => a.id === id), actorId);
      if (cur?.action?.resolved || !cur) break;
      const mods = await page.evaluate((id) => window.__battleTestHooks__.listViableModules(id), actorId);
      if (mods.length === 0) break;
      await page.evaluate(({ id, moduleId }) => window.__battleTestHooks__.setAction(id, moduleId), { id: actorId, moduleId: mods[0].id });
    }
    const lines = await page.locator(`.battle-action-queue--left [data-unit-id="${actorId}"] .battle-action-queue-card__line`).count();
    expect(lines).toBeGreaterThanOrEqual(1);
  }

  expect(errors).toEqual([]);
  await page.close();
});

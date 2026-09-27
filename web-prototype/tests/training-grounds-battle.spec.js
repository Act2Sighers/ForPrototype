const { test, expect } = require('@playwright/test');

// 訓練所（アリーナモード）：実データへの非破壊性、【パス】の味方限定、
// 報酬の表示専用化、変調トグルの実効性、戦闘画面UIの調整（スキップ
// ボタン撤去・訓練を終えるボタンの常時表示）を検証する。

async function startFreshSave(page) {
  await page.addInitScript(() => { window.__BATTLE_FAST__ = true; });
  await page.goto('/index.html');
  await page.waitForSelector('.screen-title');
  await page.getByRole('button', { name: 'はじめから', exact: true }).click();
}

function scope(page) {
  return page.locator('.screen.is-active');
}

async function openTrainingGrounds(page) {
  await scope(page).getByRole('button', { name: '訓練所', exact: true }).click();
  await scope(page).getByRole('button', { name: '入場', exact: true }).click();
  await page.waitForSelector('.screen.is-active .screen-title:text("訓練所")');
}

async function startArenaBattle(page) {
  await scope(page).getByRole('button', { name: 'この設定で訓練を開始', exact: true }).click();
  await page.waitForFunction(() => !!window.__battleTestHooks__ && window.__battleTestHooks__.getState().phase === 'prep');
}

function getState(page) {
  return page.evaluate(() => window.__battleTestHooks__.getState());
}
function hooks(page, fn, ...args) {
  return page.evaluate(({ fn, args }) => window.__battleTestHooks__[fn](...args), { fn, args });
}

test('アリーナモードの戦闘は仮インスタンスのみを使い、実データを変更しない', async ({ page }) => {
  await startFreshSave(page);
  const before = await page.evaluate(async () => {
    const stateMod = await import('/js/state.js');
    const state = stateMod.default;
    return { hasRun: !!state.run, allyHps: state.formationSlots.map((c) => c.currentHp) };
  });

  await openTrainingGrounds(page);
  await startArenaBattle(page);
  await hooks(page, 'forceEnemies', [{ dataId: 'karumeDog', level: 1 }]);

  let st = await getState(page);
  for (const a of st.allies) await hooks(page, 'setAction', a.id, 'optimize');
  await hooks(page, 'runPrepExecution');

  for (let i = 0; i < 20; i++) {
    st = await getState(page);
    if (st.battleOutcome) break;
    const cursorId = st.mainOrder[st.mainCursor];
    const unit = [...st.allies, ...st.enemies].find((u) => u.id === cursorId);
    if (unit && unit.faction === 'ally' && !(unit.action && unit.action.resolved)) await hooks(page, 'setAction', cursorId, 'attack');
    await page.waitForTimeout(20);
  }
  expect(st.battleOutcome).toBe('victory');

  await scope(page).getByRole('button', { name: '訓練を終える', exact: true }).click();
  await page.waitForSelector('.screen.is-active .screen-title:text("訓練所")');

  const after = await page.evaluate(async () => {
    const stateMod = await import('/js/state.js');
    const state = stateMod.default;
    return { hasRun: !!state.run, allyHps: state.formationSlots.map((c) => c.currentHp) };
  });
  expect(after).toEqual(before);
});

test('【パス】は味方のみ選択でき、敵は選択できない', async ({ page }) => {
  await startFreshSave(page);
  await openTrainingGrounds(page);
  await startArenaBattle(page);

  const st = await getState(page);
  const allyModules = await hooks(page, 'listViableModules', st.allies[0].id);
  const enemyModules = await hooks(page, 'listViableModules', st.enemies[0].id);
  expect(allyModules.map((m) => m.id)).toContain('passPrep');
  expect(enemyModules.map((m) => m.id)).not.toContain('passPrep');
});

test('勝利報酬はログに表示されるだけで、実際には付与されない', async ({ page }) => {
  await startFreshSave(page);
  const beforeResources = await page.evaluate(async () => {
    const stateMod = await import('/js/state.js');
    return JSON.stringify(stateMod.default.run);
  });
  expect(beforeResources).toBe('null'); // 訓練所はラン外なのでstate.runはnullのまま

  await openTrainingGrounds(page);
  await startArenaBattle(page);
  await hooks(page, 'forceEnemies', [{ dataId: 'karumeDog', level: 1 }]);
  let st = await getState(page);
  for (const a of st.allies) await hooks(page, 'setAction', a.id, 'optimize');
  await hooks(page, 'runPrepExecution');
  for (let i = 0; i < 20; i++) {
    st = await getState(page);
    if (st.battleOutcome) break;
    const cursorId = st.mainOrder[st.mainCursor];
    const unit = [...st.allies, ...st.enemies].find((u) => u.id === cursorId);
    if (unit && unit.faction === 'ally' && !(unit.action && unit.action.resolved)) await hooks(page, 'setAction', cursorId, 'attack');
    await page.waitForTimeout(20);
  }
  expect(st.battleOutcome).toBe('victory');
  expect(st.log.filter((l) => l.includes('戦闘勝利報酬')).length).toBe(1);

  const afterRun = await page.evaluate(async () => {
    const stateMod = await import('/js/state.js');
    return JSON.stringify(stateMod.default.run);
  });
  expect(afterRun).toBe('null'); // 戦闘後も実ランは発生していない（何も付与されていない）
});

test('変調トグル：「発生しない」に設定すると戦闘中に変調が一切増加しない', async ({ page }) => {
  await startFreshSave(page);
  await openTrainingGrounds(page);
  await scope(page).locator('.field-group', { has: page.locator('.field-label', { hasText: '変調' }) }).first().getByRole('button', { name: '発生しない', exact: true }).click();
  await startArenaBattle(page);

  let st = await getState(page);
  for (const a of st.allies) await hooks(page, 'setAction', a.id, 'optimize');
  await hooks(page, 'runPrepExecution');
  await page.waitForTimeout(50);

  st = await getState(page);
  for (const a of st.allies) expect(a.condition).toBe(0);
});

test('変調トグル：既定（発生する）では味方が行動すると変調が増える', async ({ page }) => {
  await startFreshSave(page);
  await openTrainingGrounds(page);
  await startArenaBattle(page);

  let st = await getState(page);
  for (const a of st.allies) await hooks(page, 'setAction', a.id, 'optimize');
  await hooks(page, 'runPrepExecution');
  await page.waitForTimeout(50);

  st = await getState(page);
  for (const a of st.allies) expect(a.condition).toBeGreaterThan(0);
});

test('アリーナモードの戦闘画面：スキップボタンは無く、訓練を終えるボタンが決着前から表示される', async ({ page }) => {
  await startFreshSave(page);
  await openTrainingGrounds(page);
  await startArenaBattle(page);

  await expect(scope(page).getByRole('button', { name: 'スキップ（テスト用）', exact: true })).toHaveCount(0);
  await expect(scope(page).getByRole('button', { name: '訓練を終える', exact: true })).toBeVisible();
  await expect(scope(page).locator('.screen-title')).toHaveText('訓練（アリーナモード）');
});

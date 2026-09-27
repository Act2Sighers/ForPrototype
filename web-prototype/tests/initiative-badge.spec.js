const { test, expect } = require('@playwright/test');
const { startFreshRunToDungeon, enterFirstBattleNode, getState } = require('./helpers');

// F1：Prepフェイズ中、各ユニット枠の真上にイニシアチブ(IN)が常時表示
// されることの検証。INは選択時ではなく、Prepフェイズの宣言が実際に
// 「実行」される瞬間（オードブル開始！押下後の順次処理、まだphaseは
// "prep"のまま）に更新される（resetForNewPrepPhaseで各Prep開始時に
// 一旦0へ戻る仕様）。そのため、この演出中の一瞬（まだphase==="prep"）
// を捉える必要があり、演出待機を意図的に縮めない（__BATTLE_FAST__は
// 使わない）。ログの「◯◯のIN：before → after」行を目印に、対応する
// タイミングでバッジの表示（テキスト・色）を確認する。
test('Prep実行中、最適化/牽制でIN表示が実行の瞬間に+/-・色分けとも正しく更新される', async ({ browser }) => {
  test.setTimeout(30000);
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) errors.push('console.error: ' + msg.text()); });

  await startFreshRunToDungeon(page);
  await enterFirstBattleNode(page);
  await page.evaluate(() => window.__battleTestHooks__.forceEnemies([{ dataId: 'karumeDog', level: 1 }]));

  const state = await getState(page);
  const [ally1, ally2] = state.allies;
  const enemyId = state.enemies[0].id;

  const badgeFor = (unitId) => page.locator(`.battle-freeform-canvas [data-unit-id="${unitId}"]`).locator('xpath=..').locator('.battle-unit__initiative');
  await expect(badgeFor(ally1.id)).toHaveText('0');
  await expect(badgeFor(ally1.id)).not.toHaveClass(/--positive|--negative/);

  // ally1が敵に牽制、ally2が自分自身に最適化を選ぶ（実際のIN変化は
  // オードブル開始！押下後の順次処理でのみ発生する）。
  await page.evaluate(({ id, enemyId }) => window.__battleTestHooks__.setAction(id, 'restrain', [enemyId]), { id: ally1.id, enemyId });
  await page.evaluate((id) => window.__battleTestHooks__.setAction(id, 'optimize', [id]), ally2.id);

  // awaitせず投げっぱなしにする -- Prep順次処理の途中経過（phaseが
  // まだ"prep"のまま）を観測したいため。テスト終了時にpageを閉じると
  // このPromiseが後から拒否されうるので、catchして無視する。
  page.evaluate(() => window.__battleTestHooks__.runPrepExecution()).catch(() => {});

  // ally1の牽制で敵のIN：0 → -1になる瞬間をログの行で検知する。行動順
  // で敵より前に動くのはally1だけなので、敵自身の行動やCPUの行動内容に
  // 依存せず確実に-1になる。ACTION_DELAY_MS（非FASTでは1000ms）の
  // 宣言＋結果の2ステップぶん待てば十分。
  await page.waitForFunction(
    (enemyName) => window.__battleTestHooks__.getState().log.some((l) => l.includes(`${enemyName}のIN`)),
    state.enemies[0].name,
    { timeout: 5000 }
  );
  let phaseNow = await page.evaluate(() => window.__battleTestHooks__.getState().phase);
  expect(phaseNow).toBe('prep');
  await expect(badgeFor(enemyId)).toHaveText('-1');
  await expect(badgeFor(enemyId)).toHaveClass(/--negative/);

  // ally2の最適化が実行される瞬間も同様に検知する。ally2は行動順で
  // 最後（enemy1の次）のため、enemy1のCPU行動が偶然ally2のINにも
  // 干渉している可能性を考慮し、期待値を+1と決め打ちせず、ログの
  // 「→ N」から実際の結果を読み取ってバッジ表示と突き合わせる。
  // ally2は行動順で最後（enemy1の次）のため、enemy1自身の行動ぶんの
  // ステップも待つ必要があり、より長いタイムアウトを与える。
  await page.waitForFunction(
    (name) => window.__battleTestHooks__.getState().log.some((l) => l.includes(`${name}のIN`)),
    ally2.name,
    { timeout: 10000 }
  );
  phaseNow = await page.evaluate(() => window.__battleTestHooks__.getState().phase);
  expect(phaseNow).toBe('prep');
  const ally2Line = (await getState(page)).log.find((l) => l.includes(`${ally2.name}のIN`));
  const afterValue = Number(ally2Line.match(/→\s*(-?\d+)/)[1]);
  const expectedText = afterValue > 0 ? `+${afterValue}` : `${afterValue}`;
  const expectedClass = afterValue > 0 ? /--positive/ : afterValue < 0 ? /--negative/ : /^battle-unit__initiative$/;
  await expect(badgeFor(ally2.id)).toHaveText(expectedText);
  await expect(badgeFor(ally2.id)).toHaveClass(expectedClass);

  // Prepの順次処理が終わりMainフェイズへ移ると、バッジ自体が消える。
  await page.waitForFunction(() => window.__battleTestHooks__.getState().phase !== 'prep', { timeout: 8000 });
  await expect(page.locator('.battle-unit__initiative')).toHaveCount(0);

  expect(errors).toEqual([]);
  await page.close();
});

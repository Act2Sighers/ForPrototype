const { test, expect } = require('@playwright/test');
const { setUpBattlePage, getState } = require('./helpers');

// D6：対象選択の余地が無いスキル（targetFaction:"none"、【Ｓ・フラッシュ】
// のような陣営全体対象）は、選んだ瞬間に対象選択ステップを経ず自動で
// 確定・実行される（矢印は宣言時点で陣営全体へ自動的に広がる）ことの
// 検証。宣言ログの文言も「〜を発動！」（対象を明示しない特別な言い回し）
// になることを確認する。
test('Ｓ・フラッシュ：対象選択なしで即座に確定・実行され、陣営全体にヒットする', async ({ browser }) => {
  test.setTimeout(30000);
  const { page, errors } = await setUpBattlePage(browser);
  await page.evaluate(() => window.__battleTestHooks__.forceEnemies([
    { dataId: 'karumeDog', level: 1 }, { dataId: 'chocoRock', level: 1 },
  ]));

  // 両方の味方に鼓舞（PT+1）を持たせる -- Ｓ・フラッシュ（コスト4）を
  // 使うにはPT4が要る（既定は3）。どちらが先に手番を迎えても即座に
  // 使えるようにするため、片方だけに絞らない（どちらが先手になるかは
  // 敵のCPU行動やINの解決順で変わりうり、対象を1人に決め打ちして待つ
  // 方式は、その味方が手番を迎える前に力尽きた場合に不安定になるため
  // 避ける -- 実際に単体決め打ちで観測済み）。
  const state = await getState(page);
  for (const ally of state.allies) {
    await page.evaluate((id) => window.__battleTestHooks__.setAction(id, 'inspire', [id]), ally.id);
  }
  await page.evaluate(() => window.__battleTestHooks__.runPrepExecution());

  // Prep実行（＋続くMain自動行動バースト）が完了した時点で、advance
  // MainPhaseの内部処理により、判断が必要な最初の味方の手番で自動的に
  // 停止しているはず。
  const cur = await getState(page);
  expect(cur.phase).toBe('main');
  const actingAllyId = cur.mainOrder[cur.mainCursor];
  const actingAlly = cur.allies.find((a) => a.id === actingAllyId);
  expect(actingAlly).toBeTruthy();

  // 選ぶ前は対象候補が存在しない（選択の余地が無い＝targetFaction:"none"）。
  await page.evaluate((id) => window.__battleTestHooks__.chooseModule(id, 'straightFlush'), actingAllyId);
  const candidatesAfterChoose = await page.evaluate((id) => window.__battleTestHooks__.listTargetCandidates(id), actingAllyId);
  expect(candidatesAfterChoose).toEqual([]);

  // chooseModuleの時点で既に自動確定・実行済みになっているはず
  // （setActionを経由せずchooseModuleだけで完結する＝クリック一つで
  // 完結する仕様の核心部分）。
  const settled = await getState(page);
  const actingAllyState = settled.allies.find((a) => a.id === actingAllyId);
  expect(actingAllyState.action.moduleId).toBe('straightFlush');
  expect(actingAllyState.action.resolved).toBe(true);
  expect(settled.log.some((l) => l.includes('Ｓ・フラッシュ') && l.includes('発動'))).toBe(true);

  for (const enemy of cur.enemies) {
    const after = settled.enemies.find((e) => e.id === enemy.id);
    expect(after.hp).toBeLessThan(enemy.hp);
  }
  // 自傷ステップの実ダメージは、事前に敵から攻撃力デバフを受けていると
  // 0に丸められることがある（本質はattack@selfというステップの構成
  // そのものなので、実害の有無は問わない）。ここでは増えていない
  // （マイナス方向以外の異常が無い）ことだけを確認する。
  expect(actingAllyState.hp).toBeLessThanOrEqual(actingAlly.hp);

  expect(errors).toEqual([]);
  await page.close();
});

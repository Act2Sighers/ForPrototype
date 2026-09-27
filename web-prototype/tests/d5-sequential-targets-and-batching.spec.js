const { test, expect } = require('@playwright/test');
const { startFreshRunToDungeon, enterFirstBattleNode, getState } = require('./helpers');

// D5＋E2：【フラッシュ】（相手陣営から逐次3体を選ぶ攻撃3連＋自傷1）を
// 使って、複数対象の逐次選択（D5）と、同一効果（attack）への複数対象を
// まとめて1回の演出で処理するバッチ処理（E2）の両方を検証する。
// __BATTLE_FAST__は使わない -- E2のバッチ処理タイミングを、宣言＋
// バッチ実行の2ステップ分の実測待機時間として観測するため。
test('フラッシュ：対象の逐次選択で候補が縮み、複数対象の演出が1回にまとまる', async ({ browser }) => {
  // 非FASTモード（実時間1000ms/ステップ）でPrep全員分＋Mainの敵連続
  // 行動バーストを実時間で待つため、既定の30秒では時々足りなくなる
  // （実測26秒台のこともあった）。余裕を持たせる。
  test.setTimeout(60000);
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) errors.push('console.error: ' + msg.text()); });

  await startFreshRunToDungeon(page);
  await enterFirstBattleNode(page);
  // 3体：フラッシュの主対象＋2つの追加対象（opposingExcludingUsed）を
  // すべて明示選択させるにはちょうど3体必要（4体目以降だと最後の枠まで
  // 複数候補が残り続け、逆に少なすぎると単一候補で自動確定してしまう）。
  await page.evaluate(() => window.__battleTestHooks__.forceEnemies([
    { dataId: 'karumeDog', level: 1 }, { dataId: 'chocoRock', level: 1 }, { dataId: 'merengeCat', level: 1 },
  ]));

  // 両方の味方に鼓舞（PT+1）を持たせておく -- フラッシュ（コスト4）を
  // 使うにはPT4が要る（既定は3）。どちらが先に手番を迎えても即座に
  // 使えるようにするため対象を1人に決め打ちしない（決め打ちした味方が
  // 手番を迎える前に敵の攻撃で力尽きる展開もあり、不安定になることを
  // 実際に観測済み）。
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
  const actorId = cur.mainOrder[cur.mainCursor];
  const actor = cur.allies.find((a) => a.id === actorId);
  expect(actor).toBeTruthy();
  expect(actor.pt.max).toBeGreaterThanOrEqual(4);

  // D5：フラッシュを選ぶと主対象の候補は生存中の敵3体全員。
  const primaryCandidates = await page.evaluate((id) => {
    window.__battleTestHooks__.chooseModule(id, 'flush');
    return window.__battleTestHooks__.listTargetCandidates(id);
  }, actorId);
  expect(primaryCandidates.sort()).toEqual(cur.enemies.map((e) => e.id).sort());

  // 主対象を1体選ぶと、次の候補は「選択済みを除いた残り2体」に縮む
  // （D5：opposingExcludingUsedによる逐次選択）。
  const target1 = primaryCandidates[0];
  await page.evaluate(({ id, t }) => window.__battleTestHooks__.pickTarget(id, t), { id: actorId, t: target1 });
  const secondCandidates = await page.evaluate((id) => window.__battleTestHooks__.listTargetCandidates(id), actorId);
  expect(secondCandidates.sort()).toEqual(primaryCandidates.filter((id) => id !== target1).sort());
  expect(secondCandidates).toHaveLength(2);

  // 2つ目を選ぶと、残り1体・自傷ステップは単一候補のため自動確定され、
  // 行動全体が即座に確定・実行される（E2：これらは全てactionId「attack」
  // の連続ステップとしてバッチ処理される）。実行完了時点でunit.actionは
  // 次の行動に備えてnullに戻る（resolveMainAction仕様）ため、逐次選択
  // 自体の結果は候補の縮み方（上のprimaryCandidates/secondCandidates）
  // と、以下のダメージ結果（3体＋自分）で検証する。
  const target2 = secondCandidates[0];
  const t0 = Date.now();
  await page.evaluate(({ id, t }) => window.__battleTestHooks__.pickTarget(id, t), { id: actorId, t: target2 });

  // E2：宣言(1回)＋バッチ済み効果の演出(1回)の2ステップぶん
  // （非FASTでACTION_DELAY_MS=1000ms/ステップ）で収まるはず。バッチが
  // 効いていなければ対象4件（敵3体＋自分）ぶん、宣言込みで最大5
  // ステップ（約5000ms）かかる計算になり、明確に差が出る。
  const elapsedMs = Date.now() - t0;
  expect(elapsedMs).toBeLessThan(3000);

  // 効果自体は敵3体＋自分の計4体全てにダメージが記録されている。
  const finalHpState = await getState(page);
  for (const enemy of cur.enemies) {
    const after = finalHpState.enemies.find((e) => e.id === enemy.id);
    expect(after.hp).toBeLessThan(enemy.hp);
  }
  // 自傷ステップの実ダメージは、事前に敵から攻撃力デバフを受けていると
  // 0に丸められることがある（本質はattack@selfというステップの構成
  // そのものなので、実害の有無は問わない）。増えていないことだけ確認する。
  const actorAfter = finalHpState.allies.find((a) => a.id === actorId);
  expect(actorAfter.hp).toBeLessThanOrEqual(actor.hp);

  expect(errors).toEqual([]);
  await page.close();
});

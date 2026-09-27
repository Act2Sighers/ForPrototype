// G3：全spec共通のセットアップ処理。window.__battleTestHooks__（battle.js
// 参照）を経由して戦闘を直接駆動する -- クリック手順やテキスト文言に
// 依存しないことで、UIの見た目が変わってもテストの意図が保たれる。

// 新規セーブからテストダンジョンへ入り、全隊員のスキル構成をリセット
// （ランダムな初期武器スキルを消し、素の使用可能スキルだけにする）した
// 上で、指定した戦闘ノードに入る直前まで進める。groupTitleを指定すると
// 初期雇用の3組（INITIAL_HIRING_GROUPS、resourceCatalog.js）のうち、
// その部分文字列を含む組を選ぶ（省略時は先頭＝「フレーク、ロリポップ」）。
// D5/D6/E2のような特定キャラクター固有スキルを使うテストは、そのスキル
// を持つキャラクターが含まれる組を明示的に選ぶ必要がある。
async function startFreshRunToDungeon(page, groupTitle) {
  await page.goto('/index.html');
  await page.waitForSelector('.screen-title');
  await page.getByRole('button', { name: 'はじめから', exact: true }).click();
  await page.getByRole('button', { name: 'テストダンジョン', exact: true }).click();
  await page.getByRole('button', { name: 'ノーマル', exact: true }).click();
  await page.getByRole('button', { name: '12C', exact: true }).click();
  await page.getByRole('button', { name: '挑戦開始', exact: true }).click();
  await page.waitForTimeout(40);
  await page.getByRole('button', { name: 'すすめる', exact: true }).click();
  await page.getByRole('button', { name: 'すすめる', exact: true }).click();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  const panel = groupTitle
    ? page.locator('.screen.is-active .panel', { hasText: groupTitle })
    : page.locator('.screen.is-active .panel').first();
  await panel.getByRole('button', { name: '雇用', exact: true }).click();
  await page.waitForTimeout(15);
  await panel.getByRole('button', { name: '実行する', exact: true }).click();
  await page.waitForTimeout(15);

  await page.evaluate(async () => {
    const stateMod = await import('/js/state.js');
    const state = stateMod.default;
    for (const slot of state.formationSlots) if (slot) slot.skills = null;
  });

  await page.getByRole('button', { name: '出発', exact: true }).click();
}

// マップ上の最初の「戦闘」ノードをクリックして戦闘に入り、テストフック
// （window.__battleTestHooks__）が使えるようになるまで待つ。
async function enterFirstBattleNode(page) {
  await page.locator('.map-node.is-reachable text', { hasText: '戦闘' }).click();
  await page.waitForFunction(() => !!window.__battleTestHooks__, { timeout: 3000 });
}

// __BATTLE_FAST__（演出待機を10msに短縮）を有効にした新規ページを作り、
// 新規セーブ→テストダンジョン→戦闘ノード直前まで進める。戻り値の
// pageに対して forceEnemies 等のフックをすぐ呼べる状態になっている。
async function setUpBattlePage(browser, groupTitle) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) errors.push('console.error: ' + msg.text());
  });
  await page.addInitScript(() => { window.__BATTLE_FAST__ = true; });
  await startFreshRunToDungeon(page, groupTitle);
  await enterFirstBattleNode(page);
  return { page, errors };
}

// __battleTestHooks__.getState() のショートハンド。
function getState(page) {
  return page.evaluate(() => window.__battleTestHooks__.getState());
}

// 生存中の味方それぞれについて、選べるスキルの中から最初の1つ
// （通常は基本の「攻撃」）を選び、必要な対象も先頭候補で埋めて、
// Prep/Mainどちらのフェイズでも「行動確定済み」の状態まで進める。
// 個々のスキル内容は問わない、汎用的な「何か1つ確定させる」ヘルパー。
async function autoResolveAllies(page) {
  let state = await getState(page);
  for (const ally of state.allies) {
    if (ally.incapacitated || ally.action?.resolved) continue;
    let resolved = false;
    let guard = 0;
    while (!resolved && guard < 10) {
      guard++;
      const mods = await page.evaluate((id) => window.__battleTestHooks__.listViableModules(id), ally.id);
      if (mods.length === 0) break;
      // targetIdsを省略：setAction自身がその都度の候補の先頭を選び続ける
      // （対象は何でもいい、確定させることだけが目的のため）。
      await page.evaluate(({ id, moduleId }) => window.__battleTestHooks__.setAction(id, moduleId), { id: ally.id, moduleId: mods[0].id });
      const updated = await page.evaluate((id) => window.__battleTestHooks__.getState().allies.find((a) => a.id === id), ally.id);
      resolved = !!updated?.action?.resolved;
    }
  }
}

module.exports = { startFreshRunToDungeon, enterFirstBattleNode, setUpBattlePage, getState, autoResolveAllies };

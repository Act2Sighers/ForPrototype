// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  // 複数specを並列実行すると、複数のChromiumインスタンスがCPUを取り合い、
  // 非FASTモード（実時間のACTION_DELAY_MS=1000ms待機）に依存するE2の
  // タイミング検証などが環境要因で不安定になる（実際に発生・確認済み）。
  // このプロジェクトの過去のスクリプトも常に1つずつ順番に実行してきた
  // 経緯を踏まえ、安定性を優先してシングルワーカーに固定する。
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8981',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1400, height: 950 },
        launchOptions: {
          executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        },
      },
    },
  ],
  webServer: {
    command: 'python3 -m http.server 8981',
    url: 'http://localhost:8981/index.html',
    reuseExistingServer: true,
  },
});

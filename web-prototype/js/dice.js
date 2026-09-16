// Shared D6 mechanics: every judgement in this game (episode script
// checks, exploration's 採集/採掘/監督判定) rolls a pool of D6 and
// counts how many land 4 or higher as the "成功数" (success count).
export function rollD6() {
  return 1 + Math.floor(Math.random() * 6);
}

export function rollJudgement(count) {
  const rolls = Array.from({ length: count }, rollD6);
  const successCount = rolls.filter((die) => die >= 4).length;
  return { rolls, successCount };
}

// 「[count]D6合計」: countだけD6を振って出目を全て合計する。
export function rollSum(count) {
  return Array.from({ length: count }, rollD6).reduce((total, die) => total + die, 0);
}

// 「[count]D6成功数Δ」の変換表: D6成功数(rollJudgementのsuccessCount)を
// 0〜1→1, 2〜3→2, 4〜6→3, 7〜10→4, 11〜15→5, 16以上→6 に変換する。
export function successCountToR(successCount) {
  if (successCount <= 1) return 1;
  if (successCount <= 3) return 2;
  if (successCount <= 6) return 3;
  if (successCount <= 10) return 4;
  if (successCount <= 15) return 5;
  return 6;
}

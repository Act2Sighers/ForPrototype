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

// 「NΔ」（三角数変換）: k(k+1)/2 ≦ N ＜ (k+1)(k+2)/2 となる「k」を返す
// （N=0はk=0だが、最低保証で1に変換する）。上限を設けない点に注意 --
// 以前の実装は16以上を一律6に丸めていたが、正しくは際限なく増え続ける。
// 浮動小数点の誤差を避けるため、平方根の閉形式ではなく整数の反復で
// 求める（Nは常にダイス成功数程度の小さい値なのでコストは無視できる）。
export function successCountToR(n) {
  let k = 0;
  while (((k + 1) * (k + 2)) / 2 <= n) k += 1;
  return Math.max(1, k);
}

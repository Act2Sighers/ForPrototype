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

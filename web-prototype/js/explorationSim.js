// The 探索イベント's phase② real-time simulation: a cooperative-async
// engine (no real threads, just interleaved `await`s) so multiple
// characters' judgement cycles appear to progress "simultaneously" the
// way the spec describes, while staying fully deterministic and easy to
// reason about. No DOM: the scene (scenes/exploration.js) owns
// rendering and just passes an `onUpdate` callback to call after every
// state change, plus reads the worker objects this module mutates.
import { rollJudgement } from "./dice.js";
import {
  computeGatherAbility,
  computeMineAbility,
  computeSuperviseAbility,
  needsGatherSupervisor,
  needsMineSupervisor,
  pickGatherReward,
  pickMineReward,
  STANDARD_ENVIRONMENT,
} from "./data/exploration.js";
import {
  createEmptyResources,
  createAmberSugarMineralInstance,
  naturalResourceTierName,
  rigidResourceTierName,
} from "./data/resourceCatalog.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createWorker(character, role) {
  return {
    character,
    role, // "gather" | "mine"
    isSupervisor: false,
    progress: 0,
    done: false,
    statusText: "",
    usedGather: false,
    usedMine: false,
    usedSupervise: false,
  };
}

// Builds the two groups' worker lists up front (synchronously), so the
// caller can render their initial (0-progress) state before the actual
// async simulation (runExploration) starts.
export function createExplorationGroups({ gatherMembers, mineMembers }) {
  return {
    gatherGroup: { role: "gather", members: gatherMembers.map((c) => createWorker(c, "gather")), supervisor: null, callQueue: [] },
    mineGroup: { role: "mine", members: mineMembers.map((c) => createWorker(c, "mine")), supervisor: null, callQueue: [] },
  };
}

function pickSupervisor(members) {
  let best = -Infinity;
  let ties = [];
  for (const worker of members) {
    const value = computeSuperviseAbility(worker.character);
    if (value > best) {
      best = value;
      ties = [worker];
    } else if (value === best) {
      ties.push(worker);
    }
  }
  return ties[Math.floor(Math.random() * ties.length)];
}

// Adds one resolved reward into the haul (shaped like
// createEmptyResources()'s output) and returns its display name for the
// worker's own status line ("獲得：〇〇"), or null for no acquisition.
function addToHaul(haul, reward) {
  if (!reward) return null;
  if (reward.category === "amber") {
    const instance = createAmberSugarMineralInstance(reward.quality);
    haul.rigid.amberSugarMineral.push(instance);
    return instance.name;
  }
  haul[reward.category][reward.speciesId][reward.quality] += 1;
  return reward.category === "natural"
    ? naturalResourceTierName(reward.speciesId, reward.quality)
    : rigidResourceTierName(reward.speciesId, reward.quality);
}

function requestSupervisorHelp(group, worker, successCount) {
  return new Promise((resolve) => {
    group.callQueue.push({ worker, successCount, resolve });
  });
}

// One full 採集/採掘判定 cycle for `worker` -- also reused, unmodified,
// for a supervisor's own rounds once everyone else in their group is
// done (the call-for-help step simply never triggers for them, since
// `group.supervisor !== worker` is false in that case).
async function runWorkerRound(group, worker, environment, onUpdate, delayMs, haul) {
  const activityLabel = worker.role === "gather" ? "採集" : "採掘";
  const ability = worker.role === "gather" ? computeGatherAbility(worker.character) : computeMineAbility(worker.character);

  worker.statusText = `${activityLabel}判定に挑戦！`;
  onUpdate();
  await sleep(delayMs);

  const { rolls, successCount } = rollJudgement(ability);
  worker.statusText = `判定出目：[${rolls.join("、")}]`;
  onUpdate();
  await sleep(delayMs);

  worker.statusText = `判定出目：[${rolls.join("、")}] → 成功数${successCount}`;
  onUpdate();
  await sleep(delayMs);

  let finalSuccessCount = successCount;
  const needsHelp = worker.role === "gather" ? needsGatherSupervisor(successCount, environment) : needsMineSupervisor(successCount, environment);
  const supervisorAvailable = group.supervisor && group.supervisor !== worker && !group.supervisor.done;
  if (needsHelp && supervisorAvailable) {
    worker.statusText = `判定結果：成功数${successCount}　作業監督に連絡。到着待機中…`;
    onUpdate();
    finalSuccessCount = await requestSupervisorHelp(group, worker, successCount);
  }

  if (worker.role === "gather") worker.usedGather = true;
  else worker.usedMine = true;

  const reward = worker.role === "gather" ? pickGatherReward(finalSuccessCount, environment) : pickMineReward(finalSuccessCount, environment);
  const rewardName = addToHaul(haul, reward);
  worker.statusText = `判定結果：成功数${finalSuccessCount}　${rewardName ? `獲得：${rewardName}` : "獲得なし"}`;
  onUpdate();
  await sleep(delayMs);

  worker.progress += 1;
  if (worker.progress >= 5) {
    worker.done = true;
    worker.statusText = "作業終了。他の隊員の作業完了を待機中…";
  }
  onUpdate();
  await sleep(delayMs);
}

async function handleCall(group, supervisor, call, onUpdate, delayMs) {
  const { worker, successCount, resolve } = call;
  const name = worker.character.name;

  worker.statusText = `判定結果：成功数${successCount}　作業監督が到着。監督判定待ち`;
  supervisor.statusText = `${name}の作業場所に到着。監督判定に挑戦！`;
  onUpdate();
  await sleep(delayMs);

  const { rolls, successCount: monitorSuccess } = rollJudgement(computeSuperviseAbility(supervisor.character));
  supervisor.statusText = `${name}の作業場所に到着。判定出目：[${rolls.join("、")}]`;
  onUpdate();
  await sleep(delayMs);
  supervisor.statusText = `${name}の作業場所に到着。判定出目：[${rolls.join("、")}] → 成功数${monitorSuccess}`;
  onUpdate();
  await sleep(delayMs);

  supervisor.usedSupervise = true;
  const replaced = monitorSuccess > successCount;
  const finalCount = replaced ? monitorSuccess : successCount;

  worker.statusText = replaced
    ? `判定結果：成功数${successCount}→成功数${monitorSuccess}　作業監督の監督判定の成功数に置き換え`
    : `判定結果：成功数${successCount}　監督判定の成功数がそれ以下のため据え置き`;
  supervisor.statusText = `監督判定による置き換えに${replaced ? "成功" : "失敗"}。待機所に移動`;
  onUpdate();
  await sleep(delayMs);

  supervisor.progress += 1;
  onUpdate();

  resolve(finalCount);
}

// How much of the supervisor's own remaining capacity (5 - their
// progress) is left over once the worst case of every remaining
// non-supervisor work unit resulting in a call is accounted for. When
// this is >=1 the supervisor can safely spend a round on their own
// 採集/採掘 work without risking being unable to answer every future
// call; see runSupervisorLoop's use of this for the idle-filler-work
// behavior.
function computeStandbyMargin(supervisor, others) {
  const othersRemaining = others.length * 5 - others.reduce((sum, m) => sum + m.progress, 0);
  return 5 - supervisor.progress - othersRemaining;
}

async function runSupervisorLoop(group, environment, onUpdate, delayMs, haul) {
  const supervisor = group.supervisor;
  const others = group.members.filter((m) => m !== supervisor);
  const allOthersDone = () => others.every((m) => m.done);

  while (!allOthersDone() && supervisor.progress < 5) {
    if (group.callQueue.length > 0) {
      await handleCall(group, supervisor, group.callQueue.shift(), onUpdate, delayMs);
      continue;
    }
    // Nobody's currently calling -- if there's enough slack left in the
    // supervisor's own capacity (see computeStandbyMargin), spend the
    // otherwise-idle time on a round of their own group's work instead
    // of just waiting, so the pacing doesn't stall until every
    // non-supervisor happens to finish all 5 rounds untouched.
    if (computeStandbyMargin(supervisor, others) >= 1) {
      await runWorkerRound(group, supervisor, environment, onUpdate, delayMs, haul);
      continue;
    }
    supervisor.statusText = "担当区分からの連絡待機中…";
    onUpdate();
    await sleep(delayMs);
  }

  if (supervisor.progress >= 5) {
    supervisor.done = true;
    // The supervisor's own final round (whether it was answering a call
    // or their own filler work above) may have left a status line that
    // doesn't read as "finished" (e.g. handleCall's "待機所に移動") --
    // force it to match every other finished worker's text.
    supervisor.statusText = "作業終了。他の隊員の作業完了を待機中…";
    // Anyone already queued when the supervisor hit progress 5 can't be
    // left hanging forever -- answer them with their own result
    // unmodified (the supervisor genuinely can't help anymore). No new
    // calls can arrive after this: runWorkerRound's own supervisorAvailable
    // check (via `!group.supervisor.done`) skips calling once this flag
    // is set, so the queue is guaranteed empty once this loop finishes.
    while (group.callQueue.length > 0) {
      const call = group.callQueue.shift();
      call.worker.statusText = `判定結果：成功数${call.successCount}　作業監督が対応できないため据え置き`;
      call.resolve(call.successCount);
    }
    onUpdate();
    return;
  }

  // All others are done, and the supervisor still has rounds left --
  // do their own work directly (no one left above them to call).
  const activityLabel = group.role === "gather" ? "採集" : "採掘";
  supervisor.statusText = `担当区分の全隊員が作業を終えたため${activityLabel}作業に切り替え`;
  onUpdate();
  await sleep(delayMs);
  while (supervisor.progress < 5) {
    await runWorkerRound(group, supervisor, environment, onUpdate, delayMs, haul);
  }
}

async function runGroup(group, environment, onUpdate, delayMs, haul) {
  if (!group.members.length) return;
  if (group.members.length === 1) {
    const solo = group.members[0];
    while (solo.progress < 5) {
      await runWorkerRound(group, solo, environment, onUpdate, delayMs, haul);
    }
    return;
  }
  group.supervisor = pickSupervisor(group.members);
  group.supervisor.isSupervisor = true;
  const others = group.members.filter((m) => m !== group.supervisor);
  await Promise.all([
    runSupervisorLoop(group, environment, onUpdate, delayMs, haul),
    ...others.map(async (worker) => {
      while (worker.progress < 5) {
        await runWorkerRound(group, worker, environment, onUpdate, delayMs, haul);
      }
    }),
  ]);
}

// Runs both groups concurrently to completion, waits `finalWaitMs`, and
// resolves with the accumulated haul plus every participant (their
// usedGather/usedMine/usedSupervise flags drive phase③'s stat growth).
export async function runExploration(gatherGroup, mineGroup, environment = STANDARD_ENVIRONMENT, onUpdate = () => {}, delayMs = 1000, finalWaitMs = 2000) {
  const haul = createEmptyResources();
  await Promise.all([
    runGroup(gatherGroup, environment, onUpdate, delayMs, haul),
    runGroup(mineGroup, environment, onUpdate, delayMs, haul),
  ]);
  onUpdate();
  await sleep(finalWaitMs);
  return { haul, participants: [...gatherGroup.members, ...mineGroup.members] };
}

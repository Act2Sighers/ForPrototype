import { renderScreen, button, h, resourceHud } from "../dom.js";
import state, { grantResource, grantTieredResource } from "../state.js";
import {
  RIGID_RESOURCES,
  CHARACTER_STAT_LABELS,
  CHARACTER_STAT_FULL_LABELS,
  WEAPON_STAT_LABELS,
  CHARACTER_STAT_BY_WEAPON_STAT,
  rigidResourceTierName,
  computeStats,
  pickHighestStatCharacter,
  applyHpDamage,
  refreshWeaponPrefix,
} from "../data/resourceCatalog.js";

function rollD6() {
  return 1 + Math.floor(Math.random() * 6);
}

function interpolate(text, context) {
  return text.replace(/\{\{name\}\}/g, context.selectedCharacter?.name ?? "");
}

// Applies one terminal beat's outcome and describes what happened, for
// display right under the branch's final line (see render()'s
// effectDescriptions handling). Named "effects" rather than "reward"
// since some of these are plainly bad for the player. colorClass
// defaults to blue/red for a plain gain/loss, but a quantity that
// already has its own dedicated color (HP, or a weapon stat that feeds
// a 能力値 -- see theme.css's .stat-* classes) uses that instead, per
// the user's request that stat colors take priority over plain
// positive/negative coloring.
function applyEffect(effect, context) {
  switch (effect.kind) {
    case "grantRigidResource": {
      // Flat-quantity species only (no quality tiers) -- e.g. ザラメ鉱石.
      const species = RIGID_RESOURCES[effect.id];
      const before = state.run.resources.rigid[effect.id];
      grantResource("rigid", effect.id, effect.amount);
      const after = state.run.resources.rigid[effect.id];
      return { text: `${species.name}×${effect.amount} を獲得！（${before} → ${after}）`, colorClass: "effect-positive" };
    }
    case "grantTieredRigidResource": {
      const { before, after } = grantTieredResource("rigid", effect.id, effect.tier, effect.amount);
      const name = rigidResourceTierName(effect.id, effect.tier);
      return { text: `${name}×${effect.amount} を獲得！（${before} → ${after}）`, colorClass: "effect-positive" };
    }
    case "damageHighestStatCharacter": {
      const target = pickHighestStatCharacter(state.formationSlots, effect.statKey);
      if (!target) return null;
      const before = target.currentHp ?? computeStats(target).hp;
      applyHpDamage(target, effect.amount);
      const after = target.currentHp;
      const hpLabel = `${CHARACTER_STAT_LABELS.hp}(${CHARACTER_STAT_FULL_LABELS.hp})`;
      return {
        text: `${target.name}の${hpLabel}が ${before - after} 減少…（${before} → ${after}）`,
        colorClass: "stat-hp",
      };
    }
    case "damageSelectedCharacterWeaponStat": {
      const character = context.selectedCharacter;
      if (!character?.weapon) return null;
      const before = character.weapon.stats[effect.statKey];
      character.weapon.stats[effect.statKey] = Math.max(effect.min ?? 0, before - effect.amount);
      refreshWeaponPrefix(character.weapon);
      const after = character.weapon.stats[effect.statKey];
      const charKey = CHARACTER_STAT_BY_WEAPON_STAT[effect.statKey];
      return {
        text: `${character.name}の武器の${WEAPON_STAT_LABELS[effect.statKey]}が ${before - after} 減少…（${before} → ${after}）`,
        colorClass: `stat-${charKey}`,
      };
    }
    default:
      throw new Error(`Unknown episode effect kind: "${effect.kind}"`);
  }
}

// 台本 (script) interpreter shared by every オープニング/遭遇/エンディング
// event: the caller (map.js) supplies a beat graph (see data/scripts.js)
// and this scene just walks it -- see that file for the beat shapes.
export function EpisodeScene(container, params, api) {
  const script = params.script;
  const context = { selectedCharacter: null };
  let current = null;
  // Set once a branch's terminal "end" beat has run its effects -- the
  // last line stays on screen with the effect text appended below it
  // (rather than the scene closing immediately), and the player needs
  // one more click to actually leave. null before that point; an array
  // (possibly empty, e.g. the エンディング script has no effects) once
  // it happens.
  let effectDescriptions = null;

  // A "judgement" beat resolves into an ordinary line the moment it's
  // entered (so the dice only roll once, not on every re-render), with
  // an auto-generated line describing the roll. 成功/失敗 gets its own
  // colored span rather than being plain text.
  function resolveBeat(beat) {
    if (beat.type !== "judgement") return beat;
    const character = context.selectedCharacter;
    const statValue = computeStats(character)[beat.statKey];
    const rolls = Array.from({ length: statValue }, rollD6);
    const success = rolls.some((die) => die >= 4);
    const prefix = `${character.name}の${beat.statLabel}（${statValue}）で判定：D6を${statValue}回振り、出目は［${rolls.join("、")}］。出目に4以上が${
      success ? "含まれていたため" : "無かったため"
    }、判定は【`;
    const resultSpan = h("span", { class: success ? "effect-positive" : "effect-negative", text: success ? "成功" : "失敗" });
    return { textNodes: [prefix, resultSpan, "】。"], next: success ? beat.success : beat.failure };
  }

  function goto(beatId) {
    const beat = resolveBeat(script.beats[beatId]);
    if (beat.type === "end") {
      effectDescriptions = (beat.effects ?? []).map((effect) => applyEffect(effect, context)).filter(Boolean);
      render();
      return;
    }
    current = beat;
    effectDescriptions = null;
    render();
  }

  function selectCharacter(character, nextId) {
    context.selectedCharacter = character;
    goto(nextId);
  }

  function render() {
    const isFinished = effectDescriptions !== null;
    const textContent = current.textNodes ?? [interpolate(current.text ?? "", context)];
    const speaker = current.speaker ?? ""; // blank nameplate for the narrator (観測者)

    const textboxChildren = [];
    if (speaker) textboxChildren.push(h("p", { class: "episode-textbox__name", text: speaker }));
    textboxChildren.push(h("p", {}, textContent));
    if (effectDescriptions) {
      for (const effect of effectDescriptions) {
        textboxChildren.push(h("p", { class: `episode-effect ${effect.colorClass}`, text: effect.text }));
      }
    }

    const stage = h("div", { class: "episode-stage" }, [
      h(
        "div",
        {
          class: "episode-textbox",
          onClick: isFinished
            ? () => api.closeScene()
            : current.next && !current.choices
            ? () => goto(current.next)
            : undefined,
        },
        textboxChildren
      ),
    ]);

    const body = [stage];
    if (!isFinished && current.choices) {
      body.push(
        h(
          "div",
          { class: "chip-row" },
          current.choices.map((choice) =>
            button(choice.label, { variant: "primary", onClick: () => goto(choice.next) })
          )
        )
      );
    } else if (!isFinished && current.type === "characterSelect") {
      body.push(
        h(
          "div",
          { class: "slot-list" },
          state.formationSlots.map((character) =>
            h("div", { class: "slot" }, [
              h("div", { class: "slot__meta" }, [
                h("span", { class: "slot__id", text: `Lv.${character.level}` }),
                h("span", { class: "slot__name", text: character.name }),
              ]),
              h("div", { class: "slot__actions" }, [
                button("選択する", { variant: "primary", onClick: () => selectCharacter(character, current.next) }),
              ]),
            ])
          )
        )
      );
    }

    const actions = [button("ポーズ", { variant: "ghost", onClick: () => api.callScene("pause") })];
    if (isFinished) {
      actions.push(button("閉じる", { variant: "primary", onClick: () => api.closeScene() }));
    } else if (current.next && !current.choices && current.type !== "characterSelect") {
      actions.push(button("すすめる", { variant: "primary", onClick: () => goto(current.next) }));
    }

    renderScreen(container, {
      eyebrow: "EPISODE",
      title: "エピソード",
      corner: resourceHud(state.run?.resources),
      body,
      actions,
    });
  }

  goto(script.startId);

  return { onResume: () => render() };
}

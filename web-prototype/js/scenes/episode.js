import { renderScreen, button, h, resourceHud } from "../dom.js";
import state, { grantResource } from "../state.js";
import { computeStats, pickHighestStatCharacter, applyHpDamage, refreshWeaponPrefix } from "../data/resourceCatalog.js";

function rollD6() {
  return 1 + Math.floor(Math.random() * 6);
}

function interpolate(text, context) {
  return text.replace(/\{\{name\}\}/g, context.selectedCharacter?.name ?? "");
}

// Applies one terminal beat's outcome. Named "effects" rather than
// "reward" since some of these are plainly bad for the player (e.g.
// damageHighestStatCharacter) -- see data/scripts.js.
function applyEffect(effect, context) {
  switch (effect.kind) {
    case "grantRigidResource":
      grantResource("rigid", effect.id, effect.amount);
      return;
    case "damageHighestStatCharacter": {
      const target = pickHighestStatCharacter(state.formationSlots, effect.statKey);
      if (target) applyHpDamage(target, effect.amount);
      return;
    }
    case "damageSelectedCharacterWeaponStat": {
      const character = context.selectedCharacter;
      if (character?.weapon) {
        const current = character.weapon.stats[effect.statKey];
        character.weapon.stats[effect.statKey] = Math.max(effect.min ?? 0, current - effect.amount);
        refreshWeaponPrefix(character.weapon);
      }
      return;
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

  // A "judgement" beat resolves into an ordinary line the moment it's
  // entered (so the dice only roll once, not on every re-render), with
  // an auto-generated line describing the roll.
  function resolveBeat(beat) {
    if (beat.type !== "judgement") return beat;
    const character = context.selectedCharacter;
    const statValue = computeStats(character)[beat.statKey];
    const rolls = Array.from({ length: statValue }, rollD6);
    const success = rolls.some((die) => die >= 4);
    const resultText = success
      ? "出目に4以上が含まれていたため、判定は【成功】。"
      : "出目に4以上は無かったため、判定は【失敗】。";
    const text = `${character.name}の${beat.statLabel}（${statValue}）で判定：D6を${statValue}回振り、出目は［${rolls.join("、")}］。${resultText}`;
    return { text, next: success ? beat.success : beat.failure };
  }

  function goto(beatId) {
    current = resolveBeat(script.beats[beatId]);
    if (current.type === "end") {
      for (const effect of current.effects ?? []) applyEffect(effect, context);
      api.closeScene();
      return;
    }
    render();
  }

  function selectCharacter(character, nextId) {
    context.selectedCharacter = character;
    goto(nextId);
  }

  function render() {
    const text = interpolate(current.text ?? "", context);
    const stage = h("div", { class: "episode-stage" }, [
      h(
        "div",
        {
          class: "episode-textbox",
          onClick: current.next && !current.choices ? () => goto(current.next) : undefined,
        },
        [h("p", { class: "episode-textbox__name", text: "ナレーション" }), h("p", { text })]
      ),
    ]);

    const body = [stage];
    if (current.choices) {
      body.push(
        h(
          "div",
          { class: "chip-row" },
          current.choices.map((choice) =>
            button(choice.label, { variant: "primary", onClick: () => goto(choice.next) })
          )
        )
      );
    } else if (current.type === "characterSelect") {
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
    if (current.next && !current.choices && current.type !== "characterSelect") {
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

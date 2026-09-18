import { SceneManager } from "./sceneManager.js";
import { SCENE_LABELS } from "./labels.js";
import { TitleScene } from "./scenes/title.js";
import { SaveSlotScene } from "./scenes/saveSlot.js";
import { OptionsScene } from "./scenes/options.js";
import { PauseScene } from "./scenes/pause.js";
import { WorldScene } from "./scenes/world.js";
import { MapScene } from "./scenes/map.js";
import { EpisodeScene } from "./scenes/episode.js";
import { BattleScene } from "./scenes/battle.js";
import { ExplorationScene } from "./scenes/exploration.js";
import { TradeScene } from "./scenes/trade.js";
import { WarehouseScene } from "./scenes/warehouse.js";
import { GalleryScene } from "./scenes/gallery.js";
import { SquadFormationScene } from "./scenes/squadFormation.js";
import { WeaponStorageScene } from "./scenes/weaponStorage.js";
import { ResourceStorageScene } from "./scenes/resourceStorage.js";
import { SmithyScene } from "./scenes/smithy.js";
import { WeaponForgeScene } from "./scenes/weaponForge.js";
import { WeaponEnhanceScene } from "./scenes/weaponEnhance.js";
import { WeaponTradeScene } from "./scenes/weaponTrade.js";
import { TimeEatsScene } from "./scenes/timeEats.js";
import { MaturationScene } from "./scenes/maturation.js";
import { HiringScene } from "./scenes/hiring.js";
import { ResultScene } from "./scenes/result.js";

const registry = {
  title: TitleScene,
  saveSlot: SaveSlotScene,
  options: OptionsScene,
  pause: PauseScene,
  world: WorldScene,
  map: MapScene,
  episode: EpisodeScene,
  battle: BattleScene,
  exploration: ExplorationScene,
  trade: TradeScene,
  warehouse: WarehouseScene,
  gallery: GalleryScene,
  squadFormation: SquadFormationScene,
  weaponStorage: WeaponStorageScene,
  resourceStorage: ResourceStorageScene,
  smithy: SmithyScene,
  weaponForge: WeaponForgeScene,
  weaponEnhance: WeaponEnhanceScene,
  weaponTrade: WeaponTradeScene,
  timeEats: TimeEatsScene,
  maturation: MaturationScene,
  hiring: HiringScene,
  result: ResultScene,
};

const stage = document.getElementById("stage");
const crumbbar = document.getElementById("crumbbar");

function renderCrumbs(stackIds) {
  crumbbar.innerHTML = "";
  stackIds.forEach((id, index) => {
    if (index > 0) {
      const sep = document.createElement("span");
      sep.className = "crumb-sep";
      sep.textContent = "›";
      crumbbar.appendChild(sep);
    }
    const crumb = document.createElement("span");
    crumb.className = "crumb" + (index === stackIds.length - 1 ? " is-active" : "");
    crumb.textContent = SCENE_LABELS[id] ?? id;
    crumbbar.appendChild(crumb);
  });
}

const manager = new SceneManager(stage, registry, { onStackChange: renderCrumbs });
manager.api.navigateTo("title");

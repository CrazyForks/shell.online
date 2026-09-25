import { Container, Text } from "pixi.js";
import type { Application } from "pixi.js";
import type { Viewport } from "pixi-viewport";
import { buildWorld, homeView, loadArt, loadKingdom } from "./scene";
import { TILE_H, TILE_W, toScreen, toTile } from "../world/iso";
import { ActorLayer } from "./actors";
import { Birds, Blows, Dust, loadEffects, Smoke } from "./ambience";
import { Banners, OrderMark } from "./banners";
import { McpFlowLayer } from "./mcp-flows";
import { TrainingFx } from "./training";
import { isTap, pickSlop, type Press } from "../engine/tap";
import type { McpFlow } from "../state/mcp-flows";
import { loadSigils } from "./sigils";
import type { Scene } from "./PixiStage";
import { GARRISONS, MAP } from "../world/marches";
import {
  atLimit,
  headroom,
  openingZoom,
  plateCeiling,
  stepZoom,
  zoomBounds,
  type ZoomBounds,
} from "../engine/zoom";
import { createSim, garrisonSoldiers, orderHero, tickSim, yourHero, type Actor, type Mark, type Sim } from "../world/sim";
import { BODY_FONT } from "./fonts";

/**
 * The Marches, assembled and running.
 *
 * The simulation and the scene are kept apart on purpose: `world/sim.ts` knows
 * nothing about Pixi and can be run a thousand ticks deep in a test, and this
 * file only ever reads it and draws what it finds. That split is what made the
 * shaking findable — it was a question about numbers, not about pixels.
 */

/** How long the camera takes to answer a control. Short: this is not a ride. */
const ZOOM_MS = 180;

export interface KeepHandle {
  sim: Sim;
  mcpFlows?: () => readonly McpFlow[];
  /** Called when a hero or a soldier is clicked. */
  onPick?: (actor: Actor | undefined) => void;
  /** Called when the ground is clicked and the player's hero was sent there. */
  onOrder?: (x: number, y: number) => void;
  /**
   * Where the inspected figure is on the canvas, every frame.
   *
   * Called rather than returned because the card follows a figure that walks:
   * it has to be told sixty times a second, and routing that through React
   * state would re-render the whole route at frame rate to move one box.
   * `undefined` means nothing is inspected.
   */
  onTrack?: (at: { x: number; y: number } | undefined) => void;
  select(id: string | undefined): void;
  /**
   * Pulls the camera back or pushes it in by one step.
   *
   * On the handle rather than left to the wheel, because a wheel is a thing a
   * phone does not have. Pinch works and is still there; it is a two-handed
   * gesture on a device people hold in one, and it is undiscoverable -- a map
   * with no visible way out of it is a map somebody is stuck in.
   */
  zoomBy(factor: number): void;
  /** Pulls all the way back, to the whole country at once. */
  fit(): void;
  /**
   * Told when the zoom changes, so a control can say honestly whether it has
   * anywhere left to go. Called on every frame of a pinch, which is why it is
   * a callback and not React state.
   */
  onZoom?: (at: { scale: number; out: boolean; in: boolean }) => void;
  /** What the player's own hero and their soldiers are drawn in. */
  wear(skin: number, livery: number): void;
  /** Stops everything that drifts or flaps, for reduced motion. */
  still(stop: boolean): void;
  /** Rides the camera to a holding, named by id. See the road book. */
  lookAt(garrisonId: string): void;
  /**
   * Rides the camera to one figure and opens its card, as a click on it would.
   * The HUD's list of the player's own sessions is how that is reached.
   */
  follow(actorId: string): void;
  /**
   * Where the Forge's training button belongs on the canvas, every frame, and
   * how large it should be drawn at this zoom. `undefined` when the Forge is
   * off the screen. Written straight to the button's style by the route, for
   * the same reason `onTrack` is: React at frame rate is a heavy way to move
   * one box.
   */
  onForge?: (at: { x: number; y: number; scale: number } | undefined) => void;
  /** An order to train has been sent; the Forge lights up until it arrives. */
  train(): void;
  /** The order failed; the Forge goes dark again. */
  cancelTraining(): void;
  /** A trained soldier has joined the field. */
  onTrained?: (actorId: string) => void;
}

/**
 * The style of a floating number. Built here so Blows stays about pooling.
 *
 * Large, and larger again zoomed out (see Blows.zoomed). At twenty pixels a
 * number was only legible close enough in that the fight filled the screen,
 * which is not where anybody watches a fight from.
 */
function numberFor(text: string, kind: Mark["kind"]): Container {
  const node = new Text({
    text,
    /* Rasterised at twice the size, so the enlargement does not blur it. */
    resolution: 2,
    style: {
      fontFamily: BODY_FONT,
      fontSize: 44,
      fontWeight: "900",
      fill: kind === "damage" ? 0xff5a4f : 0xffd84a,
      stroke: { color: 0x1a1008, width: 9 },
    },
  });
  node.anchor.set(0.5);
  return node;
}

export async function buildKeepScene(
  app: Application,
  viewport: Viewport,
  handle: KeepHandle,
): Promise<Scene> {
  const [art, fx, sigils, kingdom] = await Promise.all([
    loadArt(),
    loadEffects(),
    loadSigils(),
    loadKingdom(),
    /*
     * The signs' face, waited for before anything is drawn.
     *
     * Pixi rasterises a Text when the object is made, not when it is shown, so
     * a webfont that arrives a moment later arrives too late: the signs come
     * out in the fallback serif and stay that way until the scene is rebuilt.
     * `font-display: swap` fixes this for the DOM and does nothing for a canvas.
     *
     * It fails soft. A sign in Georgia is a sign; a map that would not open
     * because a font did not is not.
     */
    document.fonts?.load('26px "Pirata One"').catch(() => undefined),
  ]);
  const { root, camps, campBanners, campLights, lanterns, banners, things, labels, signs } =
    buildWorld(app, art, kingdom);

  const world = new Container();
  world.addChild(root);

  const sim = handle.sim;
  const mcpFlows = new McpFlowLayer(world);
  garrisonSoldiers(sim);

  /*
   * The camera's limits, asked for rather than remembered.
   *
   * `app.screen` is the live canvas, so this is correct after a rotation, a
   * split-screen resize, or the moment before the first measurement lands --
   * all three of which a stored copy got wrong.
   */
  const bounds = (): ZoomBounds =>
    zoomBounds(app.screen.width, app.screen.height, MAP.width * TILE_W, MAP.height * TILE_H);

  /*
   * The zoom a ride ends on.
   *
   * The same one the game opens at, which is the point: a ride that ends
   * somewhere else teaches the player that the camera has moods. It was the
   * constant 1 for arriving at your own hero and 0.95 for a holding, both of
   * which are a face filling a phone.
   */
  const settled = () => openingZoom(app.screen.width, app.screen.height, bounds());

  const tellZoom = (scale: number) => {
    const limits = bounds();
    const at = atLimit(scale, limits);
    handle.onZoom?.({ scale, out: at.out, in: at.in });
  };

  let selected: string | undefined;
  const actors = new ActorLayer(art, things, labels, sigils);
  const companies = new Banners(banners);
  const orderMark = new OrderMark(banners);

  const birds = new Birds(things);
  const smoke = new Smoke(things, fx["fx-smoke_01"]);
  const dust = new Dust(things, fx["fx-smoke_01"]);
  const blows = new Blows(things, fx, numberFor);
  /* The training yard is the Forge, where things that did not exist are made. */
  const forge = GARRISONS.find((holding) => holding.id === "forge") ?? GARRISONS[0];
  /*
   * On the world rather than among the things: that layer is dusk-tinted, and
   * a light tinted towards evening is a light nobody can see.
   */
  const training = new TrainingFx(world, fx, { x: forge.x, y: forge.y + 1 });

  handle.select = (id) => {
    selected = id;
  };
  handle.wear = (skin, livery) => actors.wear(skin, livery);
  /*
   * The reduced-motion setting reached the interface and stopped at the edge of
   * the canvas, so somebody who had asked for less motion got a still HUD over
   * a map full of drifting particles and flapping birds -- the setting doing
   * nothing in the one place it was most needed.
   */
  handle.still = (stop) => {
    birds.still(stop);
    smoke.still(stop);
    dust.still(stop);
    /*
     * The lamps hold at full brightness rather than going out. Everything else
     * that moves here is ornament; a lamp is what makes the ground under it
     * legible, so the setting takes the flicker and leaves the light.
     */
    lanterns.still(stop);
    training.still(stop);
  };
  handle.train = () => training.begin(sim);
  handle.cancelTraining = () => training.cancel();
  handle.lookAt = (garrisonId) => {
    const garrison = GARRISONS.find((holding) => holding.id === garrisonId);
    if (!garrison) return;
    const { x, y } = toScreen(garrison.x, garrison.y);
    /*
     * Animated rather than cut, and not because it is prettier: a cut across a
     * map this size leaves you somewhere that looks like where you were, with
     * no idea which way you came from. The ride is short enough not to be a
     * wait and long enough to show the direction.
     */
    const scale = settled();
    viewport.animate({
      position: { x, y: y - headroom(app.screen.height) / scale },
      scale,
      time: 600,
      ease: "easeInOutSine",
    });
  };

  handle.follow = (actorId) => {
    const actor = sim.actors.find((one) => one.id === actorId);
    if (!actor) return;
    const { x, y } = toScreen(actor.x, actor.y);
    const scale = Math.max(viewport.scale.x, settled());
    viewport.animate({
      position: { x, y: y - headroom(app.screen.height) / scale },
      scale,
      time: 600,
      ease: "easeInOutSine",
    });
    selected = actor.id;
    handle.onPick?.(actor);
  };

  /*
   * The zoom controls.
   *
   * Everything here goes through `stepZoom` against the live limits rather
   * than through pixi-viewport's own zoom helpers, so a control can never put
   * the camera somewhere the clamp will immediately drag it back out of --
   * which on a phone looked exactly like a zoom button that did nothing.
   */
  const zoomTo = (scale: number) => {
    viewport.animate({
      /* Held on the middle of the screen, which is where the eye already is. */
      position: { x: viewport.center.x, y: viewport.center.y },
      scale,
      time: ZOOM_MS,
      ease: "easeInOutSine",
    });
    tellZoom(scale);
  };
  handle.zoomBy = (factor) => zoomTo(stepZoom(viewport.scale.x, factor, bounds()));
  handle.fit = () => zoomTo(bounds().min);

  /*
   * Picking is done by finding the nearest wright to where the map was
   * clicked, rather than by giving every figure its own hit area.
   *
   * Two reasons. A wright is about twenty pixels tall and zooms down to seven,
   * and asking somebody to hit that exactly is asking them to miss; a generous
   * radius around the click is what makes small figures selectable at all.
   * And it means one hit test against the world instead of one display object
   * per actor in the interaction tree, which is cheaper and, unlike per-sprite
   * hit areas, actually worked.
   */
  /*
   * The listener goes on the stage, with a hit area the size of the screen.
   *
   * A Pixi container only hit-tests its children unless it is given one of its
   * own, so taps on open grass -- which is most of the map -- reached nothing
   * and the handler on the viewport never fired. A stage-wide hit area means
   * every click inside the canvas arrives, and where it landed is then a
   * question about coordinates rather than about the display list.
   */
  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;

  /*
   * Where the current press began, and whether a second finger joined it, so
   * the end of a pan or a pinch is not mistaken for a tap. See engine/tap.ts.
   */
  const down = new Set<number>();
  let press: Press | undefined;
  const onDown = (event: { pointerId: number; global: { x: number; y: number } }) => {
    down.add(event.pointerId);
    if (down.size === 1) press = { x: event.global.x, y: event.global.y, multi: false };
    else if (press) press.multi = true;
  };
  const onUp = (event: { pointerId: number }) => {
    down.delete(event.pointerId);
  };
  app.stage.on("pointerdown", onDown);
  app.stage.on("pointerup", onUp);
  app.stage.on("pointerupoutside", onUp);
  app.stage.on("pointercancel", onUp);

  const onTap = (event: { global: { x: number; y: number }; pointerType: string }) => {
    const pressed = press;
    /* Only once every finger is up, so a pinch's first lift is not a tap either. */
    if (down.size > 0) return;
    press = undefined;
    if (!isTap(pressed, event.global.x, event.global.y, event.pointerType)) return;
    const world = viewport.toWorld(event.global.x, event.global.y);
    const tile = toTile(world.x, world.y);

    /*
     * Ask the renderer what is under the point, because only the renderer knows
     * how big anybody is drawn. Heroes and soldiers can be inspected; the watch
     * and the Unmade cannot, so they are not offered.
     */
    const inspectable = new Map(
      sim.actors
        .filter((actor) => actor.role === "hero" || actor.role === "soldier")
        .map((actor) => [`${actor.id}`, actor] as const),
    );
    const hit = actors.hit(
      world.x,
      world.y,
      (id) => inspectable.has(id),
      pickSlop(event.pointerType) / viewport.scale.x,
    );
    const nearest = hit ? inspectable.get(hit) : undefined;

    if (nearest) {
      selected = nearest.id;
      handle.onPick?.(nearest);
      return;
    }

    /*
     * Nothing under the click: it is an order, not an inspection.
     *
     * Clicking a figure inspects it and clicking the ground moves your hero,
     * which is the arrangement every game of this shape uses and the one
     * nobody has to be taught. Ordering also clears the inspect panel, because
     * the panel is about a thing you pointed at and you have just pointed
     * somewhere else.
     */
    if (orderHero(sim, tile.x, tile.y)) {
      selected = undefined;
      handle.onPick?.(undefined);
      handle.onOrder?.(tile.x, tile.y);
      /* Answer the press at once, and say where. */
      orderMark.show(tile.x, tile.y);
    }
  };
  app.stage.on("pointertap", onTap);

  const home = homeView(app.screen.width, app.screen.height);
  viewport.setZoom(home.zoom, true);
  viewport.moveCenter(home.x, home.y);
  tellZoom(home.zoom);

  /*
   * Once the roster arrives, the view moves to the player's own hero.
   *
   * It opens on the Keep because that is all there is to open on: the scene is
   * built before the first roster comes back, and a map this size has to start
   * somewhere. But the Keep is not where the player's own company is, and
   * arriving at somebody else's landmark and having to go looking for yourself
   * is a poor first thirty seconds.
   *
   * Once only. Re-centring on every poll would drag the view back every four
   * seconds, out from under whoever was reading a signpost.
   */
  /*
   * Which camp sites are occupied, rebuilt only when the roster changes.
   *
   * Comparing the set every frame would be fine and pointless; the roster moves
   * on a four-second poll and this is a handful of string keys.
   */
  let held = new Set<string>();
  let heldFor = -1;
  const heldCamps = () => {
    if (sim.camps.size === heldFor) return;
    heldFor = sim.camps.size;
    held = new Set([...sim.camps.values()].map((camp) => `${camp.x},${camp.y}`));

    /* Each standing camp flies its holder's colour, and lights its own gate. */
    for (const [uid, camp] of sim.camps) {
      const key = `${camp.x},${camp.y}`;
      const standard = campBanners.get(key);
      if (standard) standard.tint = sim.banners.get(uid) ?? 0xffffff;
    }

    /*
     * The lamps, which are the reason a banner at dusk can be made out at all.
     * Lit with the camp rather than always, because a lamp burning over ground
     * nobody holds says somebody is standing there who is not.
     */
    for (const [key, lit] of campLights) {
      const on = held.has(key);
      lit.glow.visible = on;
      for (const lamp of lit.lamps) lamp.visible = on;
    }
  };

  /*
   * Where the inspected figure is, in canvas pixels, reported every frame.
   *
   * `toScreen` here is pixi-viewport's, which is the world transform -- not the
   * projection's `toScreen`, which turns tiles into world units. The figure's
   * position has to go through both, in that order.
   */
  const track = () => {
    if (!handle.onTrack) return;
    const chosen = selected ? sim.actors.find((actor) => actor.id === selected) : undefined;
    if (!chosen) {
      handle.onTrack(undefined);
      return;
    }
    const world = toScreen(chosen.x, chosen.y);
    handle.onTrack(viewport.toScreen(world.x, world.y));
  };

  /*
   * The Forge's button, placed over the front of its yard.
   *
   * Sized with the zoom, so it reads as a thing standing at the Forge rather
   * than a sticker on the glass -- and never below the size a thumb can hit,
   * which is the floor the rest of the interface holds.
   */
  const forgeFront = toScreen(forge.x, forge.y + 2.5);
  const placeForge = () => {
    if (!handle.onForge) return;
    const at = viewport.toScreen(forgeFront.x, forgeFront.y);
    const margin = 40;
    if (at.x < -margin || at.y < -margin || at.x > app.screen.width + margin || at.y > app.screen.height + margin) {
      handle.onForge(undefined);
      return;
    }
    handle.onForge({ x: at.x, y: at.y, scale: Math.min(1.5, Math.max(0.85, viewport.scale.x * 1.4)) });
  };

  let found = false;
  const findYou = () => {
    if (found) return;
    const hero = yourHero(sim);
    if (!hero) return;
    found = true;
    const seat = toScreen(hero.x, hero.y);
    const scale = settled();
    viewport.animate({
      position: { x: seat.x, y: seat.y - headroom(app.screen.height) / scale },
      scale,
      time: 700,
      ease: "easeInOutSine",
    });
  };

  /*
   * Signs keep roughly the same size on screen at any zoom, and the sentence
   * under the name only appears close up. A map zoomed out is otherwise a map
   * covered in enormous words, and zoomed in they disappear.
   */
  let detailed: boolean | undefined;
  const rescaleSigns = () => {
    const scale = 1 / viewport.scale.x;
    const wanted = viewport.scale.x > 0.75;
    for (const sign of signs.children) {
      sign.scale.set(Math.min(1.6, Math.max(0.55, scale)));
      /*
       * A board is centred over its post and grows upward. Hide it for the
       * last few pixels of a pan instead of showing a severed sentence along
       * the browser edge (or underneath the persistent Pause control).
       */
      const point = viewport.toScreen(sign.x, sign.y);
      const bounds = sign.getLocalBounds();
      const screenScale = sign.scale.x * viewport.scale.x;
      const left = point.x + bounds.x * screenScale;
      const top = point.y + bounds.y * screenScale;
      const right = left + bounds.width * screenScale;
      const bottom = top + bounds.height * screenScale;
      sign.visible = left >= 8 && top >= 8 && right <= app.screen.width - 8 && bottom <= app.screen.height - 8;
    }
    actors.zoomed(viewport.scale.x, plateCeiling(app.screen.width));
    blows.zoomed(viewport.scale.x, plateCeiling(app.screen.width));
    /*
     * The controls are told from here rather than from their own listener:
     * this already runs on every zoom and every frame of a drag, and a second
     * listener on the same events is a second thing to remember to remove.
     */
    tellZoom(viewport.scale.x);
    /*
     * Only when it changes. Showing the sentence redraws every board, and
     * `moved` fires on every frame of a drag -- redrawing six boards a frame to
     * arrive at the picture already on screen is the kind of cost that only
     * shows up as a number in somebody else's profile.
     */
    if (wanted === detailed) return;
    detailed = wanted;
    for (const sign of signs.children) {
      (sign as Container & { setDetailed?: (on: boolean) => void }).setDetailed?.(wanted);
    }
  };
  rescaleSigns();
  viewport.on("zoomed", rescaleSigns);
  viewport.on("moved", rescaleSigns);
  /*
   * And on a resize, which is not an input and so is not a `zoomed`.
   *
   * Two things go stale when the canvas changes shape. The zoom limits move,
   * and pixi-viewport emits `zoomed` only when the clamp actually changes the
   * scale -- so a phone turned from landscape to portrait, where the floor
   * drops and the current zoom is already legal, left the zoom-out control
   * disabled with nothing to tell the player otherwise. And the ceiling on a
   * name board comes from the width of the screen, which has just changed.
   * `rescaleSigns` is both answers.
   */
  app.renderer.on("resize", rescaleSigns);

  /*
   * The simulation runs at a fixed thirty ticks a second whatever the display
   * does, with a ceiling on catching up: a tab left in the background for ten
   * minutes should resume, not replay ten minutes of battle in one frame.
   */
  let owed = 0;
  const TICK_MS = 1000 / 30;

  return {
    world,
    tick(deltaMs) {
      owed = Math.min(owed + deltaMs, TICK_MS * 5);
      while (owed >= TICK_MS) {
        owed -= TICK_MS;
        tickSim(sim);
      }
      findYou();
      heldCamps();
      track();
      placeForge();
      /* Only the camps somebody is actually holding are standing. */
      for (const [key, camp] of camps) camp.visible = held.has(key);
      companies.sync(sim);
      orderMark.tick(deltaMs);
      actors.sync(sim, selected);
      mcpFlows.sync(handle.mcpFlows?.() ?? [], sim.actors, Date.now());
      blows.sync(sim);
      const arrived = training.tick(sim, deltaMs);
      if (arrived) handle.onTrained?.(arrived);
      lanterns.tick(deltaMs);
      birds.tick(deltaMs);
      smoke.tick(deltaMs);
      dust.tick(sim, deltaMs);
    },
    destroy() {
      viewport.off("zoomed", rescaleSigns);
      viewport.off("moved", rescaleSigns);
      app.renderer.off("resize", rescaleSigns);
      app.stage.off("pointertap", onTap);
      app.stage.off("pointerdown", onDown);
      app.stage.off("pointerup", onUp);
      app.stage.off("pointerupoutside", onUp);
      app.stage.off("pointercancel", onUp);
      companies.destroy();
      orderMark.destroy();
      actors.destroy();
      mcpFlows.destroy();
      birds.destroy();
      smoke.destroy();
      dust.destroy();
      blows.destroy();
      training.destroy();
    },
  };
}

export { createSim };
export type { Actor, Sim };

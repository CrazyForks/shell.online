import { Container, FillGradient, Graphics, Sprite, Text, type Texture } from "pixi.js";
import { depthOf, toScreen } from "../world/iso";
import { MAP } from "../world/marches";
import type { Sim } from "../world/sim";
import { BODY_FONT, bodyText } from "./fonts";

/**
 * A soldier being trained at the Forge, drawn so it can be seen from anywhere.
 *
 * Two parts, because a session takes a while to exist. The moment the order is
 * given, a beacon stands over the Forge -- a column of light, rings going out
 * along the ground and sparks going up -- and it stays until the machine has
 * actually started the session, because the honest thing to show between the
 * two is that something is under way. When the new soldier appears on the
 * field, it arrives in a burst of light with its name over it, and the beacon
 * goes out.
 *
 * Nothing here decides that a session exists. The newcomer is whichever of the
 * player's own soldiers was not on the field when the order was given, which
 * is the same roster poll that puts every other soldier there.
 */

/** Long enough for a sleepy machine; after this the beacon stops claiming. */
const PATIENCE_MS = 90_000;
const BURST_MS = 1_600;
const SPARKS = 16;
const RINGS = 3;

interface Burst {
  root: Container;
  flare: Sprite;
  ring: Sprite;
  label: Text;
  age: number;
}

export class TrainingFx {
  private readonly layer = new Container();
  private readonly beacon = new Container();
  private readonly column: Graphics;
  private readonly core: Graphics;
  private readonly glow: Sprite;
  private readonly rings: Graphics[] = [];
  private readonly sparks: { sprite: Sprite; offset: number; drift: number }[] = [];
  private readonly bursts: Burst[] = [];

  private pending: { known: Set<string>; since: number } | undefined;
  private clock = 0;
  private stopped = false;

  constructor(
    parent: Container,
    private readonly textures: Record<string, Texture>,
    /** The tile the beacon stands on: the Forge's own ground. */
    private readonly at: { x: number; y: number },
  ) {
    parent.addChild(this.layer);
    /* Over everything that stands on the ground, like the floating numbers. */
    this.layer.zIndex = depthOf(MAP.width, MAP.height, 7_100);

    const { x, y } = toScreen(at.x, at.y);
    this.beacon.position.set(x, y);
    this.beacon.visible = false;
    this.layer.addChild(this.beacon);

    /* A pool of light on the ground under the column. */
    this.glow = this.add(this.textures["fx-light_01"], 0xffc861);
    this.glow.scale.set(1.3, 0.65);

    /*
     * Rings going out along the ground, flattened into the projection. Drawn
     * rather than taken from the particle pack, whose soft textures came out as
     * a faint smudge at the size a ring has to be to be seen from far out.
     */
    for (let index = 0; index < RINGS; index += 1) {
      const ring = new Graphics().ellipse(0, 0, 100, 50).stroke({ color: 0xffd27a, width: 10 });
      ring.blendMode = "add";
      this.beacon.addChild(ring);
      this.rings.push(ring);
    }

    /*
     * The column: a shaft of light from the ground to well above the Forge's
     * roofs, bright at the foot and gone at the top, with a hot core inside a
     * wider haze. Sized in world pixels so it reads as a landmark at any zoom.
     */
    const shaft = (width: number, height: number, foot: number, top: number) =>
      new Graphics().rect(-width / 2, -height, width, height).fill(
        new FillGradient({
          type: "linear",
          start: { x: 0, y: 1 },
          end: { x: 0, y: 0 },
          colorStops: [
            { offset: 0, color: `rgba(255, 236, 170, ${foot})` },
            { offset: 1, color: `rgba(255, 210, 122, ${top})` },
          ],
          textureSpace: "local",
        }),
      );
    this.column = shaft(150, 900, 0.55, 0);
    this.column.blendMode = "add";
    this.core = shaft(44, 820, 0.95, 0);
    this.core.blendMode = "add";
    this.beacon.addChild(this.column, this.core);

    for (let index = 0; index < SPARKS; index += 1) {
      const spark = this.add(this.textures["fx-spark_04"], 0xffe08a);
      this.sparks.push({ sprite: spark, offset: index / SPARKS, drift: ((index * 7919) % 13) / 13 - 0.5 });
    }
  }

  private add(texture: Texture | undefined, tint: number): Sprite {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.blendMode = "add";
    sprite.tint = tint;
    this.beacon.addChild(sprite);
    return sprite;
  }

  /** Whether a recruit is on the way, for the button to say so. */
  get training(): boolean {
    return this.pending !== undefined;
  }

  /**
   * The order has been given. `sim` is read now, so the newcomer can be told
   * apart from everybody already standing on the field.
   */
  begin(sim: Sim): void {
    const known = new Set(sim.actors.map((actor) => actor.id));
    this.pending = { known, since: this.clock };
    this.beacon.visible = true;
  }

  /** The order failed or was abandoned; the beacon goes out without a burst. */
  cancel(): void {
    this.pending = undefined;
    this.beacon.visible = false;
  }

  /** Reduced motion: the beacon still stands, but holds still. */
  still(stop: boolean): void {
    this.stopped = stop;
  }

  /**
   * Advances the effect, and reports the newcomer's id on the frame it is
   * found, so the scene can tell the HUD.
   */
  tick(sim: Sim, deltaMs: number): string | undefined {
    this.clock += deltaMs;
    let arrived: string | undefined;

    if (this.pending) {
      const newcomer = sim.actors.find(
        (actor) =>
          actor.role === "soldier" &&
          actor.session !== undefined &&
          actor.heroUid !== undefined &&
          actor.heroUid === sim.youUid &&
          !this.pending!.known.has(actor.id),
      );
      if (newcomer) {
        arrived = newcomer.id;
        this.burst(newcomer.x, newcomer.y, newcomer.name);
        /* And one at the Forge, so the eye that was watching it sees it land. */
        this.burst(this.at.x, this.at.y, "");
        this.cancel();
      } else if (this.clock - this.pending.since > PATIENCE_MS) {
        this.cancel();
      }
    }

    if (this.beacon.visible) this.animateBeacon();
    this.animateBursts(deltaMs);
    return arrived;
  }

  private animateBeacon(): void {
    const t = this.stopped ? 0 : this.clock / 1000;
    const pulse = 0.75 + Math.sin(t * 4) * 0.25;

    this.column.scale.set(0.85 + pulse * 0.3, 1);
    this.column.alpha = 0.6 + pulse * 0.4;
    this.core.alpha = 0.75 + pulse * 0.25;
    this.glow.alpha = 0.6 + pulse * 0.4;

    /* Rings along the ground, flattened into the projection, going outward. */
    this.rings.forEach((ring, index) => {
      const phase = this.stopped ? index / RINGS : (t * 0.6 + index / RINGS) % 1;
      ring.scale.set(0.4 + phase * 2.4);
      ring.alpha = (1 - phase) * 0.95;
    });

    /* Sparks going up the column and fanning out a little as they rise. */
    for (const spark of this.sparks) {
      const phase = this.stopped ? spark.offset : (t * 0.45 + spark.offset) % 1;
      spark.sprite.position.set(spark.drift * 160 * phase, -phase * 780);
      spark.sprite.scale.set(0.08 + (1 - phase) * 0.12);
      spark.sprite.alpha = Math.min(1, (1 - phase) * 1.6);
      spark.sprite.rotation = phase * 4;
    }
  }

  private burst(tileX: number, tileY: number, name: string): void {
    const root = new Container();
    const { x, y } = toScreen(tileX, tileY);
    root.position.set(x, y);

    const flare = new Sprite(this.textures["fx-flare_01"]);
    flare.anchor.set(0.5);
    flare.blendMode = "add";
    flare.tint = 0xfff1c4;

    const ring = new Sprite(this.textures["fx-circle_05"]);
    ring.anchor.set(0.5);
    ring.blendMode = "add";
    ring.tint = 0xffd27a;

    const label = new Text({
      text: name ? bodyText(`${name} joins`) : "",
      resolution: 2,
      style: {
        fontFamily: BODY_FONT,
        fontSize: 40,
        fill: 0xffe08a,
        stroke: { color: 0x1a1008, width: 8 },
      },
    });
    label.anchor.set(0.5, 1);

    root.addChild(ring, flare, label);
    this.layer.addChild(root);
    this.bursts.push({ root, flare, ring, label, age: 0 });
  }

  private animateBursts(deltaMs: number): void {
    for (let index = this.bursts.length - 1; index >= 0; index -= 1) {
      const burst = this.bursts[index];
      burst.age += deltaMs;
      const progress = Math.min(1, burst.age / BURST_MS);
      burst.flare.scale.set(0.4 + progress * 2.6);
      burst.flare.alpha = 1 - progress;
      burst.flare.position.y = -60;
      burst.ring.scale.set(0.5 + progress * 4, (0.5 + progress * 4) * 0.5);
      burst.ring.alpha = 1 - progress;
      /* The name lingers longer than the light, so it can be read. */
      burst.label.position.y = -170 - progress * 60;
      burst.label.alpha = progress < 0.7 ? 1 : 1 - (progress - 0.7) / 0.3;
      if (progress >= 1) {
        burst.root.destroy({ children: true });
        this.bursts.splice(index, 1);
      }
    }
  }

  destroy(): void {
    this.layer.destroy({ children: true });
    this.bursts.length = 0;
  }
}

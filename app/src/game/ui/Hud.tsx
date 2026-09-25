import { CLASS_LORE, WORLD } from "../lore/world";
import { SOLDIERS_PER_HERO, type Strength } from "../world/kingdom";
import { nextUnlock, type Standing } from "../state/progress";
import type { Actor } from "../world/sim";
import { sessionBreakdown } from "./session-breakdown";

/**
 * What the player needs to know without opening anything.
 *
 * Who they are and how far along, and their own sessions, top left; what they
 * can spend and what the gathering has cost, top right; the pedlar on the right
 * edge; and how the kingdom stands, with the way into the road book, bottom
 * right. Anything that opens something carries the same arrow, and opens it
 * directly rather than by way of the pause menu.
 *
 * All of it is DOM rather than canvas. It does not move with the world, it has
 * to be readable by a screen reader, and it has to be reachable with a pad —
 * three things the canvas is bad at and the document is good at.
 */

export interface HudProps {
  standing: Standing;
  marks: number;
  /** Tokens the stat-gathering has spent. See the elixir vial below. */
  elixir: number;
  /** Whether any stat-gathering has been agreed to at all. */
  gathering: boolean;
  characterClass: string;
  wrights: Actor[];
  /** True when the field is showing a stand-in garrison, not real sessions. */
  demo: boolean;
  /**
   * Whether the service has told us what has been earned.
   *
   * Unreachable is not nothing earned, and a bar reading zero because a
   * request failed is a bar telling somebody their week did not count.
   */
  counted: boolean;
  /** The uncapped number of active sessions; the canvas may draw fewer. */
  sessionTotal: number;
  /** Says whether the map is live, loading, or an explicitly labelled preview. */
  dataState: string;
  /** Whether the kingdom has the sessions to meet what is coming for it. */
  strength: Strength;
  /** True when that reading is this account's own and not an example. */
  real: boolean;
  /** The trimmed HUD, for a handset either way up. See state/layout.ts. */
  compact: boolean;
  onOpenRoster: () => void;
  /** Opens the gathering: the notice when it is off, the bill when it is on. */
  onOpenGathering: () => void;
  /** Opens the pedlar straight from the field. */
  onOpenShop: () => void;
  /** Whether the pedlar is calling yet; see progress.ts. */
  shopOpen: boolean;
  /** The signed-in player's uid, so their own sessions can be listed. */
  youUid?: string;
  /** Rides the camera to one of the player's own soldiers and opens its card. */
  onFollow: (actorId: string) => void;
  /** The pause button, which the route owns and which ends the top-right row. */
  pause?: React.ReactNode;
}

/** The real work represented by the figures currently drawn on the field. */
/** A bar with its numbers beside it, never colour alone. */
function Meter({
  label,
  value,
  of,
  tone,
  detail,
}: {
  label: string;
  value: number;
  of: number;
  tone: "xp" | "elixir";
  detail?: string;
}) {
  const fraction = of > 0 ? Math.min(1, Math.max(0, value / of)) : 0;
  return (
    <div className={`keep-meter is-${tone}`}>
      <div className="keep-meter-head">
        <span className="keep-meter-label">{label}</span>
        <span className="keep-meter-value">
          {value.toLocaleString()}
          {of > 0 && <span className="keep-meter-of"> / {of.toLocaleString()}</span>}
        </span>
      </div>
      <div
        className="keep-meter-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={of || 1}
        aria-valuenow={value}
        aria-label={label}
      >
        <span className="keep-meter-fill" style={{ width: `${fraction * 100}%` }} />
      </div>
      {detail && <p className="keep-meter-detail">{detail}</p>}
    </div>
  );
}

/**
 * How full the vial looks, which is not how many tokens there are.
 *
 * Logarithmic, because the range this has to cover is absurd. A light week is
 * a few hundred thousand tokens and a heavy one is hundreds of millions -- a
 * real machine reported eighty-three million for three days of ordinary work.
 * On the linear scale this used to have, which filled at a million, that pinned
 * the vial at the top on the first run and it never said anything again.
 *
 * A decade of tokens is a fifth of the vial: a hundred thousand is a third
 * full, ten million is two thirds, a billion is the top. The exact number is
 * printed beside it, which is where precision belongs; this is for the glance.
 */
function vialFill(tokens: number): number {
  if (tokens <= 0) return 0;
  const decades = Math.log10(tokens) / 9;
  return Math.min(100, Math.max(4, decades * 100));
}

/**
 * The elixir vial: what the stat-gathering has spent, in tokens.
 *
 * On the HUD rather than in a settings page because it is the one number in
 * this game that costs real money. Somebody playing with a resource gauge
 * should see at a glance that the gauge is their own spend, and clicking it
 * says where every drop went.
 */
function Elixir({ tokens, gathering }: { tokens: number; gathering: boolean }) {
  return (
    <div className="keep-elixir">
      <span className="keep-vial" aria-hidden="true">
        <span
          className="keep-vial-fill"
          style={{ height: `${vialFill(tokens)}%` }}
        />
      </span>
      <span className="keep-elixir-text">
        <span className="keep-elixir-label">{WORLD.essence}</span>
        <span className="keep-elixir-value">
          {gathering ? `${tokens.toLocaleString()} tokens` : "not gathering"}
        </span>
      </span>
    </div>
  );
}

/**
 * How the kingdom is holding, in words and a number.
 *
 * The veil over the camera says this too, in red at the corners, and this is
 * the half of it somebody can act on: what is short, and how short. A wash of
 * colour cannot say "three" and cannot be read aloud.
 *
 * `role="status"` rather than an alert. It is worth announcing when it
 * changes, and it is not worth interrupting anybody over: nothing is lost
 * while it is up.
 */
function Muster({ strength, real }: { strength: Strength; real: boolean }) {
  /*
   * Nothing is claimed about a kingdom nobody could count.
   *
   * When the service cannot be reached there is no reading, and the strain
   * arithmetic reports "holding" because nothing is known to be short -- which
   * is the right thing for the veil, which should not accuse anybody on the
   * strength of a failed request, and the wrong thing to print. Reporting good
   * news for data we do not have is the same mistake as reporting bad.
   */
  if (!real) {
    return (
      <p className="keep-muster is-held" role="status">
        <span aria-hidden="true">⚑ </span>
        An example garrison. {SOLDIERS_PER_HERO} sessions a hero holds the line.
      </p>
    );
  }

  if (!strength.struggling) {
    return (
      <p className="keep-muster is-held" role="status">
        <span aria-hidden="true">⚑ </span>
        The kingdom holds.
      </p>
    );
  }

  const more = strength.short;
  return (
    <p className="keep-muster is-pressed" role="status">
      <span aria-hidden="true">⚔ </span>
      <strong>The kingdom is struggling.</strong>{" "}
      {`Start ${more} more ${more === 1 ? "session" : "sessions"} to hold the line — ${SOLDIERS_PER_HERO} a hero.`}
    </p>
  );
}

/** The arrow every HUD element that opens something carries, and nothing else. */
function Opens() {
  return <span className="keep-opens" aria-hidden="true">▸</span>;
}

/** A soldier's work, as a word, because the list is read rather than glanced at. */
function doing(actor: Actor): string {
  if (actor.work === "bug") return "fixing";
  if (actor.work === "feature") return "building";
  return "waiting";
}

/**
 * The player's own sessions, under their standing.
 *
 * Scrolls inside the panel rather than growing it: the panel keeps the size it
 * had, and somebody with twenty sessions open should not find their map pushed
 * off the screen by the list of them. Each row rides to the soldier and opens
 * its card, which is where the way into the terminal already is.
 */
function YourSessions({
  wrights,
  youUid,
  demo,
  onFollow,
}: {
  wrights: Actor[];
  youUid?: string;
  demo: boolean;
  onFollow: (actorId: string) => void;
}) {
  const yours = wrights
    .filter((actor) => actor.heroUid !== undefined && actor.heroUid === youUid)
    .sort((a, b) => (b.session?.startedAt ?? 0) - (a.session?.startedAt ?? 0));

  return (
    <section className="keep-yours" aria-label="Your sessions">
      <h3 className="keep-yours-head">
        Your sessions <span className="keep-yours-count">{yours.length}</span>
      </h3>
      {yours.length === 0 ? (
        <p className="keep-yours-empty">
          {demo ? "None of these are yours: it is an example." : "None running. Train one at the Forge."}
        </p>
      ) : (
        <ul className="keep-yours-list">
          {yours.map((actor) => (
            <li key={actor.id}>
              <button type="button" className="keep-yours-row" onClick={() => onFollow(actor.id)}>
                <span className={`keep-yours-dot is-${actor.work}`} aria-hidden="true" />
                <span className="keep-yours-name">{actor.name}</span>
                <span className="keep-yours-work">{doing(actor)}</span>
                <Opens />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Hud({
  standing,
  marks,
  elixir,
  gathering,
  characterClass,
  wrights,
  demo,
  counted,
  sessionTotal,
  dataState,
  strength,
  real,
  compact,
  onOpenRoster,
  onOpenGathering,
  onOpenShop,
  shopOpen,
  youUid,
  onFollow,
  pause,
}: HudProps) {
  const lore = CLASS_LORE[characterClass] ?? CLASS_LORE.terminal;
  const unlock = nextUnlock(standing.level);
  const { fixing, building, waiting } = sessionBreakdown(wrights);

  /*
   * Corners rather than a bar, and each corner one kind of thing.
   *
   * Top left is the player: their standing and their own sessions. Top right
   * is what they have: marks and elixir, beside the pause button. The right
   * edge is the pedlar. Bottom right is the kingdom -- everybody's sessions,
   * whether the line holds, and the road book. Bottom left is the zoom, which
   * GameRoute places.
   */
  return (
    <>
      <div className="keep-corner is-top-left">
        <div className="keep-panel keep-standing">
          <div className="keep-standing-head">
            <span className="keep-crest" aria-hidden="true">
              <span className="keep-crest-letter">{lore.title.slice(0, 1)}</span>
            </span>
            <span className="keep-standing-text">
              <span className="keep-standing-class">{lore.title}</span>
              <span className="keep-standing-level">Level {standing.level}</span>
            </span>
          </div>
          <Meter
            label="Experience"
            value={standing.into}
            of={standing.needed}
            tone="xp"
            detail={
              compact
                ? undefined
                : counted
                  ? unlock
                    ? `${unlock.name} at level ${unlock.level}`
                    : "Nothing left to unlock"
                  : "An example standing — the service did not answer"
            }
          />
          <div className="keep-standing-divider" />
          <YourSessions wrights={wrights} youUid={youUid} demo={demo} onFollow={onFollow} />
        </div>
      </div>

      {/*
        * What the player has, beside the pause button GameRoute puts in the
        * same corner. The purse is a read-out; the vial is a way in, because a
        * figure that stands for money somebody's machine has spent should be
        * one press from the account of what spent it.
        */}
      <div className="keep-corner is-top-right keep-wealth">
        <div className="keep-panel keep-purse" title={`${marks.toLocaleString()} ${WORLD.coin}`}>
          <span className="keep-coin" aria-hidden="true">◈</span>
          <span className="keep-purse-text">
            <span className="keep-purse-value">{marks.toLocaleString()}</span>
            <span className="keep-purse-label">{WORLD.coin}</span>
          </span>
        </div>
        <button
          type="button"
          className="keep-panel keep-elixir-panel"
          onClick={onOpenGathering}
          title={gathering ? "What the gathering has cost" : "Nothing is being read. What this is"}
        >
          <Elixir tokens={elixir} gathering={gathering} />
          <Opens />
        </button>
        {pause}
      </div>

      {/*
        * The pedlar, on its own on the right edge, where a stall stands at the
        * side of a road rather than in the middle of it.
        */}
      <div className="keep-corner is-right">
        <button
          type="button"
          className="keep-panel keep-shop-button"
          onClick={onOpenShop}
          disabled={!shopOpen}
          title={shopOpen ? "The pedlar" : "The pedlar calls from level 2"}
        >
          <span className="keep-shop-glyph" aria-hidden="true">⚖</span>
          <span className="keep-shop-text">
            <span className="keep-shop-label">Pedlar</span>
            {!compact && (
              <span className="keep-shop-detail">{shopOpen ? "Cosmetics" : "Level 2"}</span>
            )}
          </span>
          {shopOpen && <Opens />}
        </button>
      </div>

      {/*
        * The kingdom and the road book together: how many are out, what they
        * are doing, whether the line holds -- and the way to go and look.
        */}
      <div className="keep-corner is-bottom-right">
        <div className="keep-panel keep-kingdom">
          <button type="button" className="keep-kingdom-open" onClick={onOpenRoster}>
            <span className="keep-operational-value">{sessionTotal.toLocaleString()}</span>
            <span className="keep-kingdom-title">
              <span className="keep-operational-label">
                {demo ? "example sessions" : sessionTotal === 1 ? "active session" : "active sessions"}
              </span>
              <span className="keep-kingdom-map">{demo ? "Example map" : "Session map"}</span>
            </span>
            <Opens />
          </button>
          {!compact && (
            <>
              {/*
                * Counts with words, not two coloured dots. The same information
                * has to survive a screenshot and a palette somebody cannot
                * separate.
                */}
              <p className="keep-operational-breakdown">
                {fixing} fixing · {building} building · {waiting} waiting
              </p>
              <Muster strength={strength} real={real} />
              <span className={`keep-data-state${demo ? " is-preview" : " is-live"}`}>
                {dataState}
              </span>
            </>
          )}
        </div>
      </div>
    </>
  );
}

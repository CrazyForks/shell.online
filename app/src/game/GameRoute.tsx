import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePageTitle } from "../lib/page-title";
import { request } from "../lib/api";
import { useAuth } from "../auth/AuthProvider";
import { PixiStage } from "./pixi/PixiStage";
import { buildKeepScene, createSim, type KeepHandle } from "./pixi/keepScene";
import { WrightPanel } from "./ui/WrightPanel";
import type { Actor } from "./world/sim";
import { useInputDevice } from "./engine/use-input-device";
import { useGamepadActions } from "./engine/use-gamepad";
import { KEEP_TITLE, SHELL_KEEP_MARKER } from "./keep";
import { GameShellContext, type GameShell } from "./state/context";
import { motionReduced, optionsToStyle, readOptions, writeOptions, type GameOptions } from "./state/options";
import { DEMO_EARNED, DEMO_ROSTER } from "./state/demo-garrison";
import { useGarrison } from "./state/use-garrison";
import { buy, skinById, tintFor } from "./state/shop";
import { experienceFrom, marksEarnedTo, standing } from "./state/progress";
import { useEarned } from "./state/use-earned";
import { hasChosen, marksLeft, readSave, writeSave, type Save } from "./state/save";
import { loadSave, reconcile, storeSave } from "./state/remote";
import { ChooseCharacter } from "./ui/ChooseCharacter";
import { BloodVeil } from "./ui/BloodVeil";
import { Hud } from "./ui/Hud";
import { McpFlows } from "./ui/McpFlows";
import { AssessPanel } from "./ui/AssessPanel";
import { useExpiringMcpFlows } from "./state/mcp-flows";
import { assessmentsForAccount, observedTargets, withLocalConsent } from "./state/assessments";
import { ASSESS_ACTIONS_IDLE, assessStateForAccount, createAssessActions, type AssessActionsState } from "./state/assess-actions";
import { ZoomControls } from "./ui/ZoomControls";
import { useLayout } from "./state/use-layout";
import { isCompact } from "./state/layout";
import { kingdomStrength } from "./world/kingdom";
import { ZOOM_STEP } from "./engine/zoom";
import { PauseMenu } from "./ui/PauseMenu";
import { KeepSheet } from "./ui/KeepSheet";
import { Shop } from "./ui/Shop";
import { Marches } from "./ui/Marches";
import { Gathering } from "./ui/Gathering";
import { Training } from "./ui/Training";
import { Prompt } from "./ui/Prompt";
import "../styles/game.css";

/**
 * The keep.
 *
 * This module is the only thing `App.tsx` knows about the game, and it is
 * reached through a dynamic import, so none of it -- not the engine, not the
 * sprites, not this stylesheet -- is in the bundle somebody gets when they
 * open the session list. `scripts/check-bundle.mjs` fails the build if that
 * ever stops being true.
 *
 * What it owns is the frame around the game: the options that decide whether
 * the thing is legible on this screen, which device is in the player's hands,
 * and whether the simulation is running. The field itself is drawn by scenes
 * mounted inside it.
 */
export default function GameRoute() {
  usePageTitle(KEEP_TITLE);
  const navigate = useNavigate();

  const [options, setOptionsState] = useState<GameOptions>(readOptions);
  /* Who you are, what you are wearing, and what you have bought. */
  const [save, setSaveState] = useState<Save>(readSave);
  const [paused, setPaused] = useState(false);
  const device = useInputDevice();
  /*
   * Which shape of screen this is, watched rather than read once. A handset
   * turned on its side is a different interface, and the one that arrived at
   * the old answer and never revisited it is the one that was full size on a
   * phone in landscape.
   */
  const layout = useLayout();
  const compact = isCompact(layout);

  /*
   * Whether the zoom controls have anywhere left to go.
   *
   * Kept in state because it is two booleans that change when somebody stops
   * pinching, not sixty times a second -- and a control that says it is at the
   * limit when it is not is worse than no control.
   */
  const [zoomAt, setZoomAt] = useState({ out: false, in: false });

  /*
   * The OS setting is watched rather than read once. Somebody who turns
   * "reduce motion" on because the game is making them ill should not have to
   * reload the game to get the benefit of it.
   */
  const [systemReduced, setSystemReduced] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const onChange = (event: MediaQueryListEvent) => setSystemReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const setOptions = useCallback((next: GameOptions) => {
    setOptionsState(next);
    writeOptions(next);
  }, []);

  /*
   * Saved on every change rather than on a timer or on the way out. The game
   * is a browser tab: it is closed, not exited, and a save that waits for a
   * clean shutdown is a save that is sometimes lost.
   */
  const setSave = useCallback((next: Save) => {
    setSaveState(next);
    writeSave(next);
    /*
     * Sent up as well, and not waited for. A purchase should land the instant
     * it is made; whether the service also heard about it is not something the
     * player should be made to watch a spinner for.
     */
    void storeSave(next);
  }, []);

  /* Tokens the gathering has cost, which only the service knows. */
  const [elixir, setElixir] = useState(0);

  /*
   * On arrival, the service's copy is merged with this browser's.
   *
   * Merged rather than replaced, and merged by what cannot go backwards: a
   * class once chosen, skins once bought, marks once spent. Taking whichever
   * was written most recently would let a tab somebody opened on a borrowed
   * laptop and abandoned overwrite months of progress.
   */
  useEffect(() => {
    let live = true;
    void loadSave().then((remote) => {
      if (!live || !remote) return;
      setElixir(remote.tokens);
      setSaveState((current) => {
        const merged = reconcile(current, remote.save);
        writeSave(merged);
        return merged;
      });
    });
    return () => {
      live = false;
    };
  }, []);

  const reducedMotion = motionReduced(options, systemReduced);

  /*
   * Told to the scene as well as to the stylesheet. The canvas is not styled by
   * CSS, so without this the setting stopped at the edge of it.
   *
   * Also kept in a ref, because the scene is built asynchronously: this effect
   * runs against the placeholder handle long before `buildKeepScene` has
   * replaced it, so arriving with reduced motion already on would otherwise
   * open a map full of drifting particles and never be corrected.
   */
  const motionWanted = useRef(reducedMotion);
  motionWanted.current = reducedMotion;
  useEffect(() => {
    handle.current.still(reducedMotion);
  }, [reducedMotion]);

  /*
   * What the garrison has done, read off the world a few times a second rather
   * than every frame.
   *
   * The world changes thirty times a second and the HUD has four numbers on
   * it; re-rendering React at frame rate to move a progress bar by a pixel is
   * the sort of thing that makes a game feel heavy for no reason anybody can
   * see. Twice a second is faster than anyone reads.
   */
  const [tally, setTally] = useState({ felled: 0, raised: 0, wrights: [] as Actor[] });
  useEffect(() => {
    const timer = window.setInterval(() => {
      setTally({
        felled: sim.current.felled,
        raised: sim.current.raised,
        /* Only the wrights that stand for real sessions are counted. */
        wrights: sim.current.actors.filter((actor) => actor.session !== undefined),
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  /*
   * Experience from work that actually happened, counted by the service.
   *
   * It used to be fed the field's own tally of faults put down, which meant a
   * tab left open overnight levelled you up -- the exact thing progress.ts
   * promises at the top of the file that nothing here does. The simulation is
   * spectacle now and earns nothing; what earns is a session that finished.
   */
  const { earned: counted, known } = useEarned();
  /*
   * The example team's example history, when the field is showing the example
   * team. Labelled as an example everywhere it appears -- and it is what makes
   * the shop, the Barrow and levelling reachable at all without a working
   * service and a week of sessions behind you.
   */
  const earned = known ? counted : DEMO_EARNED;
  const rank = standing(experienceFrom(earned));

  /* Earned by levelling, less what has been spent with the pedlar. */
  const purse = {
    marks: marksLeft(marksEarnedTo(rank.level), save),
    owned: save.owned,
  };

  /*
   * The simulation, in a ref rather than in state.
   *
   * It changes thirty times a second; putting it in state would re-render the
   * whole route at that rate to redraw a canvas React does not manage anyway.
   * The loop mutates it and the renderer reads it, and React is told only when
   * something it actually draws in the DOM changes.
   */
  const sim = useRef(createSim());
  /* The one clicked wright, which is the only game state React needs. */
  const [picked, setPicked] = useState<Actor | undefined>();
  /*
   * Which pane is open straight off the field, if any. The pedlar, the road
   * book and the gathering are each opened by the HUD element that shows them,
   * without going through the pause menu. The field keeps running behind them.
   */
  const [sheet, setSheet] = useState<"shop" | "marches" | "gathering" | "train" | undefined>();
  /*
   * The name of a soldier ordered at the Forge and not yet on the field, so the
   * Forge's button can say so. Cleared when it arrives, or when the machine has
   * taken long enough that the beacon stops claiming anything.
   */
  const [recruit, setRecruit] = useState("");
  const recruitTimer = useRef(0);

  const handle = useRef<KeepHandle>({
    sim: sim.current,
    select: () => {},
    lookAt: () => {},
    follow: () => {},
    train: () => {},
    cancelTraining: () => {},
    wear: () => {},
    still: () => {},
    zoomBy: () => {},
    fit: () => {},
  });
  handle.current.onPick = setPicked;
  /*
   * The Forge's button follows the Forge across the screen. Positioned from the
   * scene every frame, so it is written to the element rather than to state.
   */
  const forgeRef = useRef<HTMLButtonElement>(null);
  handle.current.onForge = (at) => {
    const button = forgeRef.current;
    if (!button) return;
    if (!at) {
      button.style.visibility = "hidden";
      return;
    }
    button.style.visibility = "visible";
    button.style.transform =
      `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-50%, -50%) scale(${at.scale.toFixed(3)})`;
  };
  handle.current.onTrained = (actorId) => {
    window.clearTimeout(recruitTimer.current);
    setRecruit("");
    /* Go and meet them: the arrival is drawn where they stand. */
    handle.current.follow(actorId);
  };
  handle.current.onZoom = (at) =>
    setZoomAt((current) =>
      current.out === at.out && current.in === at.in ? current : { out: at.out, in: at.in },
    );
  /*
   * The scene still tells us whether the selected figure is visible, but the
   * card itself stays against the edge of the window. A moving information
   * panel was harder to read, covered a different piece of the map every
   * frame, and became a bottom-sheet-sized obstruction on a phone.
   */
  const cardRef = useRef<HTMLElement>(null);
  handle.current.onTrack = (at) => {
    const card = cardRef.current;
    if (!card) return;
    if (!at) {
      card.style.visibility = "hidden";
      return;
    }
    card.style.visibility = "visible";
  };

  /*
   * Who is on the field: the account's live sessions, polled, with the
   * stand-in garrison when there are none or the service cannot be reached.
   */
  const garrison = useGarrison(sim.current, DEMO_ROSTER, save.characterClass);
  /*
   * The panel empties on its own clock. A fetch that never returns must not
   * leave stale arrows on the field or stale rows in the panel.
   */
  const mcpFlows = useExpiringMcpFlows(garrison.demo ? [] : garrison.flows);
  const assessTargets = observedTargets(mcpFlows);
  const authUid = useAuth().user?.uid ?? "";
  /*
   * The feed is only ever the signed-in account's, and a withdrawal clears it
   * immediately rather than at the next poll. Both guards are pure and tested;
   * the panel cannot render another account's rows or a revoked feed.
   *
   * The action callbacks cross an await, so they are owned by an
   * account-scoped controller: a switch bumps its generation, clears the
   * transient state and discards any response that belonged to the account
   * that just left.
   */
  const [assessActionsState, setAssessActionsState] = useState<AssessActionsState>(ASSESS_ACTIONS_IDLE);
  const assessActions = useMemo(
    () => createAssessActions({ request: (path, init) => request(path, init), onChange: setAssessActionsState }),
    [],
  );
  /* The ref is the current account at event time; the effect below moves the
     controller to it. Until then, neither the rendered state nor a click may
     borrow the new account's auth. */
  const authUidRef = useRef(authUid);
  useEffect(() => {
    authUidRef.current = authUid;
    assessActions.setAccount(authUid);
  }, [assessActions, authUid]);
  /* Render gate: before the effect reset, a uid mismatch serves idle state. */
  const assessView = assessStateForAccount(assessActionsState, authUid);
  const localConsent = assessView.localConsent;
  const assessmentFeed = useMemo(() => {
    const base = assessmentsForAccount(garrison.assessments, garrison.uid, authUid);
    if (!localConsent || base.consentUpdatedAt >= localConsent.updatedAt) return base;
    return withLocalConsent(base, localConsent.enabled, localConsent.updatedAt);
  }, [garrison.assessments, garrison.uid, authUid, localConsent]);
  /* Consent and assessment requests go through the same authenticated client
     as everything else. The feed refreshes on the existing garrison poll. */
  const onAssessConsent = useCallback((enabled: boolean) => {
    /* A callback rendered for a previous account is dropped rather than
       dispatched under the new account's auth; an equal uid is synchronized
       before dispatch so results land in the generation that is current. */
    if (authUid === "" || authUid !== authUidRef.current) return;
    assessActions.setAccount(authUid);
    void assessActions.consent(enabled);
  }, [assessActions, authUid]);
  const onAssess = useCallback((sessionId: string, observed: { flows: number }) => {
    if (authUid === "" || authUid !== authUidRef.current) return;
    assessActions.setAccount(authUid);
    void assessActions.assess(sessionId, observed);
  }, [assessActions, authUid]);
  handle.current.mcpFlows = () => mcpFlows;

  /*
   * Whether the kingdom has the sessions to meet what is coming for it.
   *
   * From the team's own totals, not from the figures on the field. Two
   * reasons, and they pull in opposite directions from the same rule -- that
   * this is a read-out of real work:
   *
   * The field is capped and the read-out is not, so a team of sixty holding
   * its ground must not be told it is losing because the drawing budget ran
   * out before their soldiers did.
   *
   * And the field shows the *example* team when an account has nothing
   * running, which is the one case where somebody most needs to be told their
   * kingdom is short. Reading the strain off the example would tell a person
   * with nothing open that everything is fine.
   *
   * When the service could not be reached at all there is no answer, and the
   * kingdom is left alone rather than accused.
   */
  const strength = kingdomStrength(garrison.team ?? { heroes: 0, soldiers: 0 });

  /*
   * The game takes the window. The corporate shell scrolls; a field that
   * scrolls underneath a fixed HUD is a field somebody loses their heroes off
   * the bottom of, so the body is held still for as long as this is mounted.
   */
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    /*
     * And the page is not allowed to answer a gesture meant for the map.
     *
     * `overflow: hidden` on the body does not stop a touch scroll in Safari,
     * and nothing at all stops Safari's own pinch-to-zoom of the whole page
     * except refusing its gesture events -- `user-scalable=no` has been
     * ignored for years. On a phone held sideways the page is taller than the
     * screen it is shown in, so a drag or a pinch that started anywhere the
     * canvas did not catch it scrolled or zoomed the page instead, and the map
     * sat still underneath: "scrolling and zooming are blocked".
     *
     * Only inside the keep, and only multi-finger moves: a single finger still
     * scrolls the lists and panes that are meant to scroll.
     */
    const root = document.documentElement;
    const previousOverscroll = root.style.overscrollBehavior;
    root.style.overscrollBehavior = "none";
    const refuse = (event: Event) => event.preventDefault();
    const pinchInside = (event: TouchEvent) => {
      if (event.touches.length > 1 && event.target instanceof Element && event.target.closest(".keep")) {
        event.preventDefault();
      }
    };
    document.addEventListener("gesturestart", refuse, { passive: false });
    document.addEventListener("gesturechange", refuse, { passive: false });
    document.addEventListener("touchmove", pinchInside, { passive: false });
    return () => {
      document.body.style.overflow = previous;
      root.style.overscrollBehavior = previousOverscroll;
      document.removeEventListener("gesturestart", refuse);
      document.removeEventListener("gesturechange", refuse);
      document.removeEventListener("touchmove", pinchInside);
    };
  }, []);

  /* Escape pauses, and pauses again out of whatever the pause menu opened. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || paused || sheet) return;
      event.preventDefault();
      setPaused(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [paused, sheet]);

  /*
   * Start on the pad opens the pause menu. Only while play is running: the
   * menu handles its own input once it is up, and two listeners fighting over
   * the same button is a menu that opens and closes on one press.
   */
  useGamepadActions(
    useCallback((action) => {
      if (action === "pause") setPaused(true);
    }, []),
    !paused && !sheet,
  );

  /*
   * Buying and wearing, which the pedlar's sheet calls.
   *
   * What is stored is the spend, not the purse. The purse is derived from the
   * level that earned it, so storing both would be two facts that can disagree.
   * A first purchase in a slot is worn at once, because nobody buys a colour in
   * order to not wear it.
   */
  const onBuy = (skinId: string) => {
    const result = buy(purse, skinId);
    if (!result.ok) return;
    const bought = skinById(skinId);
    const next = {
      ...save,
      spent: save.spent + (purse.marks - result.purse.marks),
      owned: result.purse.owned,
      skinId: bought?.wears === "hero" ? save.skinId || skinId : save.skinId,
      liveryId: bought?.wears === "retinue" ? save.liveryId || skinId : save.liveryId,
    };
    setSave(next);
    handle.current.wear(tintFor(next.skinId), tintFor(next.liveryId));
  };
  const onWear = (skinId: string) => {
    const chosen = skinById(skinId);
    const next = chosen?.wears === "retinue" ? { ...save, liveryId: skinId } : { ...save, skinId };
    setSave(next);
    /* The field shows it at once, rather than on the next reload. */
    handle.current.wear(tintFor(next.skinId), tintFor(next.liveryId));
  };

  const shell = useMemo<GameShell>(
    () => ({ options, setOptions, reducedMotion, device, paused, setPaused }),
    [options, setOptions, reducedMotion, device, paused],
  );

  const style = optionsToStyle(options, systemReduced, layout) as React.CSSProperties;

  return (
    <GameShellContext.Provider value={shell}>
      <div
        className="keep"
        /*
         * The marker the bundle check looks for. On the DOM rather than in a
         * dead constant, because a marker a minifier can drop would make that
         * check pass by being absent for the wrong reason.
         */
        data-keep={SHELL_KEEP_MARKER}
        data-motion={reducedMotion ? "reduced" : "full"}
        data-colour={options.colour}
        /*
         * The shape of the screen, for the stylesheet.
         *
         * A media query cannot ask the question this answers: a handset in
         * landscape is 844 pixels across and sails past every `width <= 640px`
         * rule in the file. See state/layout.ts.
         */
        data-layout={layout}
        /*
         * Whether the card over a figure is up, so the zoom controls can step
         * out from under it. The card is a modal layer pinned to the same edge
         * they are, and inspecting anything used to cover the only visible way
         * to zoom out.
         */
        data-card={picked ? "open" : "closed"}
        style={style}
      >
        {/*
          * The field fills the window, edge to edge and under everything else.
          * There is no title over it: the game is the picture, and a wordmark
          * across the top of it is a browser tab's job.
          */}
        <main className="keep-field">
          <PixiStage
            label="The Marches: garrisons spread over open country, seen from above and tilted"
            paused={paused}
            build={async (app, viewport) => {
              const scene = await buildKeepScene(app, viewport, handle.current);
              handle.current.still(motionWanted.current);
              return scene;
            }}
          />
        </main>

        {/*
          * The kingdom struggling, laid over the field and under the HUD.
          *
          * Under, so that the words explaining it stay legible through it --
          * a signal that obscures its own explanation is a signal that only
          * worries people.
          */}
        <BloodVeil strength={strength} />

        {/*
          * Everything that must survive a television sits inside this, laid
          * over the field rather than beside it. The picture may bleed into
          * the crop; the things you need to read may not.
          */}
        <div className="keep-safe">
          {!paused && <McpFlows flows={mcpFlows} actors={tally.wrights} />}
          {!paused && (
            <AssessPanel
              feed={assessmentFeed}
              targets={assessTargets}
              busy={assessView.busy}
              error={assessView.error}
              now={Date.now()}
              onConsent={onAssessConsent}
              onAssess={onAssess}
            />
          )}
          <Hud
            standing={rank}
            marks={purse.marks}
            elixir={elixir}
            gathering={save.gathering}
            characterClass={save.characterClass || "terminal"}
            wrights={tally.wrights}
            demo={garrison.demo}
            counted={known}
            sessionTotal={garrison.soldiers}
            strength={strength}
            /* Whether the numbers behind it are this account's or an example. */
            real={garrison.team !== undefined}
            compact={compact}
            dataState={
              garrison.loading
                ? "Updating sessions"
                : garrison.demo
                  ? garrison.error
                    ? "Preview — sessions unavailable"
                    : "Preview — no active sessions"
                  : "Live team sessions"
            }
            onOpenGathering={() => setSheet("gathering")}
            onOpenRoster={() => setSheet("marches")}
            onOpenShop={() => setSheet("shop")}
            shopOpen={rank.level >= 2}
            youUid={sim.current.youUid}
            onFollow={(id) => handle.current.follow(id)}
            pause={
              <button
                type="button"
                className="keep-button keep-pause-button"
                /*
                 * Named here as well as written on, because a handset drops the
                 * word to keep the button inside a corner it has to share with
                 * the map -- and a control whose name is only its visible text
                 * is a control that loses its name when the text goes.
                 */
                aria-label="Pause"
                onClick={() => setPaused(true)}
              >
                <span aria-hidden="true">❙❙</span>
                {/*
                  * The word is a separate node so a handset can drop it and keep
                  * the button, the hit area and the accessible name.
                  */}
                <span className="keep-button-word">Pause</span>
              </button>
            }
          />

          {/*
            * The Forge's training yard, standing on the map at the Forge.
            *
            * A button over the canvas rather than something drawn in it,
            * because it has to be focusable, named, and hit reliably by a
            * thumb -- three things a canvas is bad at. It is moved to the
            * Forge every frame by the scene; see `onForge` above.
            */}
          {!paused && (
            <button
              type="button"
              ref={forgeRef}
              className={`keep-forge-train${recruit ? " is-training" : ""}`}
              style={{ visibility: "hidden" }}
              onClick={() => setSheet("train")}
              aria-label={recruit ? `Training ${recruit}. Train another soldier` : "Train a soldier at the Forge"}
            >
              <span className="keep-forge-train-glyph" aria-hidden="true">⚒</span>
              <span className="keep-forge-train-text">
                <span className="keep-forge-train-label">{recruit ? "Training…" : "Train soldiers"}</span>
                {recruit && <span className="keep-forge-train-detail">{recruit}</span>}
              </span>
            </button>
          )}

          {/*
            * The way out of the map, for a screen with no wheel on it.
            *
            * Shown to everybody rather than to touch alone: a visible control
            * costs a mouse nothing and it is the only thing on screen that
            * says the map can be pulled back at all.
            */}
          <div className="keep-corner is-bottom-left">
            <ZoomControls
              onZoomIn={() => handle.current.zoomBy(ZOOM_STEP)}
              onZoomOut={() => handle.current.zoomBy(1 / ZOOM_STEP)}
              onFit={() => handle.current.fit()}
              atOut={zoomAt.out}
              atIn={zoomAt.in}
            />
          </div>

          {/*
            * The key prompt goes on a handset. It names a key that phone does
            * not have, and it is one more thing across the foot of a screen
            * that has none to spare; the pause button beside it does the same
            * job and can be hit.
            */}
          {!compact && (
            <div className="keep-corner is-bottom-centre">
              <Prompt action="pause" verb="open the menu" />
            </div>
          )}
        </div>

        {picked && (
          <WrightPanel
            cardRef={cardRef}
            actor={picked}
            field={sim.current.actors}
            now={Date.now()}
            onClose={() => {
              setPicked(undefined);
              handle.current.select(undefined);
            }}
            onOpenSession={(sessionId) => navigate(`/sessions/${sessionId}`)}
          />
        )}

        {paused && (
          <PauseMenu
            onResume={() => {
              setPaused(false);
            }}
            purse={purse}
            characterClass={save.characterClass || "terminal"}
            elixir={elixir}
            garrison={tally.wrights.length}
            gathering={save.gathering}
            earned={earned}
            counted={known}
            onGathering={(on) => setSave({ ...save, gathering: on })}
          />
        )}

        {sheet === "shop" && (
          <KeepSheet title="The pedlar" onClose={() => setSheet(undefined)}>
            <Shop
              purse={purse}
              characterClass={save.characterClass || "terminal"}
              wearing={save.skinId}
              livery={save.liveryId}
              onBuy={onBuy}
              onWear={onWear}
              onBack={() => setSheet(undefined)}
            />
          </KeepSheet>
        )}
        {sheet === "marches" && (
          <KeepSheet title="The Marches" onClose={() => setSheet(undefined)}>
            <Marches
              onTravel={(id) => {
                handle.current.lookAt(id);
                setSheet(undefined);
              }}
              onBack={() => setSheet(undefined)}
            />
          </KeepSheet>
        )}
        {sheet === "train" && (
          <KeepSheet title="The Forge — train a soldier" onClose={() => setSheet(undefined)}>
            <Training
              onTrained={(name) => {
                setSheet(undefined);
                setRecruit(name);
                handle.current.train();
                /* Ride to the Forge, so the order is seen being carried out. */
                handle.current.lookAt("forge");
                window.clearTimeout(recruitTimer.current);
                recruitTimer.current = window.setTimeout(() => {
                  setRecruit("");
                  handle.current.cancelTraining();
                }, 90_000);
              }}
              onBack={() => setSheet(undefined)}
            />
          </KeepSheet>
        )}
        {sheet === "gathering" && (
          <KeepSheet title="The gathering" onClose={() => setSheet(undefined)}>
            <Gathering
              on={save.gathering}
              tokens={elixir}
              onAgree={() => setSave({ ...save, gathering: true })}
              onStop={() => setSave({ ...save, gathering: false })}
              onBack={() => setSheet(undefined)}
            />
          </KeepSheet>
        )}

        {/*
          * The one decision the game asks for, over the top of everything.
          * Shown until it has been made; the field carries on behind it.
          */}
        {!hasChosen(save) && (
          <ChooseCharacter
            onChoose={(characterClass) => setSave({ ...save, characterClass })}
          />
        )}
      </div>
    </GameShellContext.Provider>
  );
}

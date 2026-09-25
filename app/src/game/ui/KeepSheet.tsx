import { useLayoutEffect, useRef, type ReactNode } from "react";
import { dialogControls, trapDialogTab } from "../engine/dialog-focus";
import { useGamepadActions } from "../engine/use-gamepad";
import { Prompt } from "./Prompt";

/**
 * A pane opened straight from the field: the pedlar, the road book, the
 * gathering.
 *
 * These used to be reached only through the pause menu, which made buying a
 * colour or riding to a holding a three-step errand through a screen whose job
 * is to stop the game. Now the HUD element that shows the thing opens it, and
 * this is the frame it opens in -- the same native modal the pause menu uses,
 * so the field stays inert behind it, Tab stays inside it, Escape and the pad's
 * back button close it, and focus returns to the HUD control that opened it.
 */
export function KeepSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    dialogControls(panel.current)[0]?.focus();
    return () => element?.close();
  }, []);

  /* The pad walks the controls the way it does in the pause menu's panes. */
  useGamepadActions((action) => {
    if (action === "cancel" || action === "pause") {
      onClose();
      return;
    }
    const controls = dialogControls(panel.current);
    if (controls.length === 0) return;
    const current = controls.indexOf(document.activeElement as HTMLElement);
    if (action === "up" || action === "down") {
      const direction = action === "up" ? -1 : 1;
      const next = current < 0 ? 0 : (current + direction + controls.length) % controls.length;
      controls[next]?.focus();
    } else if (action === "confirm") {
      controls[Math.max(0, current)]?.click();
    }
  });

  return (
    <dialog
      className="keep-pause keep-sheet"
      ref={dialog}
      aria-label={title}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onClose();
      }}
      onKeyDownCapture={(event) => {
        trapDialogTab(event);
        if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      /* Nothing typed in here reaches the field's own Escape-to-pause. */
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <div className="keep-pause-panel keep-panel keep-panel-heavy is-wide" ref={panel}>
        <header className="keep-pause-head">
          <h2>{title}</h2>
          <button type="button" className="keep-button keep-sheet-close" aria-label="Close" onClick={onClose}>
            <span aria-hidden="true">✕</span>
          </button>
        </header>
        {children}
        <footer className="keep-pause-foot">
          <Prompt action="cancel" verb="close" />
        </footer>
      </div>
    </dialog>
  );
}

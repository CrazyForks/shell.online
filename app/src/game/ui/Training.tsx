import { useEffect, useState, type FormEvent } from "react";
import { fetchDevices, startSession, type Device } from "../../lib/api";
import { machineOnline } from "../../lib/agent";
import { harnessMissing } from "../../lib/harnesses";
import { generatePassword, sealPassword } from "../../lib/seal";
import { rememberForOrigin } from "../../lib/session-passwords";
import { SESSION_KINDS, sessionName, type FieldValues } from "../../lib/session-kinds";

/**
 * The Forge's training yard: starting a session from the field.
 *
 * This is the product's own "new session", in armour. It asks the same three
 * things the session list does -- which machine, which kind, what to call it --
 * and does the same thing with the answers: a password is chosen here, sealed
 * to the machine's key so the service cannot read it, remembered in this
 * browser for the session that will appear, and the start is queued for the
 * machine's agent to pick up. Nothing about how a session starts is different
 * because it was started from a game.
 *
 * Written plainly where it matters, like the gathering notice: which machine
 * will run what is a fact somebody should be able to read without decoding.
 * Colleagues are not offered here; a session trained at the Forge is sealed to
 * nobody but its owner, and can be shared from the session list afterwards.
 */
export function Training({
  onTrained,
  onBack,
}: {
  /** The order is queued. The field shows it arriving; see pixi/training.ts. */
  onTrained: (name: string) => void;
  onBack: () => void;
}) {
  const [devices, setDevices] = useState<Device[] | undefined>();
  const [machine, setMachine] = useState("");
  const [kindId, setKindId] = useState(SESSION_KINDS[0].id);
  const [command, setCommand] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    void fetchDevices()
      .then((reply) => {
        if (!live) return;
        setDevices(reply.devices);
        const ready = reply.devices.find((device) => machineOnline(device) && device.agentPublicKey);
        setMachine((current) => current || ready?.id || "");
      })
      .catch(() => live && setDevices([]));
    return () => {
      live = false;
    };
  }, []);

  /* A machine that is not listening, or cannot be sealed to, cannot train anybody. */
  const ready = (devices ?? []).filter((device) => machineOnline(device) && device.agentPublicKey);
  const device = ready.find((candidate) => candidate.id === machine);
  const kinds = SESSION_KINDS.filter((kind) => !harnessMissing(kind.id, device));
  const kind = kinds.find((candidate) => candidate.id === kindId) ?? kinds[0];
  const values: FieldValues = kind?.id === "terminal" ? { command, name } : { name };
  const built = kind ? kind.build(values) : "";

  async function train(event: FormEvent) {
    event.preventDefault();
    if (!device?.agentPublicKey || !kind || !built) return;
    setBusy(true);
    setError("");
    try {
      const password = generatePassword();
      const sealed = await sealPassword(device.agentPublicKey, password);
      const title = sessionName(values, built);
      const queued = await startSession({ deviceId: device.id, command: built, name: title, ...sealed });
      rememberForOrigin(queued.command.id, password);
      onTrained(title);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The machine could not be asked.");
      setBusy(false);
    }
  }

  if (devices === undefined) {
    return <p className="keep-train-note" role="status">Asking which machines are listening…</p>;
  }

  if (ready.length === 0) {
    return (
      <div className="keep-train">
        <p className="keep-train-note" role="status">
          No machine is listening. Sign in on one with <code>shell auth</code> and leave{" "}
          <code>shell agent</code> running, and it can train soldiers from here.
        </p>
        <button type="button" className="keep-button" onClick={onBack}>
          Back
        </button>
      </div>
    );
  }

  return (
    <form className="keep-train" onSubmit={train}>
      <fieldset className="keep-option-group">
        <legend>Which machine</legend>
        <select
          className="keep-train-select"
          value={machine}
          onChange={(event) => setMachine(event.target.value)}
          aria-label="Machine"
        >
          {ready.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </select>
      </fieldset>

      <fieldset className="keep-option-group">
        <legend>What kind of soldier</legend>
        <div className="keep-train-kinds">
          {kinds.map((candidate) => (
            <label key={candidate.id} className="keep-train-kind">
              <input
                type="radio"
                name="keep-train-kind"
                value={candidate.id}
                checked={candidate.id === kind?.id}
                onChange={() => setKindId(candidate.id)}
              />
              <span className="keep-train-kind-text">
                <span className="keep-train-kind-title">{candidate.title}</span>
                <span className="keep-train-kind-blurb">{candidate.blurb}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {kind?.id === "terminal" && (
        <label className="keep-train-field">
          <span>Command</span>
          <input
            type="text"
            value={command}
            placeholder="npm run dev"
            onChange={(event) => setCommand(event.target.value)}
          />
        </label>
      )}

      <label className="keep-train-field">
        <span>Name</span>
        <input
          type="text"
          value={name}
          placeholder={built || "optional"}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      {built && device && (
        <p className="keep-train-note">
          Starts <code>{built}</code> on {device.label}. It joins the field when the machine has
          started it.
        </p>
      )}
      {error && (
        <p className="keep-train-error" role="alert">
          {error}
        </p>
      )}

      <div className="keep-train-buttons">
        <button type="submit" className="keep-button keep-train-go" disabled={busy || !built}>
          {busy ? "Sending the order…" : "Train"}
        </button>
        <button type="button" className="keep-button" onClick={onBack}>
          Back
        </button>
      </div>
    </form>
  );
}

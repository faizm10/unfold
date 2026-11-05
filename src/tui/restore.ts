// Puts the terminal back the way we found it, even if Unfold crashes or is killed.
// Anything that changes terminal state (raw mode, scroll region, alternate screen)
// registers an undo here and removes it once it has cleaned up normally.

const undos = new Set<() => void>();
let installed = false;

function restoreAll(): void {
  for (const undo of [...undos].reverse()) {
    try {
      undo();
    } catch {
      // keep restoring the rest
    }
  }
  undos.clear();
}

/** Registers an undo; call the returned function after cleaning up normally. */
export function onRestore(undo: () => void): () => void {
  if (!installed) {
    installed = true;
    process.on('exit', restoreAll);
  }
  undos.add(undo);
  return () => undos.delete(undo);
}

/** Restores the terminal now (used before printing a crash report). */
export function restoreTerminal(): void {
  restoreAll();
}

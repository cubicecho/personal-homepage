import {
  EDIT_MODE_STORAGE_KEY,
  type EditModeStorage,
  effectiveEditing,
  readStoredEditing,
  writeStoredEditing,
} from '../../../web/src/shell/edit-mode-state.ts';

/**
 * A storage that keeps what it is given.
 *
 * @returns The storage and what it holds.
 */
function memoryStorage(): EditModeStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

/** A storage that refuses everything, as a private window or blocked site data can. */
const refusingStorage: EditModeStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('edit mode state', () => {
  it('starts in view mode', () => {
    expect(readStoredEditing(memoryStorage())).toBe(false);
  });

  it('remembers edit mode on and off', () => {
    const storage = memoryStorage();
    writeStoredEditing(storage, true);
    expect(storage.values.get(EDIT_MODE_STORAGE_KEY)).toBe('true');
    expect(readStoredEditing(storage)).toBe(true);
    writeStoredEditing(storage, false);
    expect(readStoredEditing(storage)).toBe(false);
  });

  it('reads view mode, and forgets quietly, when storage refuses or is missing', () => {
    expect(readStoredEditing(refusingStorage)).toBe(false);
    expect(() => writeStoredEditing(refusingStorage, true)).not.toThrow();
    expect(readStoredEditing(null)).toBe(false);
    expect(() => writeStoredEditing(null, true)).not.toThrow();
  });

  it('never puts someone who cannot edit in edit mode', () => {
    expect(effectiveEditing(false, true)).toBe(false);
    expect(effectiveEditing(false, false)).toBe(false);
    expect(effectiveEditing(true, false)).toBe(false);
    expect(effectiveEditing(true, true)).toBe(true);
  });
});

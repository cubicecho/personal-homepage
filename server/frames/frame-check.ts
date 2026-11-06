// STUB, to be built by the frame-check feature: asks a site whether it may be framed.

/** Whether a site lets other sites show it in a frame. */
export interface FrameCheckResult {
  url: string;
  /** True when nothing forbids it, false when a header does, null when the site could not be reached. */
  framable: boolean | null;
  reason: string | null;
}

/** Checks sites for framing rules. */
export interface FrameChecker {
  /**
   * Checks one URL.
   *
   * @param url - An http(s) URL, already validated.
   * @returns What the site's headers say.
   */
  check(url: string): Promise<FrameCheckResult>;
}

/**
 * Builds the frame checker.
 *
 * @returns A checker. The stub answers "unknown" for every URL.
 */
export function createFrameChecker(): FrameChecker {
  return { check: async (url) => ({ url, framable: null, reason: null }) };
}

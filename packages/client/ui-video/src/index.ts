/**
 * Web video-production studio plugin, node half.
 *
 * The studio is a browser presentation over existing Host capabilities
 * (Session Controller, workspace files, agent presets); this half carries no
 * runtime API. The video-production tools the studio's agent uses are
 * composed by the `video-app` bundle, not here.
 */

/** Host plugin body — the studio lives entirely in the browser half. */
export function apply(): void {}

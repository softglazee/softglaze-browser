// Which download a Browsers page row shows. A row is one major version; main reports one download per
// major (the latest entry of that major). A Ready row (a build of that major is installed) shows only a
// download that is running. A paused or interrupted one there is a newer build of the same major left
// over from an earlier run: the Ready row has no Resume button, so its orange "Interrupted · NN%" bar
// could never go away.
export const RUNNING_DOWNLOAD_STATES = Object.freeze(['queued', 'downloading', 'extracting', 'installing', 'verifying']);

export function rowDownload(installed, download) {
  if (!download) return null;
  if (installed && !RUNNING_DOWNLOAD_STATES.includes(download.state)) return null;
  return download;
}

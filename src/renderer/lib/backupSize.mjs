// The size the backup message shows, in KB as Windows Explorer shows a file (1024 bytes, rounded up):
// the saved file's size from main. A main without fileBytes (older) falls back to the database size.
export function backupKb(result) {
  const bytes = Number(result && (result.fileBytes != null ? result.fileBytes : result.dbBytes));
  return Number.isFinite(bytes) && bytes >= 0 ? String(Math.ceil(bytes / 1024)) : '?';
}

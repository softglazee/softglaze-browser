// Which notice the Database Encryption card shows while encryption is on.
// "Keep me signed in" with the workspace password (rememberStatus kind 'vault') opens the encrypted
// database at launch by itself (main's attemptRememberedUnlock replays it as dbUnlock does), so the
// card must not promise a password prompt then. A remembered member or Super Admin sign-in cannot open
// the database, so with those the password is asked at launch, as the default notice says.
export function dbEncryptionNoticeKey(remember) {
  return remember && remember.enabled && remember.kind === 'vault'
    ? 'dbEncryption.enabledNoticeRemembered'
    : 'dbEncryption.enabledNotice';
}

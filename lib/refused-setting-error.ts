/**
 * A stored series — a file, an export, a revision snapshot, a Trash
 * tombstone — scores with a setting this version of Sail Scoring no longer
 * has. Under ADR-013 such a file is refused, naming the setting, rather than
 * quietly rescored. The message is written for the scorer, so it is shown as
 * it stands: the API answers it as a 400 carrying the message.
 */
export class RefusedSettingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefusedSettingError';
  }
}

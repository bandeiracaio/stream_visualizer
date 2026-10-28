# Save folder (v091)

PC is the main collector: pick one folder once, every session file (Save session, auto-record) is written into it.
- `src/js/folder-save.js` (`FS`, view only): File System Access API (`showDirectoryPicker`, desktop Chrome/Edge). Handle kept in IndexedDB `sv-folder`; after a restart permission is `prompt`, one click on Allow.
- `fsSave(name, blob)` is called by `rtSave`; false (no folder / failed) means download as before. Never overwrites: `-2`, `-3` suffix. Failures go to the Health log (`folder-write-failed`).
- Panel at the top of Recordings > Saved: status banner (green saving / amber needs Allow or no folder / red last save failed), this session's writes, List folder (newest 15 session files, survives reloads).
- Unsupported browsers (phone, Firefox, Safari): panel says so; nothing else changes.
- Not covered: tape / health / label exports still download. Real folder picker untested (stubbed with an OPFS handle).

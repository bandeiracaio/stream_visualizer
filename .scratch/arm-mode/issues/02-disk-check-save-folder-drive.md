Status: needs-triage

# Disk check for the save folder's own drive

Moved from the "Not done" line of the disk space warning in `.scratch/arm-mode/spec.md`.

The warning reads `navigator.storage.estimate()`, which is the browser profile's drive. When the save folder is on another drive, nothing checks that drive's free space.

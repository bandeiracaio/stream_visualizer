# 1. Baselines adopt automatically; detection thresholds need approval

Status: accepted

Baselines are descriptive measurements ("normal spread is X") and update automatically once the evidence bar is met.
Detection thresholds change what the Reader flags and what the user labels, so they are only proposed, with evidence and a
before/after replay on recorded sessions, and applied after the user approves.

Consequence: a drifting market never silently changes detections; the cost is a weekly review step.

# 2. Recordings keep a baseline snapshot as provenance; replay comparison switches threshold sets

Status: accepted (amended 2026-10-15; the original wording assumed detectors read baselines)

Each recording embeds the baseline snapshot in effect when it was made. Detectors do NOT read baselines: they read explicit
threshold numbers, and the register only informs how a threshold is proposed for revision (the same-percentile rule: a
threshold keeps its percentile in the quantity's reference distribution). So the snapshot is provenance: it records what the
market looked like when the session was recorded, and the revision file cites it as evidence.

The replay comparison (Part 3b) toggles the threshold set, current vs proposed, over the same recorded inputs. Replay itself
stays pure and deterministic: the same inputs and the same thresholds give the same episodes.

Considered and rejected: detectors reading live baselines for cut-offs such as the aggressor share. That would change what
the Reader flags without the approval ADR 1 requires.

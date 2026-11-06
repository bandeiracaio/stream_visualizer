# Matt Pocock skills: what they do and how to prompt them here

All 38 skills of the `mattpocock-skills` plugin (version 1.3.1), each read from its own `SKILL.md`, with three prompts written for this repo. Paste a prompt as is, or change the nouns.

## How to read this

- **Invocable now** means the skill is in the list Claude Code offers this session and it can be called by name. **Slash command only** means the skill sets `disable-model-invocation`: you start it by typing `/<name>`, and Claude does not pick it up on its own. **Invocable by name** (the miscellaneous group) means it has no such flag but is not in this session's list, so ask for it by name or with `/<name>`.
- **Repo facts the skills need to know**
  - The domain language lives in `CONTEXT.md` and decisions in `docs/adr/`. The skills look for `GLOSSARY.md`, so prompts that touch the language say "`CONTEXT.md`".
  - The issue tracker is local markdown: see `docs/agents/issue-tracker.md`.
  - There is no `package.json`, no TypeScript and no CI test job. The check is `node build.mjs`, which runs the Reader self-test and compiles every page file.
  - Build, release and scope rules: `CLAUDE.md`.
  - Detection cut-offs are checked with `compare-detections.mjs` before and after a change.
- **How the skills fit together** (from `ask-matt`):
  - Main flow: idea, `grill-with-docs`, (`prototype`), `to-spec`, `to-tickets`, `implement` or `implement-spec`, with `tdd` and `code-review` inside, then `pr`.
  - Something broken: `diagnosing-bugs`, then `retro`.
  - Huge and foggy: `wayfinder`, then `to-spec`.
  - Upkeep: `improve-codebase-architecture`.
  - Anything unclear: `ask-matt`.

## Quick router

| You want to... | Use |
|---|---|
| Know which skill fits | `ask-matt` |
| Stress-test a plan | `grilling`, `grill-me`, `grill-with-docs` |
| Answer a design question with code | `prototype` |
| Look something up in primary sources | `research` |
| Sharpen terms, record a decision | `domain-modeling` |
| Turn a conversation into a spec, then tickets | `to-spec`, `to-tickets` |
| Build it | `implement`, `implement-spec`, `tdd` |
| Review it | `code-review` |
| Write the PR | `pr` |
| Fix a hard bug | `diagnosing-bugs` |
| Plan something too big for one session | `wayfinder` |
| Improve the code's shape | `improve-codebase-architecture`, `codebase-design` |
| Improve the agent's environment | `retro`, `writing-for-agents` |
| Pass work to another agent | `handoff`, `claude-handoff`, `chief-of-staff` |
| Explain a message again | `wait-what` |
| Walk yourself through manual steps | `wizard` |

---

# Engineering

## ask-matt
**Slash command only.** A router over the other skills. You describe your situation and it names the skill or flow that fits (main flow, bug flow, wayfinder, codebase health). It reads a skill's file before recommending or skipping it.

1. > "/ask-matt I have 200 unlabelled Reader groups, a pending Binance demo-key test and an armed tab recording overnight. Which skills should I use, and in what order?"
2. > "/ask-matt I want to change how walls re-open after they end. Is that a grill, a prototype, a spec or just tdd?"
3. > "/ask-matt My `CLAUDE.md` is getting long and agents miss rules in it. Which skill handles that, and which handles the session that showed the problem?"

## code-review
**Invocable now.** Reviews the changes since a fixed point on two axes, Standards and Spec, run as parallel sub-agents and reported side by side without reranking. It checks the fixed point resolves and the diff is non-empty first, and it carries a baseline of Fowler code smells as judgement calls.

1. > "Review everything since v096 against `.scratch/arm-mode/spec.md` and our `CLAUDE.md` rules (pure engine, colour tokens, line endings). Report Standards and Spec separately."
2. > "Review all auto-record changes since the commit before v097 against `.scratch/auto-record/`. Spec axis first: tell me about any scope creep."
3. > "Review the reader-research commits since `ff468c4~5` against `.scratch/reader-research/`, and flag any `test-*.md` claim its own numbers don't support."

## codebase-design
**Invocable now.** A shared vocabulary for deep modules: module, interface, depth, seam, adapter, leverage, locality, with the deletion test and "one adapter is a hypothetical seam, two is real". It can spin up sub-agents to design an interface several ways.

1. > "Apply the deletion test to `reader-register.js`, `reader-drift.js` and `reader-proposals.js`. Which are deep, which are pass-throughs, and where does the seam sit?"
2. > "Design the interface twice for one shared collector module that today differs between the worker and the page. Use sub-agents for radically different shapes and compare on depth, locality and seam placement."
3. > "`arm-mode.js` reads `AR`, `RT`, `FS`, `HL`, `DW` and `CL` directly. Show where a seam could go so the screen is testable without a browser, and say whether that is one adapter or two."

## diagnosing-bugs
**Invocable now.** A six-phase loop for hard bugs. It builds a tight, red-capable feedback loop first (one command that goes red on this exact bug), then reproduces and minimises, writes 3 to 5 ranked hypotheses, instruments with tagged logs, fixes with a regression test at a correct seam, and cleans up. It refuses to theorise before the loop exists, and it redacts secrets.

1. > "Diagnose why worker sockets (the Hyperliquid wallets socket first) close and reopen. Use the 'socket closed' notes in the Health log from an armed night (code, upMs, silentMs, ours) as the loop, separate our own silence-watchdog closes (`ours: silent`) from server closes, and say whether wallet records are lost in the gap. Background: `.scratch/socket-reconnects/research.md`."
2. > "Diagnose the quick-ending wall cards (about 25% end within seconds). Use `compare-detections.mjs` as the loop and show me the ranked hypotheses before testing any."
3. > "Diagnose why `analyze-episodes.mjs` takes minutes on the full set of saved sessions. Measure first with a timing harness, find the hot spot, and propose a fix that leaves every detection unchanged."

## domain-modeling
**Invocable now.** Builds and sharpens the domain model as you design: challenges terms against the glossary, sharpens fuzzy words, stress-tests with scenarios, checks the code agrees, updates the glossary immediately, and offers an ADR only when the decision is hard to reverse, surprising and a real trade-off.

1. > "In `CONTEXT.md` (not a new `GLOSSARY.md`), sharpen 'recording', 'run', 'arming', 'session' and 'group'. Challenge me wherever our code uses two of them for one thing."
2. > "Stress-test our definition of an episode group with edge cases: fast and mid readings of one event, a wall that ends and resumes, two venues at once. Update `CONTEXT.md` as each term resolves."
3. > "Decide whether the 100-run cap and the disk-warning thresholds deserve an ADR. Apply your three-part test honestly and write one only if all three hold."

## grill-with-docs
**Slash command only.** Runs `grilling` and `domain-modeling` together: a relentless interview that also writes the glossary and ADRs as answers settle. It is the start of the main flow whenever there is a repo to leave a paper trail in.

1. > "/grill-with-docs I want the Reader to propose a threshold change automatically when drift is confirmed for 3 sessions. Grill me, and record any term or decision that settles."
2. > "/grill-with-docs Let's design a second market (ETH) next to BTC. Grill me on what is shared, what is per-market, and what the baselines should key on."
3. > "/grill-with-docs Grill me on a 'review day' view that gathers labels, drift, proposals and revisions in one place, and write down the vocabulary we agree."

## implement
**Slash command only.** Implements work from a spec or ticket. It fetches the ticket and states its title, builds with `tdd` at pre-agreed seams, runs checks regularly, calls `code-review` at the end and commits to the current branch.

1. > "/implement `.scratch/label-queue/spec.md`, ticket 02. State its title first, and agree the seam with me before the first test."
2. > "/implement the free-space warning's follow-up: a Disk space line in the Saved recordings view. Use the existing `DISK` seam, run `node build.mjs` at the end, then review."
3. > "/implement `.scratch/collectors/` ticket 02 (the Reader uses collectors) one slice at a time, with a self-test scenario for each slice."

## implement-spec
**Slash command only.** Implements a whole spec and its tickets in one run: it reads the tickets as a task graph, runs implementer sub-agents on the ready frontier in parallel (each in its own worktree), merges them into one integration branch, runs `code-review` once at the end and cleans up.

1. > "/implement-spec `.scratch/order-history/spec.md` with its tickets. Use an integration branch and tell me the frontier before you start."
2. > "/implement-spec the Arm mode spec: split into tickets first, then run the independent ones in parallel. Remember that each piece of work is its own release step here."
3. > "/implement-spec a notification-on-red feature for Arm mode (no sound or notification today), working from the spec we write first."

## improve-codebase-architecture
**Slash command only.** Scans the code for deepening opportunities (shallow modules, leaky seams, hard-to-test parts), weighting recent hot spots. It writes a visual HTML report to the temp directory and then grills you through the candidate you pick.

1. > "/improve-codebase-architecture Focus on `app.js`, which is the biggest file. Where are the shallow modules and what would a deeper shape look like?"
2. > "/improve-codebase-architecture Walk the last 60 commits for hot spots and show me the top candidates in the HTML report."
3. > "/improve-codebase-architecture Look at how the pure `*-core.js` files and their views are paired. Is that the right seam, or is there a deeper one?"

## pr
**Invocable now.** Writes a PR body from one template: Summary (the smallest view that makes the point: pseudocode, call tree, file tree, diagram or diff), Evidence (before and after, screenshots best), and Merge Danger (one-way or two-way door, blast radius).

1. > "Write the PR body for v097 and v098: the 100-run cap and the disk warning. Evidence is the self-test output and the alert screenshots."
2. > "Write the PR body for a change that folds an approved threshold with `fold.mjs`. Merge Danger matters most, since detections change for everyone afterwards."
3. > "Write the PR body for adding `maxRuns` as a saved setting in the Arm UI, treating old saved configs as the blast radius."

## prototype
**Invocable now.** Builds throwaway code that answers a design question. The logic branch is a single shareable HTML file driven by buttons (with a pure, portable module inside). The UI branch is several radically different variants on one route, switched with `?variant=`. It stays in memory, unpolished, and is captured on a throwaway branch.

1. > "Prototype the UI question: what should Arm mode look like when I'm away from the desk? Give me 3 radically different variants on the existing view, switchable with `?variant=`."
2. > "Prototype the logic question: does the auto-record state machine (watching, recording, cooling down, done) handle 'stopped at the time limit, then triggered again at once' correctly? One HTML file, with the pure module separate."
3. > "Prototype the UI question: how should labelling look so 200 groups take 10 minutes instead of an hour? Variants of the label queue above the Timeline detail, using real Review data."

## research
**Invocable now.** Starts a background agent that investigates a question against primary sources only (official docs, source, specs), writes one Markdown file citing each claim's source, and saves it where the repo keeps such notes (here `.scratch/reader-research/` or `.scratch/`).

1. > "Research whether any browser API can report the real free space of the folder chosen with the File System Access API, or of its drive. Official Chrome and WHATWG docs only."
2. > "Research whether Chrome throttles or freezes a dedicated Web Worker created by a hidden page, and whether an open WebSocket, a held Web Lock or a wake lock stops Chrome freezing the tab. These are the two points `.scratch/socket-reconnects/research.md` left UNVERIFIED. Official Chrome and HTML Standard docs only."
3. > "Research whether Deribit closes an idle WebSocket when no `public/set_heartbeat` is set, and whether Bybit's 10-minute idle statement applies to public streams. Both are UNVERIFIED in `.scratch/socket-reconnects/research.md`. Official docs only."

## retro
**Slash command only.** A retrospective on a coding session that improves the agent's environment, not the code. It reads the session logs and looks at navigation, automated checks, coding standards, a bloated global instructions file, tool economy, no-ops and information access, and reports candidates by severity.

1. > "/retro on this session: where did you lose time finding files, and which navigation pointer in `CLAUDE.md` would have saved it?"
2. > "/retro on the line-ending slip (the edit that converted CRLF lines in `reader-selftest.js`). Which check would have caught it automatically, a mechanical one rather than a rule?"
3. > "/retro on the overnight collection run: what information would an agent have needed to avoid the 8-run cap surprise, and where should it live?"

## setup-matt-pocock-skills
**Slash command only.** A one-off, prompt-driven setup of the per-repo configuration: issue tracker, triage labels and domain-doc layout. It explores, presents what it found, confirms, then writes. This repo is already set up (`docs/agents/`).

1. > "/setup-matt-pocock-skills Audit the existing setup in `docs/agents/` and `CLAUDE.md` and tell me what is out of date. Change nothing yet."
2. > "/setup-matt-pocock-skills I want issues on GitHub Issues instead of `.scratch/`. What changes, and what would I lose?"
3. > "/setup-matt-pocock-skills Make the skills read `CONTEXT.md` instead of `GLOSSARY.md`, and show me exactly where that is recorded."

## tdd
**Invocable now.** Test-driven development in vertical slices (one test, one implementation, repeat). It writes tests only at seams agreed in advance, tests behaviour through public interfaces, bans tautological and implementation-coupled tests, and keeps refactoring out of the red-green loop.

1. > "Using TDD at the `DISK` seam, add a threshold for 'hours left' that adapts when the recording rate changes mid-day. Propose the seam and what it misses before the first test."
2. > "Using TDD at `READER_ENGINE.replayEngine`, make a wall that reappears at the same price within 90 seconds resume the old episode. Agree the seam with me first and start with the failing self-test scenario."
3. > "Using TDD at `LABELQ.pick`, add a 'skip groups older than N hours' filter. One test per slice, with expected values from worked examples rather than recomputed."

## to-spec
**Slash command only.** Turns the conversation so far into a spec and publishes it to the issue tracker, with no interview. It proposes the fewest, highest test seams (ideally one) and checks them with you, then writes Problem, Solution, user stories, implementation and testing decisions, and out of scope. It labels the spec `ready-for-agent`.

1. > "/to-spec for the notification-on-red feature we just discussed. Propose one test seam and check it with me."
2. > "/to-spec for a 'collector confidence' panel that shows, per collector, how much of its data cleared the analysis bar. Publish to `.scratch/`."
3. > "/to-spec for letting the user set the free-space thresholds in Arm mode, using the vocabulary in `CONTEXT.md`."

## to-tickets
**Slash command only.** Breaks a plan or spec into tracer-bullet tickets (narrow, complete vertical slices, each sized for one fresh context), each declaring the tickets that block it. It quizzes you on the breakdown before publishing. A wide refactor is sequenced as expand, migrate, contract.

1. > "/to-tickets from `.scratch/arm-mode/spec.md`: slice it vertically, show blocking edges, and quiz me before you write the files."
2. > "/to-tickets for moving every hex colour in the canvases onto the `TH` tokens, as a wide refactor with expand, migrate and contract tickets."
3. > "/to-tickets for the next Reader step (a self-test scenario per new behaviour), keeping each ticket one release."

## triage
**Slash command only.** Moves issues through a state machine of roles (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix, plus bug or enhancement), writes agent-ready briefs, and keeps an `.out-of-scope/` knowledge base. Every comment starts with an AI disclaimer. Here, state lives in the `Status:` line of the ticket files.

1. > "/triage show me anything under `.scratch/*/issues/` that needs my attention, oldest first."
2. > "/triage take the 'noted but not changed' items from past releases and turn each into a ticket with a category and a state."
3. > "/triage decide what is `wontfix` for the Reader (for example, the touch-level wall cards), and record the reason in `.out-of-scope/` so we stop re-asking."

## wayfinder
**Slash command only.** Plans work too big for one session as a shared map of decision tickets on the tracker (a map file plus child tickets), resolving them one at a time until the way is clear. It produces decisions, not deliverables, and hands off to `to-spec`. Here the map is `.scratch/<effort>/map.md`.

1. > "/wayfinder Destination: a decision on whether to make a second venue pair (Coinbase and Bybit) first-class in the Reader. Chart the map."
2. > "/wayfinder Destination: a plan for running the app unattended for a month (storage, restarts, alerts, reviews). Name the destination, then the first decision tickets."
3. > "/wayfinder Destination: a spec for a scoring system that tells us which detectors to keep, using labels, outcomes and collector context."

## wizard
**Invocable now.** Generates an interactive bash wizard for steps only a human can do. It opens each URL, says what to click and copy, captures values, writes them where they belong and confirms before irreversible steps. It scopes the stages with you first, checks the script statically and never runs it itself.

1. > "Make a wizard for the Binance demo-key test: create the key, paste it into the app, then check the Orders, Fills, Income and Account info views, with a confirm before each step."
2. > "Make a wizard for moving the save folder to another drive: choose the folder in the app, allow it, check a new recording lands there, then copy the old files across."
3. > "Make a wizard for the weekly review: export the report and register from the Reader tab, drop the revision files into `docs/revisions/`, then run `fold.mjs --check` and `fold.mjs`."

---

# Productivity

## grilling
**Invocable now.** The relentless interview primitive. It maps decisions as a design tree and asks the whole frontier each round, numbering questions with a recommended answer so "yes" accepts it. It looks up facts itself and is done only when every branch is visited and nothing is silently assumed.

1. > "Grill me on using agree/disagree labels as ground truth for tuning Reader thresholds. Cover bias, label drift, and what a 'missed' label should count as."
2. > "Grill me on the collection plan for the next week: how many market regimes I need, what counts as enough, and when to stop collecting and start deciding."
3. > "Grill me on whether to keep all 7 collectors on for every recording, given that none has shown a confirmed signal and the files keep growing."

## grill-me
**Slash command only.** The same interview, for when there is no working directory to leave a paper trail in. It simply calls `grilling`.

1. > "/grill-me My plan is to label only the episodes I would have traded. What is wrong with that?"
2. > "/grill-me I want to publish a weekly one-page market summary from the recordings. Is it worth the effort?"
3. > "/grill-me Should the app stay one single HTML file forever, or is there a point where we split it?"

## handoff
**Slash command only.** Compacts the conversation into a handoff document for a fresh agent: saved to the temp directory, with a suggested-skills section, pointers instead of duplicated content, and secrets redacted. You pass what the next session is for.

1. > "/handoff The next session will re-run the analysis scripts on two more days of recordings and compare with today's results."
2. > "/handoff The next session will build the notification-on-red feature from the spec we wrote."
3. > "/handoff The next session will label episodes with me: carry the label-queue keys, the 200 open groups and the current scoreboard."

## teach
**Slash command only.** A stateful, multi-session teaching workspace in the current directory: a mission file, reference sheets (HTML), a resources list, learning records and self-contained lessons. Run it in its own folder, not in this repo.

1. > "/teach (in a new folder) Teach me order-flow basics: aggressors, passive liquidity, absorption and exhaustion. My mission is to label Reader episodes with confidence."
2. > "/teach (in a new folder) Teach me robust statistics (MAD, quantiles, permutation tests) well enough to read `analyze-collectors.mjs` output."
3. > "/teach (in a new folder) Teach me market microstructure of perpetual futures: funding, basis, open interest and liquidations, so I understand the collector fields."

## to-questionnaire
**Slash command only.** Turns a decision you cannot answer alone into a Markdown questionnaire for one person to fill in. It grills you only on the send (who and what you need back), then writes questions aimed at the gap, most important first, to `to-questionnaire-<slug>.md`.

1. > "/to-questionnaire for a discretionary trader friend: what do they actually look at when they say 'absorption', so I can compare it with the Reader's definition?"
2. > "/to-questionnaire for a data engineer: how would they store a month of multi-gigabyte market recordings, and what should I worry about?"
3. > "/to-questionnaire for Binance support or a Binance-savvy colleague: how demo keys, demo endpoints and permissions work for the order history views."

## wait-what
**Slash command only.** "That last message did not land: re-pitch it." It restates where things are with a little context, in simplified technical English, using the ubiquitous language from the glossary.

1. > "/wait-what" (right after a long analysis report)
2. > "/wait-what I lost the thread on why the 'rehearsal only' label appeared. Re-pitch that part."
3. > "/wait-what What does 'resolved-against' mean for a burst group, in plain words?"

## writing-for-agents
**Invocable now.** A reference for writing any document an agent reads (skills, `AGENTS.md`, `CLAUDE.md`). It treats a document as context pointers and loads: steps with checkable completion criteria, reference pushed behind pointers (progressive disclosure), a single source of truth, no no-ops, and positive phrasing.

1. > "Rewrite the Source map in `CLAUDE.md` using context pointers. Keep every build and release rule, push per-file detail into docs that load only when needed, and cut anything the code already shows."
2. > "Find the no-ops, duplicates and stale lines in `CLAUDE.md` and `docs/agents/*.md`, and propose the deletions with a reason for each."
3. > "Turn the weekly review and release procedures in `CLAUDE.md` into steps with checkable completion criteria, so an agent cannot stop one step early."

---

# In progress (the plugin keeps these in an `in-progress` folder; expect them to change)

## chief-of-staff
**Slash command only.** Pursues a long-running goal in one long session by coordinating background sub-agents and schedules. It thinks tactically and strategically (improve the environment for the next task), protects its own context and uses context pointers.

1. > "/chief-of-staff Goal: two weeks of unattended, high-quality collection, with a daily check, a weekly analysis and a fold-ready list of threshold proposals."
2. > "/chief-of-staff Goal: get 20 labelled episodes per family. Schedule the work, delegate the analysis runs, and keep me for the labels."
3. > "/chief-of-staff Goal: keep the repo healthy while another Claude also releases versions: fetch-before-release, collision checks and a short daily status."

## claude-handoff
**Slash command only.** Like `handoff`, but it also launches a fresh background agent (`claude --bg --name ...`) seeded with the summary, so it continues the work immediately.

1. > "/claude-handoff Start a background agent to re-run both analysis scripts on the newest recordings and write the results to `.scratch/`."
2. > "/claude-handoff Start a background agent to draft the notification-on-red spec while I keep labelling."
3. > "/claude-handoff Start a background agent to find every hex colour in `app.js` that should be a `TH` token, and report without changing anything."

## loop-me
**Slash command only.** A stateful grilling session whose only output is workflow specs in `workflows/*.md`. It uses a lens of loops (recurring patterns), triggers, checkpoints, and "push right" (defer the human checkpoint as late as possible).

1. > "/loop-me Design the morning workflow for checking the armed tab and the overnight recordings, with one checkpoint pushed as far right as possible."
2. > "/loop-me Design the weekly review workflow end to end: exports, proposals, approvals, fold, release."
3. > "/loop-me Find loops in my week of working with this app that are worth delegating, and spec the best one."

## setup-ts-deep-modules
**Slash command only.** Wires dependency-cruiser into a TypeScript repo so each package is a deep module reachable only through its entry points, then proves the rules bite. Not a fit as is: this repo has no TypeScript or `package.json`.

1. > "/setup-ts-deep-modules Tell me whether this applies to a plain-JavaScript repo with global scripts, and what would have to change first."
2. > "/setup-ts-deep-modules Sketch what 'entry points only' would mean for the `*-core.js` and view pairs, without installing anything."
3. > "/setup-ts-deep-modules Is there a lightweight check (a Node script in `build.mjs`) that enforces the same idea for our globals?"

## writing-beats
**Slash command only.** Assembles raw material into an article as a journey of beats. You settle what the audience already knows, then pick between 2 to 3 candidate next beats at each step, and no beat leans on a concept not yet grounded.

1. > "/writing-beats Raw material is `.scratch/reader-research/`. Audience: other builders of order-flow tools. Take me through the beats of an article on what the research found."
2. > "/writing-beats Write 'Why one HTML file' as a beat-by-beat article for developers new to local-first apps."
3. > "/writing-beats Article: 'What the saved recordings taught us', built from the analysis output in the scratchpad."

## writing-fragments
**Slash command only.** The explore half of writing: a grilling session that mines raw fragments (sharp sentences, claims, vignettes, half-thoughts, leading words) into one Markdown file, with no structure imposed yet.

1. > "/writing-fragments Topic: what it feels like to build a detector and then measure it against yourself."
2. > "/writing-fragments Topic: the Reader that revises its own assumptions, and why the user must approve every threshold."
3. > "/writing-fragments Topic: running a data-collection machine for a night and what went wrong."

## writing-shape
**Slash command only.** The exploit half of writing: takes a raw-material file (fragments, prose, a transcript) and shapes a separate article paragraph by paragraph, choosing an opening, grounding concepts before they are used, and arguing each format choice.

1. > "/writing-shape Shape the fragments file into a 1,200-word post for a general technical audience."
2. > "/writing-shape Shape the research notes in `.scratch/reader-research/` into a short report that a non-trader could follow."
3. > "/writing-shape Turn the `CLAUDE.md` Reader redesign notes into a design-rationale article."

---

# Miscellaneous (mostly for other kinds of repo)

## git-guardrails-claude-code
**Invocable by name.** Installs a Claude Code `PreToolUse` hook that blocks dangerous git commands (`push`, `reset --hard`, `clean -f`, `branch -D`, `checkout .`, `restore .`), for this project or for all projects. Careful: this repo's release flow ends with `git push`, so a blanket block would stop releases.

1. > "Set up git guardrails for this project only, but leave `git push` allowed, since every release ends with one. Show me the exact hook before you install it."
2. > "Set up git guardrails globally, and tell me which of my normal commands in this repo would be blocked."
3. > "Install the guardrails project-only, then try `git reset --hard` and `git clean -f` against a scratch worktree to prove they are blocked."

## migrate-to-shoehorn
**Invocable by name.** Replaces `as` type assertions in TypeScript test files with `@total-typescript/shoehorn` (`fromPartial`, `fromAny`). Not a fit: this repo has no TypeScript tests.

1. > "Confirm there is nothing for shoehorn to do here (no TypeScript), and list what the nearest equivalent would be in `reader-selftest.js`."
2. > "In `reader-selftest.js`, find scenarios that build huge input objects for one small fact, and suggest a partial-fixture helper in the same spirit."
3. > "If we ever move the pure files to TypeScript, which would be first, and how would shoehorn fit the self-test scenarios?"

## scaffold-exercises
**Invocable by name.** Creates course exercise directories (sections, problems, solutions, explainers) that pass a specific linter. Not a fit: this repo is not a course, and the lint command it uses is not installed here.

1. > "Outline (do not create) a course section structure that would teach order-flow concepts using our recordings as exercises."
2. > "Tell me whether `scaffold-exercises` could work without its linter, and what the plain directory convention is."
3. > "Sketch a 6-exercise path from 'read a session file' to 'write a detector', with problem, solution and explainer for each."

## setup-pre-commit
**Invocable by name.** Sets up Husky, lint-staged (Prettier), type checking and tests as a pre-commit hook. Needs a `package.json`, which this repo lacks, so it would have to be adapted.

1. > "Design a pre-commit hook for this repo that runs `node build.mjs` and fails on a line-ending change, using a plain `.git/hooks/pre-commit`, with no Husky."
2. > "Would a pre-commit hook have caught the CRLF slip in `reader-selftest.js`? Show the check that would."
3. > "Propose which of our existing checks (`--selftest` flags, `fold.mjs --check`, `compare-detections.mjs`) belong in a pre-commit hook and which are too slow."

---

*Source: the plugin cache at `~/.claude/plugins/cache/claude-plugins-official/mattpocock-skills/1.3.1/skills/`. The prompts are suggestions written for this repo and were not run.*

# Chrome and hidden tabs: dedicated workers, WebSocket, Web Lock, wake lock

Read 2026-11-06. Official sources only (developer.chrome.com, W3C/WICG specs, Chromium source on chromium.googlesource.com). Quotes were re-fetched and checked against each page on 2026-11-06 (WebFetch, which answers through a small model, so wording is as returned; the WICG, Page Lifecycle, Chrome 57, Chrome 88 and Screen Wake Lock quotes matched). Corrections from that check: the Chromium enum values have no description text in the source (the earlier "the page uses WebRTC" / "the page holds a Web Lock" glosses were paraphrases, now removed), and the Chrome 57 sentence is "The run-timers-once-a-second rule is still applied in these cases." Anything not found in an official source is marked UNVERIFIED.

Three different things are easy to mix up here:
- **Throttled**: timers run late (once a second, then once a minute). Code still runs.
- **Frozen** (Page Lifecycle): "the browser suspends execution of freezable tasks in the page's task queues". Nothing runs until resume.
- **Discarded**: the page is unloaded and must reload. Not the same as frozen.

## Short answer

| Question | Answer | Basis |
|---|---|---|
| Hidden page's dedicated worker: timers throttled? | Official docs are silent about workers in the throttling posts. UNVERIFIED for workers. | Chrome 88 timer post and "background tabs" post never mention workers |
| Dedicated worker when its document is frozen? | Blocked (frozen with the document). | Page Lifecycle draft 5.1 |
| Open WebSocket stops freezing? | No. Not in Chromium's list of freeze blockers. WebRTC, audio, Web Lock are. | `freezing_policy.cc` |
| Held Web Lock stops freezing? | Yes in current Chromium source (`kHoldingWebLock`). Not stated in any prose doc. | `freezing_policy.cc` |
| Screen wake lock stops freezing? | Not listed. And it is released once the page is hidden anyway. | `freezing_policy.cc`, Screen Wake Lock spec |
| Other exemptions | Visible, recently visible, audible, recently audible, most recently used tabs, loading, WebRTC, notification permission, USB/Bluetooth/HID/serial, capture, mirroring, per-site opt-out. | `freezing_policy.cc` |

## 1. Dedicated worker of a hidden page

**Timer throttling.** The Chrome throttling posts describe pages, not workers.
- "Chrome 88 (January 2021) will heavily throttle chained JavaScript timers for hidden pages" and "Generally, hidden means a different tab is active, or the window has been minimized" (https://developer.chrome.com/blog/timer-throttling-in-chrome-88; no date shown on the page, version stated as Chrome 88). Intensive throttling conditions: "The page has been hidden for more than 5 minutes", "The chain count is 5 or greater", "The page has been silent for at least 30 seconds", "WebRTC is not in use." The fetcher reported no mention of Web Workers.
- https://developer.chrome.com/blog/background_tabs (policies "in Chrome 57"; no date shown): no mention of workers either.
- Whether a worker's own `setInterval` is throttled when its owner page is hidden: not documented in the sources above. UNVERIFIED.

**Freezing.** The Page Lifecycle article does not say whether workers are affected (https://developer.chrome.com/blog/page-lifecycle-api, "Published: December 1, 2023, Last updated: October 16, 2026"). It says: "In the frozen state the browser suspends execution of freezable tasks in the page's task queues until the page is unfrozen." and "This means things like JavaScript timers and fetch callbacks don't run."

The WICG draft is explicit (https://wicg.github.io/page-lifecycle/, Draft Community Group Report, 9 June 2022, "not a W3C Standard"), section 5.1: "Any dedicated worker agent whose single realm's global object's owning document is non-null and frozen must become blocked." and "A DedicatedWorkerGlobalScope's owner set will always have exactly one item."

So per the spec, a dedicated worker of a frozen document is blocked: its timers and its WebSocket message handlers do not run. A worker is not a way around freezing.

## 2. Open WebSocket

The Page Lifecycle article has no freezing exemption list. It lists audio and WebRTC as reasons a page "won't be discarded unless under extreme resource constraints", and tells developers for the frozen state: "Stop any network polling or close any open Web Socket connections." (same URL as above).

Chromium's freezing policy (https://chromium.googlesource.com/chromium/src/+/main/components/performance_manager/freezing/freezing_policy.cc, main branch, read 2026-11-06) lists the `CannotFreezeReason` values: kVisible, kRecentlyVisible, kAudible, kRecentlyAudible, kMostRecentlyUsed, kLoading, kOptedOut, kFreezingOriginTrialOptOut, kWebRTC, kNotificationPermission, kHoldingWebLock, kHoldingBlockingIndexedDBLock, kWebUI, device connections (USB, Bluetooth, HID, serial), capturing (video, audio, window, display), kBeingMirrored. **WebSocket is not in the list.** WebRTC is (kWebRTC, set from `page_node->UsesWebRTC()`). The enum (`components/performance_manager/public/freezing/cannot_freeze_reason.h`) carries no per-value comments, only "List of reasons not to freeze a browsing instance."

Related but different: the scheduler tracks `kWebSocket` as "WebSocket live connection" and `kWebRTC` as "WebRTC live connection" (https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/common/scheduler/web_scheduler_tracked_feature.cc). That file is about back/forward cache eligibility, not tab freezing; the fetcher found no freezing comment in it.

Timer throttling is a separate path: the Chrome 57 post says real-time connections are exempt from the budget throttling ("Applications with real-time connections (WebSockets and WebRTC), to avoid closing these connections by timeout"), and adds "The run-timers-once-a-second rule is still applied in these cases." That is the old budget throttle, not freezing. The Chrome 88 intensive throttling exemption is for WebRTC with an open `RTCDataChannel`, not WebSocket.

Message activity: no official doc says traffic on a WebSocket affects freezing. UNVERIFIED either way.

## 3. Held Web Lock

- Chromium source: `kHoldingWebLock` is set from `page_node->IsHoldingWebLock()` in `OnPageIsHoldingWebLockChanged` (freezing_policy.cc, link above), with no comment text. So a page holding a lock is not frozen by this policy.
- The Web Locks spec (https://w3c.github.io/web-locks/, Editor's Draft 24 September 2025) does not mention freezing or the page lifecycle. It covers unload: "Whenever the unloading document cleanup steps run with a document, terminate remaining locks and requests with its agent." and "The lock will be released when the callback exits for any reason."
- The Page Lifecycle draft only says in an example to "Release any web locks" on freeze and re-acquire on resume; it does not define lock behaviour.
- Which context holds the lock matters (page vs worker): the accessor is on the page node (`IsHoldingWebLock`); whether a lock taken in a worker counts is not shown. UNVERIFIED.
- The source is code on `main`, not a versioned doc. The Chrome version where `kHoldingWebLock` was added was not checked.

## 4. Screen wake lock

- Screen Wake Lock spec (https://w3c.github.io/screen-wake-lock/, no date on the page): in "Handling document loss of visibility", "If |state| is not "hidden", abort these steps." and the following step releases every screen lock in the document's active-locks list. `request()` rejects when "[the] visibility state is "hidden"" with NotAllowedError. On loss of full activity the locks are also released.
- So the lock is gone once the page is hidden, and it is not in Chromium's freeze-blocker list. It cannot protect a hidden tab. The spec does not use the words "freeze" or "suspend".

## 5. Other exemptions (brief)

- Audio: "The page has made noises in the past 30 seconds." counts for intensive throttling, "but a silent audio track doesn't count." (Chrome 88 post). Pages with audible audio are "exempted from background timer throttling" (Chrome 57 post). Chromium freezing: kAudible, kRecentlyAudible.
- WebRTC: exempt from intensive throttling only with "an `RTCPeerConnection` with an 'open' `RTCDataChannel`"; also kWebRTC in the freezing policy.
- Per-site opt-out and an origin trial opt-out exist (`kOptedOut`, `kFreezingOriginTrialOptOut`). Mechanism not documented in the sources read.
- Most recently used tabs are protected (kMostRecentlyUsed); the count was not checked.
- Memory Saver docs: the URL tried (developer.chrome.com/docs/web-platform/performance-extra/memory-saver-mode) returned 404. Not checked. UNVERIFIED. Memory Saver discards, which is a separate step from freezing.

## What the docs do not say

- Whether a dedicated worker's timers are throttled when the owner page is only hidden (not frozen).
- Whether any doc (not source code) lists Web Locks as a freeze blocker.
- Whether message traffic on a WebSocket changes anything for freezing.
- When a hidden tab becomes frozen (timing, or condition), on desktop vs Android. The Page Lifecycle article gives no number in what was fetched.
- Whether a lock held inside a worker counts as the page holding it.
- Throttled, frozen and discarded have separate rules; the exemptions above are not the same list for each.

## Implication for this app

- The main protection against freezing in Chromium's list is the Web Lock (`sv-armed`). The WebSocket and the wake lock should not be counted on: WebSocket is not a freeze blocker, and the wake lock is released at hide.
- If the lock does hold, the page is not frozen, so the workers keep running; timer throttling of worker timers while hidden stays undocumented, so the `tick` interval and silence checks may run late.
- If the page does freeze (lock not counted, other browser, or Android), the workers are blocked with it and sockets will fall silent; the Health log's `freeze` and `resume` notes are the way to tell.

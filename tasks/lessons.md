# Lessons

## Stubbed-VM test harnesses must supply the globals the code actually uses
**Context:** Testing `src/background.js` inside `vm.createContext({...})`, the URL
scheme guard appeared to pass every rejection case.

**What went wrong:** `URL` is not present in a bare vm context. Every
`new URL(...)` threw `ReferenceError`, was swallowed by the code's own
`try/catch`, and returned "Not a valid URL". The `javascript:` / `data:` /
`chrome://` rejection tests all passed *for the wrong reason* — they would have
passed identically against a guard that did nothing.

**Rule for next time:** When a test asserts that something is *rejected*, also
assert a matching *acceptance* case in the same run. A guard that rejects
everything is indistinguishable from a correct guard otherwise. Here, adding
`allows https:` / `allows file:` cases immediately exposed the broken harness.
Explicitly pass real globals (`URL`, `TextEncoder`, timers) into vm sandboxes.

## `x || DEFAULT` is wrong wherever 0, '' or false is a legal value
`Number(s.hoverDelay) || DEFAULTS.hoverDelay` silently rewrote a user-chosen
0 ms delay to 400 ms, even though the options slider offers `min="0"`.
Use `Number.isFinite(v) ? v : DEFAULT` (and `v !== undefined` for spreads).

## Timing tests in an automated browser tab are clamped

`__sweepTest` reported the rest gate broken (`whileMoving: 1`) right after it had
passed. The gate was fine: a tab that isn't foregrounded clamps `setTimeout` to ~1 s,
so a "540 ms" sweep actually took 8590 ms — far past the 400 ms hover delay, so the
menu was *supposed* to appear. Nothing in the result said so.

**Rule:** any timing assertion driven by `setTimeout` must also report the elapsed
wall time, and the assertion must be read against it. A duration you asked for is not
a duration you got. The same applies to `await sleep()` inside injected page scripts.

## An affordance needs figure-ground, not just marks

Three bare dots were unobtrusive and also invisible — they read as page punctuation.
The fix was not more contrast on the dots but giving them a container: a translucent,
blurred capsule. Shape is what separates UI from content; a mark alone doesn't.

## A keyframe that names a property only once animates it the whole way

The grip's "fill in as the pointer arrives" was a single 40% keyframe setting
`background`. CSS supplies the missing 0% and 100% keyframes from the element's
current value, so the colour interpolated across the entire first 40% of the loop and
the capsule was a coloured blob long before the pointer got near it.

**Rule:** if a property appears in one keyframe, it is being animated between *every*
keyframe. Pin it at the stops where it should not change, or express the change with a
property that is already animated.

## Headless screenshots don't advance compositor animations

An `opacity`/`transform`-only animation runs on the compositor thread, which
`--virtual-time-budget` does not fast-forward — the element simply never appears in the
capture, which looks exactly like a CSS bug. Neighbouring animations that touched
`left`/`top` or `background` advanced normally, which made it look element-specific.
`--disable-threaded-animation` renders them correctly.

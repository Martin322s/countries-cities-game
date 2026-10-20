# Real-device test plan (REQUIRED before public launch)

Automation cannot faithfully verify iOS/Android background suspension, real speaker
audio or every virtual keyboard. These checks are **manual** and were **not** performed
during development. Use the staging deployment, two or more devices, and one desktop
browser as the host.

## iPhone Safari (current iOS)

- [ ] Open the link from Messages; create and join rooms (name field, keyboard "Go")
- [ ] READY → countdown → letter: numbers readable, no layout jump
- [ ] Type all seven answers: the "next" key moves between fields, the focused field is
      never hidden under the letter/timer header, the ГОТОВ button stays reachable
- [ ] Lock answers; "ГОТОВ СИ" appears where the button was
- [ ] Switch to another app for ~5 s during a round and back: others see
      "извън играта" and then "… се върна след N сек."; your own note is neutral
- [ ] Lock the phone for ~10 s during a round: same as above; answers are still there
- [ ] Sound: silent before the first tap; after a tap the countdown ticks; mute toggle works
      and persists; ring/silent switch behaviour noted
- [ ] Airplane mode for ~10 s during PLAYING: the connection notice appears, answers typed
      meanwhile are sent after reconnecting; identity unchanged
- [ ] Results table scrolls horizontally inside its panel (not the page); history navigator usable
- [ ] FINISHED: winner visible, confetti ends, no horizontal page scroll
- [ ] Rotate to landscape and back during PLAYING

## Android Chrome (current Android)

- [ ] Same checklist as iPhone
- [ ] Background the browser with the home button for ~10 s during a round
- [ ] Switch between two Chrome tabs of the game (same player): no false "извън играта"
      while one game tab is visible
- [ ] Pull-to-refresh during PLAYING restores the answers and the timer

## Desktop browsers

- [ ] Chrome, Firefox, Safari: full round with 3 players, invalidation, next round
- [ ] Keyboard only: create → join → READY → answers (Enter moves on) → ГОТОВ → results
- [ ] Screen reader spot check (NVDA/VoiceOver): timer announcements at 60/30/10 s, results
      announced once, notifications polite (no focus stealing)

Record the device, OS and browser versions and any deviation.

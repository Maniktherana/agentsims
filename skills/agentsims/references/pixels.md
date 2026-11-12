# Pixel points, sliders, maps, and degraded accessibility

## Aim a pixel point

Use this only when no ref, no exact label, and no percent point can name the target.

1. Run `agentsims screenshot -d <id>` or `agentsims observe -d <id>`. Note `capture=cN` and the size on the `image` line, for example `1080×2400`.
2. Open the image file. If the output says `capture=none`, the screen changed during the capture: the image is evidence, but it cannot aim a point. Capture again.
3. Measure the target in the printed size, not in the size of the image that you see. Your image viewer can scale the image down, so multiply by printed width / shown width before you write pixels.
4. To aim at a node, run `observe --frames`. Each node gets `[box=x,y,w,h]` in the same pixels. Aim at `x + w/2, y + h/2`.
5. Act with the capture: `agentsims tap 603,1311 --capture c7 -d <id>`.
6. After an accepted action, the capture ID is ended. Capture again before the next pixel point: the old pixels can show a screen that is gone. A rotation or input from the browser also ends it.

Never mix units in one point (`50%,900`): the CLI refuses it.

## Sliders

1. Run `observe --frames`. The slider prints its value, for example `slider "Brightness" [ref=e9]: 45%`.
2. `drag` from the thumb to the new position along the bar. `drag` moves slowly, so the slider follows. A `swipe` can fling the slider past the target.
3. For the maximum or the minimum, drag to the far edge of the box from `--frames`.
4. Read `value: 45% → 93%` or `slider "…": … → …` in the result. Repeat with a shorter drag until the value is the requested one.

## Maps

1. Find a named place with the app's search, not by a long press on the map: a long press drops a pin at an unnamed coordinate.
2. Open the result whose subtitle matches the place type in the task, for example a village and not a bus stop with the same name.
3. Read the coordinate or address in that result, then act.

## Degraded accessibility

| You see | It means | Do |
| --- | --- | --- |
| `accessibility error`, `image ok` | Only pixels are available | Use the procedure above. Report each semantic check as unverified |
| `accessibility ok`, `image error` | Only the tree is available | Continue with refs and labels. Report that visual proof is missing |
| Both channels `error` | No evidence | Stop. Run `agentsims doctor` |
| iOS tree has only the application root | The iOS accessibility provider did not read the app. On iOS 27 this happens to an unfocused stock app while VoiceOver is off | Treat it as degraded, not as an empty screen. Use pixel points. Never turn on VoiceOver to fix it: VoiceOver captures taps |

`fill` and `type` still verify text by readback when the tree is degraded.

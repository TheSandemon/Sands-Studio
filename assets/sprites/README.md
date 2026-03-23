# Adding Custom Pixel Art Sprites

Drop your PNG frames here and describe them in `manifest.json`.
The app will pick them up automatically on next launch.

---

## Folder Layout

```
assets/sprites/
  manifest.json          ← creature registry
  my-creature/
    idle_0.png
    idle_1.png
    busy_0.png
    busy_1.png
    sleep_0.png
    error_0.png
    talking_0.png
    talking_1.png
```

---

## manifest.json entry

```json
{
  "creatures": [
    {
      "id": "my-creature",
      "displayName": "My Creature",
      "scale": 3,
      "animations": {
        "idle":    { "fps": 2,   "frames": ["my-creature/idle_0.png", "my-creature/idle_1.png"] },
        "busy":    { "fps": 6,   "frames": ["my-creature/busy_0.png", "my-creature/busy_1.png"] },
        "sleep":   { "fps": 0.8, "frames": ["my-creature/sleep_0.png"] },
        "error":   { "fps": 4,   "frames": ["my-creature/error_0.png"] },
        "talking": { "fps": 8,   "frames": ["my-creature/talking_0.png", "my-creature/talking_1.png"] }
      }
    }
  ]
}
```

---

## Sprite Tips

- **Format**: PNG with alpha transparency (RGBA)
- **Size**: Any size — but 12×12 or 16×16 at `scale: 3` or `scale: 4` works great
- **Animation states**: `idle`, `busy`, `sleep`, `error`, `talking`
  - You can omit any state — the system falls back to `idle`
- **Frame count**: 1–4 frames per state recommended (pixel art = low frame count)
- **scale**: Each source pixel is rendered as `scale × scale` screen pixels
- **Transparency**: Fully transparent pixels are skipped — no black boxes

---

## Code-defined creatures (alternative)

If you prefer to define sprites as pixel grids in TypeScript (no PNGs needed),
see `src/renderer/creatures/builtinCreatures.ts` — the `BLOB` export is a complete example.
Add your creature to the `BUILTIN_CREATURES` array at the bottom of that file.

### Palette format
```ts
const MY_PALETTE = {
  'B': 0xFF6633,  // body orange
  'D': 0xCC3300,  // dark shadow
  'W': 0xFFFFFF,  // white
  // ...
}
```

### Grid format
```ts
const FRAME_0 = [
  '....BB....', // row 0
  '...BBBB...',
  // ...
]
// '.' = transparent, any other char = look up in palette
```

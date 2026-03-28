---
name: electron-ipc-debugging
description: Debug Electron IPC argument mismatches between preload contextBridge and main process ipcMain handlers. Use when Electron app has runtime crashes in IPC handlers or preload API calls silently fail.
---

# Electron IPC Debugging

## Overview

Electron apps crash with cryptic errors like `TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string. Received an instance of Object` when the **preload script sends a different number of arguments than the main process handler expects**. This is the #1 cause of silent failures and crashes in Electron IPC layers.

**Core principle:** The preload and main process are separate JavaScript contexts. The `ipcRenderer.invoke()` call in preload must pass exactly the arguments `ipcMain.handle()` expects in the main process. TypeScript types in the preload do NOT enforce runtime behavior in the main process.

## When to Use

Use when:
- Electron app crashes with IPC handler errors
- `Cannot read properties of undefined (reading 'X')` inside an IPC handler
- `path.join` or other Node.js functions receive `[object Object]` instead of a string
- A feature works in development but fails in production build
- `contextBridge.exposeInMainWorld` API calls silently do nothing

## The Iron Law

```
ipcRenderer.invoke() args MUST exactly match ipcMain.handle() params
Count, order, and type must all align.
```

## Phase 1: Identify the Mismatch From Error Messages

### Error Pattern 1: Object Used as Path String

```
TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string. Received an instance of Object
at Object.join (node:path:479:7)
at HabitatLog.snapshotsDir (.../out/main/index.js:4398:17)
at HabitatLog.writeSnapshot (.../out/main/index.js:4475:22)
at .../out/main/index.js:5515:30
```

**Root cause**: The handler did `path.join(this.baseDir, something)` where `something` was an object (likely a JavaScript object passed as argument 2 but the handler expected argument 1 to be a string).

**Diagnosis**: Read the stack trace backward:
1. The crash is in `snapshotsDir()` calling `path.join(this.baseDir, ...)`
2. `snapshotsDir()` is called by `writeSnapshot()`
3. Look at `writeSnapshot()` in the built output — what does it do with its first parameter?

### Error Pattern 2: Undefined Property Access

```
TypeError: Cannot read properties of undefined (reading 'length')
at .../habitat:apply handler
```

**Root cause**: An object passed as argument was accessed with `.property` but the argument received was the wrong value (e.g., a string ID instead of the full object).

### Error Pattern 3: Optional Chaining Returning Undefined

```
window.habitatAPI.someMethod is not a function
```

**Root cause**: The preload's `habitatAPI` object doesn't have that method — either it was never added to `contextBridge.exposeInMainWorld()`, or the renderer is using an old cached build.

## Phase 2: Trace the Argument Flow

### Step 1: Find the Preload Call

Search for the IPC channel name in the preload:

```bash
grep -n "ipcRenderer.invoke.*'channel-name'" src/preload/
```

Read the exact invocation:
```js
// preload/index.ts
const habitatlogAPI = {
  writeSnapshot: (snapshot: unknown) => ipcRenderer.invoke('habitatlog:write-snapshot', snapshot),
  //                           ↑ 1 argument
}
```

### Step 2: Find the Handler

Search for the channel in the main process:

```bash
grep -n "ipcMain.handle.*'channel-name'" src/main/
```

Read the handler signature:
```js
// main/index.ts
ipcMain.handle('habitatlog:write-snapshot', (_e, habitatId: string, snapshot: ...) => {
  //                                        ↑ 2 parameters!
})
```

### Step 3: Compare

| Location | Arguments | Parameter Names |
|----------|----------|----------------|
| Preload  | 1 (`snapshot`) | `snapshot` |
| Main handler | 2 (`habitatId`, `snapshot`) | `habitatId`, `snapshot` |

**The mismatch**: Preload sends 1 arg, handler expects 2. The `snapshot` object becomes `habitatId` in the handler.

### Step 4: Check Built Output

The TypeScript source shows the intent. The **built JavaScript output** shows the reality. Always verify the `out/` directory reflects your latest build:

```bash
# Verify handler signature in built output
grep -A2 "ipcMain.handle.*write-snapshot" out/main/index.js

# Verify preload call in built output
grep "habitatlog:write-snapshot" out/preload/index.js
```

## Phase 3: The Fix Patterns

### Pattern 1: Preload Sends Wrong Count

**Symptom**: Preload sends N args, handler expects M args (N ≠ M).

**Fix options** (choose based on which side has the wrong contract):

**Option A — Fix the handler to match preload** (when preload is correct):
```ts
// Before (handler wrong):
ipcMain.handle('channel', (_e, id: string, data: object) => { ... })

// After (handler fixed):
ipcMain.handle('channel', (_e, payload: { id: string; data: object }) => {
  const { id, data } = payload
  ...
})
```

**Option B — Fix the preload to match handler** (when handler is correct):
```js
// Before (preload wrong):
invoke('channel', snapshot)

// After (preload fixed):
invoke('channel', habitatId, snapshot)
```

### Pattern 2: Missing IPC Handler

**Symptom**: Renderer calls `window.habitatAPI.getCurrentHabitatId()` but it doesn't exist.

**Fix**: Add the handler AND expose it in preload:

```ts
// main/index.ts — add handler
ipcMain.handle('habitat:get-current-id', () => {
  return currentHabitatId
})

// preload/index.ts — expose method
const habitatAPI = {
  getCurrentHabitatId: () => ipcRenderer.invoke('habitat:get-current-id'),
  // ...
}
contextBridge.exposeInMainWorld('habitatAPI', habitatAPI)
```

### Pattern 3: Async Before-Unload Race

**Symptom**: `beforeunload` fires, IPC calls don't complete before the window closes.

**Fix**: Make the handler async and await the calls:

```ts
// Before (sync, fires-and-forgets):
const handleBeforeUnload = () => {
  window.habitatAPI.getCurrentHabitatId() // doesn't complete
  window.habitatlogAPI.writeSnapshot({ ... }) // doesn't complete
}

// After (async, properly waits):
const handleBeforeUnload = async () => {
  const [habitatId, habitatName] = await Promise.all([
    window.habitatAPI.getCurrentHabitatId?.() ?? 'default',
    window.habitatAPI.getCurrentHabitatName?.() ?? '',
  ])
  window.habitatlogAPI.writeSnapshot({ habitatId, ... })
}
```

## Phase 4: Verify the Fix

### 1. Verify Built Output

After fixing, rebuild and verify the built JS matches your fix:

```bash
npm run build
grep -A2 "ipcMain.handle.*channel-name" out/main/index.js
grep "channel-name" out/preload/index.js
```

### 2. Common Verification Commands

```bash
# Check handler argument count in built output
node -e "
const src = require('fs').readFileSync('out/main/index.js', 'utf8')
const m = src.match(/ipcMain\.handle\(['\"]([^'\"]+)['\"],\s*\(_e,(.*?)\)/)
console.log('Handler:', m[1], '| Args:', m[2])
"

# Check preload argument count
grep -oP \"ipcRenderer\.invoke\(['\"][^'\"]+['\"][^)]*)\" out/preload/index.js
```

### 3. Run the App

```bash
npm run start 2>&1 | grep -i "error\|Error"
```

Watch the console on startup and during the action that triggers the IPC.

## Quick Reference: Preload → Main Argument Tracing

```
Renderer (React)
    ↓ contextBridge API call
Preload (ipcRenderer.invoke)
    ↓ Electron IPC channel
Main Process (ipcMain.handle)
    ↓
Implementation
```

Every argument mismatch shows up as:
- Wrong value received in handler (count mismatch)
- `undefined` method calls (missing handler)
- `path.join` receiving object instead of string (type mismatch)
- Stale build caching old code (verify with build hash)

## Related Patterns

- **`contextBridge.exposeInMainWorld`** — Always verify the exposed object matches what the renderer expects
- **Zustand persist + IPC** — When renderer store changes need to persist via main process IPC, verify the data shape matches what the main process handler expects
- **electron-vite build** — The `out/` directory is the source of truth at runtime, not `src/`. Always rebuild after changes.

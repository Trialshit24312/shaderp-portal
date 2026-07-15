# Vehicle models

## FiveM stream packs (recommended)

KOVERT can scan your server addon packs (e.g. `600-debadged-01/stream/[Ferrari]/488animated`) and convert `.yft` + `.ytd` → `.glb` for the Solid viewport.

On the portal host:

```powershell
# Index all 600-debadged vehicles into catalog.json
.\Sync-ServerVehicles.ps1

# Convert one spawn (uses gtax.dev drawable→GLB API)
.\Sync-ServerVehicles.ps1 -ConvertSpawn 488animated
```

Env (portal `.env` / Render):

| Variable | Purpose |
|----------|---------|
| `FIVEM_RESOURCES_ROOT` | Path to `resources/[standalone]` (must see the packs) |
| `V_DRAWABLE_TO_GLB_API_KEY` | Optional gtax API key (higher daily convert quota) |

In the studio: **Rescan packs** · pick a vehicle · **Load .yft → 3D**.

Converted GLBs cache under `owned-static/livery/vehicles/{spawn}.glb`.

## Manual GLB drop-in

Drop a GLB/GLTF named after the spawn (e.g. `488animated.glb`).

Fallback order:
1. Portal API `/api/livery/vehicles/{spawn}/model.glb` (stream convert/cache)
2. `/vehicles/{spawn}.glb`
3. `/vehicles/{bodyType}.glb`
4. Built-in procedural mesh

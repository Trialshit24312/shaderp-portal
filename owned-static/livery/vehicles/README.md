# Vehicle models (optional)

Drop a GLB/GLTF named after the vehicle spawn (e.g. `police.glb`, `comet2.glb`).

Fallback order:
1. `/vehicles/{spawnName}.glb`
2. `/vehicles/{spawnName}.gltf`
3. `/vehicles/{bodyType}.glb` (`sedan`, `sports`, `suv`, …)
4. Built-in GTA-style procedural mesh

Convert CodeWalker / OpenIV exports to GLB first. Rockstar GTA V meshes cannot ship in this repo.

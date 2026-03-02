# 12-tiles-raster-osm-switch

This demo extends raster tile loading with **runtime source switching**:

- OSM Standard: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`
- OSM HOT: `https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png`

When switching source, the tile cache is cleared to prevent mixed textures from different services.

## Controls

- Drag: pan
- Mouse wheel: zoom at cursor
- Q / E: rotate

Panel parameters:

- `tileSource`: switch between Standard and HOT
- `maxParallel`: max concurrent tile requests
- `maxCache`: max tile textures in cache (LRU eviction)
- `showBorders`: draw tile boundaries
- `opacity`: raster layer opacity

## Notes

- Network access is required.
- Tile image loading uses CORS (`crossOrigin = "anonymous"`).
- Tile attribution: Copyright OpenStreetMap contributors.

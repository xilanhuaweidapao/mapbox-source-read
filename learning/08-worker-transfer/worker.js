// 专用 worker：接收 GeoJSON，构建 bucket（typed arrays），并通过 transferable 回传

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type !== "build") return;

  const t0 = performance.now();
  const geojson = msg.geojson;

  const fill = buildFillBucket(geojson);
  const line = buildLineBucket(geojson);
  const t1 = performance.now();

  const payload = {
    type: "built",
    buildMs: t1 - t0,
    fill,
    line,
  };

  const transfer = [
    fill.positions.buffer,
    fill.colors.buffer,
    fill.indices.buffer,
    line.positions.buffer,
    line.colors.buffer,
    line.indices.buffer,
  ];
  self.postMessage(payload, transfer);
};

function lngLatToMercator(lng, lat) {
  const x = (lng + 180) / 360;
  const y = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;
  return { x, y };
}

function buildFillBucket(fc) {
  const positions = [];
  const colors = [];
  const indices = [];

  for (const feature of fc.features) {
    if (feature.geometry.type !== "Polygon") continue;
    const ring = feature.geometry.coordinates[0];
    const baseIndex = positions.length / 2;
    const rgba = feature.properties.color || [80, 200, 255, 140];

    for (let i = 0; i < ring.length - 1; i++) {
      const [lng, lat] = ring[i];
      const m = lngLatToMercator(lng, lat);
      positions.push(m.x, m.y);
      colors.push(rgba[0], rgba[1], rgba[2], rgba[3]);
    }

    const n = ring.length - 1;
    for (let i = 1; i < n - 1; i++) {
      indices.push(baseIndex + 0, baseIndex + i, baseIndex + i + 1);
    }
  }

  return {
    positions: new Float32Array(positions),
    colors: new Uint8Array(colors),
    indices: new Uint16Array(indices),
    vertexCount: positions.length / 2,
  };
}

function buildLineBucket(fc) {
  const positions = [];
  const colors = [];
  const indices = [];

  for (const feature of fc.features) {
    if (feature.geometry.type !== "LineString") continue;
    const coords = feature.geometry.coordinates;
    const baseIndex = positions.length / 2;
    const rgba = feature.properties.color || [255, 170, 80, 255];

    for (let i = 0; i < coords.length; i++) {
      const [lng, lat] = coords[i];
      const m = lngLatToMercator(lng, lat);
      positions.push(m.x, m.y);
      colors.push(rgba[0], rgba[1], rgba[2], rgba[3]);
    }

    for (let i = 0; i < coords.length - 1; i++) {
      indices.push(baseIndex + i, baseIndex + i + 1);
    }
  }

  return {
    positions: new Float32Array(positions),
    colors: new Uint8Array(colors),
    indices: new Uint16Array(indices),
    vertexCount: positions.length / 2,
  };
}


export const MAX_MERCATOR_LATITUDE = 85.051129;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function wrap(value, min, max) {
  const range = max - min;
  const wrapped = ((((value - min) % range) + range) % range) + min;
  return wrapped === min ? max : wrapped;
}

// Mapbox GL 的 Web Mercator 公式（和仓库 `geo/mercator_coordinate.js` 同源）
export function mercatorXfromLng(lng) {
  return (180 + lng) / 360;
}

export function mercatorYfromLat(lat) {
  const clampedLat = clamp(lat, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE);
  return (
    (180 -
      (180 / Math.PI) *
        Math.log(Math.tan(Math.PI / 4 + (clampedLat * Math.PI) / 360))) /
    360
  );
}

export function lngFromMercatorX(x) {
  return x * 360 - 180;
}

export function latFromMercatorY(y) {
  const y2 = 180 - y * 360;
  return (360 / Math.PI) * Math.atan(Math.exp((y2 * Math.PI) / 180)) - 90;
}


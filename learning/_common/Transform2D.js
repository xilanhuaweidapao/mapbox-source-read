import {
  clamp,
  mercatorXfromLng,
  mercatorYfromLat,
  lngFromMercatorX,
  latFromMercatorY,
  MAX_MERCATOR_LATITUDE,
  wrap,
} from "./mercator.js";
import { mat4Multiply, mat4RotationZ, mat4Scale, mat4Translation } from "./mat4.js";

// 一个“最小可用”的 2D Transform（Mercator + pan/zoom/bearing）。
// 目的：让你在 learning 示例里能复现仓库 `geo/transform.js` 的核心思想（但实现更简单）。
export class Transform2D {
  constructor({
    width,
    height,
    tileSize = 256,
    center = [0, 0],
    zoom = 0,
    bearing = 0,
    renderWorldCopies = true,
  }) {
    this.tileSize = tileSize;
    this.width = width;
    this.height = height;
    this.renderWorldCopies = renderWorldCopies;

    this._zoom = zoom;
    this._bearing = bearing;
    this._bearingRad = (bearing * Math.PI) / 180;

    this._centerMercator = { x: 0.5, y: 0.5 };
    this.setCenter(center[0], center[1]);
  }

  get zoom() {
    return this._zoom;
  }

  get bearing() {
    return this._bearing;
  }

  get worldSize() {
    return this.tileSize * Math.pow(2, this._zoom);
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
  }

  setCenter(lng, lat) {
    const clampedLat = clamp(lat, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE);
    const x = mercatorXfromLng(lng); // lng 可超出 [-180,180]，x 可超出 [0,1]（用于 world copies）
    const y = mercatorYfromLat(clampedLat);

    // 若不渲染 world copies，则把中心限制在一个世界内
    this._centerMercator.x = this.renderWorldCopies ? x : clamp(wrap(x, 0, 1), 0, 1);
    this._centerMercator.y = clamp(y, 0, 1);
  }

  getCenter() {
    // 展示给用户时通常 wrap 到 [-180,180]
    const lng = lngFromMercatorX(wrap(this._centerMercator.x, 0, 1));
    const lat = latFromMercatorY(this._centerMercator.y);
    return { lng, lat };
  }

  setBearing(bearing) {
    this._bearing = bearing;
    this._bearingRad = (bearing * Math.PI) / 180;
  }

  setZoom(zoom, anchorPx = null) {
    const nextZoom = clamp(zoom, 0, 22);
    if (!anchorPx) {
      this._zoom = nextZoom;
      return;
    }

    // “以鼠标点为锚”缩放：缩放前后，锚点对应的 mercator 坐标不变。
    const before = this.screenToMercator(anchorPx.x, anchorPx.y);
    this._zoom = nextZoom;
    const afterWorldSize = this.worldSize;
    const dx = anchorPx.x - this.width / 2;
    const dy = anchorPx.y - this.height / 2;
    const inv = rotate2D({ x: dx, y: dy }, -this._bearingRad);
    const newCenterWorldX = before.x * afterWorldSize - inv.x;
    const newCenterWorldY = before.y * afterWorldSize - inv.y;
    this._centerMercator.x = newCenterWorldX / afterWorldSize;
    this._centerMercator.y = clamp(newCenterWorldY / afterWorldSize, 0, 1);
  }

  panByPixels(dx, dy) {
    const inv = rotate2D({ x: dx, y: dy }, -this._bearingRad);
    const ws = this.worldSize;
    this._centerMercator.x -= inv.x / ws;
    this._centerMercator.y = clamp(this._centerMercator.y - inv.y / ws, 0, 1);
  }

  zoomByDelta(deltaY, anchorPx) {
    const zoomDelta = -deltaY * 0.0015;
    this.setZoom(this._zoom + zoomDelta, anchorPx);
  }

  // mercator -> screen(px)
  mercatorToScreen(x, y) {
    const ws = this.worldSize;
    const centerWorld = { x: this._centerMercator.x * ws, y: this._centerMercator.y * ws };
    const world = { x: x * ws, y: y * ws };
    const v = { x: world.x - centerWorld.x, y: world.y - centerWorld.y };
    const vr = rotate2D(v, this._bearingRad);
    return { x: this.width / 2 + vr.x, y: this.height / 2 + vr.y };
  }

  // screen(px) -> mercator（x 允许超出 [0,1]，用于 world copies）
  screenToMercator(screenX, screenY) {
    const ws = this.worldSize;
    const dx = screenX - this.width / 2;
    const dy = screenY - this.height / 2;
    const v = rotate2D({ x: dx, y: dy }, -this._bearingRad);
    const centerWorld = { x: this._centerMercator.x * ws, y: this._centerMercator.y * ws };
    const worldX = centerWorld.x + v.x;
    const worldY = centerWorld.y + v.y;
    return { x: worldX / ws, y: worldY / ws };
  }

  // mercator(normalized) -> clip space 的矩阵（给 shader 用）
  getMercatorToClipMatrix() {
    const ws = this.worldSize;
    const T = mat4Translation(-this._centerMercator.x, -this._centerMercator.y, 0);
    const S = mat4Scale(ws, ws, 1);
    const R = mat4RotationZ(this._bearingRad);
    const P = mat4Scale(2 / this.width, -2 / this.height, 1);

    // M = P * R * S * T
    return mat4Multiply(P, mat4Multiply(R, mat4Multiply(S, T)));
  }
}

function rotate2D(v, rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}


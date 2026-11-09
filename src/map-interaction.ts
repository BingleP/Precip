/**
 * Map interaction helpers: state creation, zoom, render coalescing, and
 * pointer drag / pinch. These are pure functions over the injected MapState
 * (plus DOM events) and have no rendering dependencies, so they can stay
 * small and independently testable. map.ts re-exports them for compatibility.
 */

import type { MapState } from "./types";
import { MAP_DEFAULT_ZOOM, MAP_MAX_ZOOM, MAP_MIN_ZOOM, INITIAL_MAP_CENTER } from "./config";
import {
  clampMapZoom,
  latLonToWorld,
  screenToMapLocation,
  setMapCenterFromWorld,
} from "./geo";

export function getMapState(center = INITIAL_MAP_CENTER): MapState {
  return {
    center: { latitude: center.latitude, longitude: center.longitude },
    zoom: MAP_DEFAULT_ZOOM,
    drag: null,
    selected: null,
    renderQueued: false,
  };
}

export function zoomMap(
  delta: number,
  mapState: MapState,
  onRender: () => void,
  onScheduleRefresh: () => void,
): void {
  const nextZoom = clampMapZoom(mapState.zoom + delta, MAP_MIN_ZOOM, MAP_MAX_ZOOM);
  if (nextZoom === mapState.zoom) return;
  mapState.zoom = nextZoom;
  onRender();
  onScheduleRefresh();
}

export function queueMapRender(mapState: MapState, renderFn: () => void): void {
  if (mapState.renderQueued) return;
  mapState.renderQueued = true;
  requestAnimationFrame(() => {
    mapState.renderQueued = false;
    renderFn();
  });
}

export function startMapDrag(
  event: PointerEvent,
  mapState: MapState,
  activePointers: Map<number, { x: number; y: number }>,
  canvas: HTMLCanvasElement,
  onDragStart: () => void,
  pinchState?: { startDist: number; startZoom: number },
): void {
  if (event.button !== 0) return;
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (activePointers.size >= 2) {
    if (mapState.drag) {
      canvas.classList.remove("dragging");
      mapState.drag = null;
    }
    if (pinchState) {
      const pts = [...activePointers.values()];
      pinchState.startDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchState.startZoom = Math.round(mapState.zoom);
    }
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const zoom = Math.round(mapState.zoom);
  mapState.drag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    canvasX: event.clientX - rect.left,
    canvasY: event.clientY - rect.top,
    width: rect.width,
    height: rect.height,
    centerWorld: latLonToWorld(mapState.center.latitude, mapState.center.longitude, zoom),
    zoom,
    moved: false,
  };
  canvas.classList.add("dragging");
  canvas.setPointerCapture(event.pointerId);
  onDragStart();
}

export function moveMapDrag(
  event: PointerEvent,
  mapState: MapState,
  activePointers: Map<number, { x: number; y: number }>,
  pinchState: { startDist: number; startZoom: number },
  onZoomChange: () => void,
  onRender: () => void,
  onScheduleRefresh: () => void,
  onTooltipUpdate: (event: PointerEvent) => void,
): void {
  if (activePointers.has(event.pointerId)) {
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  if (activePointers.size >= 2 && pinchState.startDist > 0) {
    const pts = [...activePointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const targetZoom = clampMapZoom(Math.round(pinchState.startZoom + Math.log2(dist / pinchState.startDist)), MAP_MIN_ZOOM, MAP_MAX_ZOOM);
    if (targetZoom !== mapState.zoom) {
      mapState.zoom = targetZoom;
      queueMapRender(mapState, onZoomChange);
      onScheduleRefresh();
    }
    return;
  }

  if (!mapState.drag || mapState.drag.pointerId !== event.pointerId) {
    onTooltipUpdate(event);
    return;
  }

  const dx = event.clientX - mapState.drag.startX;
  const dy = event.clientY - mapState.drag.startY;
  if (Math.hypot(dx, dy) > 5) {
    mapState.drag.moved = true;
  }

  mapState.center = setMapCenterFromWorld(
    { x: mapState.drag.centerWorld.x - dx, y: mapState.drag.centerWorld.y - dy },
    mapState.drag.zoom,
  );
  queueMapRender(mapState, onRender);
}

export function endMapDrag(
  event: PointerEvent,
  mapState: MapState,
  activePointers: Map<number, { x: number; y: number }>,
  pinchState: { startDist: number; startZoom: number },
  onScheduleRefresh: () => void,
  onMapClick: (latitude: number, longitude: number, event: PointerEvent) => void,
): void {
  activePointers.delete(event.pointerId);
  if (activePointers.size < 2) {
    pinchState.startDist = 0;
  }

  if (!mapState.drag || mapState.drag.pointerId !== event.pointerId) return;

  const drag = mapState.drag;
  mapState.drag = null;
  const canvas = event.currentTarget as HTMLCanvasElement;
  canvas.classList.remove("dragging");
  canvas.releasePointerCapture(event.pointerId);

  if (!drag.moved) {
    const location = screenToMapLocation(drag.canvasX, drag.canvasY, drag.width, drag.height, mapState.center.latitude, mapState.center.longitude, drag.zoom);
    onMapClick(location.latitude, location.longitude, event);
    return;
  }

  onScheduleRefresh();
}

export function resetMapView(
  mapState: MapState,
  defaultZoom: number,
  location?: { latitude: number; longitude: number } | null,
): void {
  const loc = location || mapState.selected;
  if (!loc) return;
  mapState.center = { latitude: loc.latitude, longitude: loc.longitude };
  mapState.zoom = defaultZoom;
}

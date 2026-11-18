export interface Camera { zoom: number; x: number; y: number }
export const INITIAL_CAMERA: Camera = { zoom: 1, x: 0, y: 0 };
export function constrainCamera(camera: Camera): Camera {
  const zoom = Math.max(1, Math.min(6, camera.zoom));
  return { zoom, x: Math.max(-320 * (zoom - 1), Math.min(320 * (zoom - 1), camera.x)), y: Math.max(-240 * (zoom - 1), Math.min(240 * (zoom - 1), camera.y)) };
}
/** Keep the world point beneath the gesture anchor fixed. */
export function zoomCamera(camera: Camera, zoom: number, anchor = { x: 320, y: 240 }): Camera {
  const next = Math.max(1, Math.min(6, zoom));
  const ratio = next / camera.zoom;
  return constrainCamera({ zoom: next, x: anchor.x - 320 - (anchor.x - 320 - camera.x) * ratio, y: anchor.y - 240 - (anchor.y - 240 - camera.y) * ratio });
}

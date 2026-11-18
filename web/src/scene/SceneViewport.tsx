import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Minus, Plus, Hand } from 'lucide-react';
import type { Scene } from '../../../shared/scene/types.ts';
import { SceneCanvas } from './SceneCanvas.tsx';
import { constrainCamera, INITIAL_CAMERA, zoomCamera, type Camera } from './camera.ts';

interface Props {
  scene: Scene;
  params: Record<string, number>;
  visible: Set<string>;
  highlighted: Set<string>;
  camera: Camera;
  onCamera: (camera: Camera) => void;
  annotations?: Set<string>;
  frameVisible?: Set<string>;
}
export function SceneViewport({ camera, onCamera, ...props }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [scale, setScale] = useState(1);
  const [interact, setInteract] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const resize = () => setScale(element.clientWidth / 640 || 1);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const local = (x: number, y: number) => {
    const box = ref.current!.getBoundingClientRect();
    return { x: (x - box.left) * 640 / (box.width || 1), y: (y - box.top) * 480 / (box.height || 1) };
  };
  const update = (next: Camera) => { cameraRef.current = next; onCamera(next); };
  // Only modified wheel gestures zoom; ordinary wheel scrolling still scrolls the page.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      update(zoomCamera(cameraRef.current, cameraRef.current.zoom * Math.exp(-event.deltaY * 0.005), local(event.clientX, event.clientY)));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [onCamera]);
  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    const mouse = event.pointerType === 'mouse';
    // Touch users must opt into canvas gestures; zoom buttons do not trap their scroll.
    if (mouse ? event.button !== 0 || cameraRef.current.zoom <= 1 : !interact) return;
    if (pointers.current.size >= 2) return;
    pointers.current.set(event.pointerId, local(event.clientX, event.clientY));
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const old = pointers.current.get(event.pointerId);
    if (!old) return;
    const current = local(event.clientX, event.clientY);
    const other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId)?.[1];
    pointers.current.set(event.pointerId, current);
    if (other) {
      const before = { x: (old.x + other.x) / 2, y: (old.y + other.y) / 2 };
      const after = { x: (current.x + other.x) / 2, y: (current.y + other.y) / 2 };
      const distance = Math.hypot(old.x - other.x, old.y - other.y);
      if (distance < 2) return;
      const next = zoomCamera(cameraRef.current, cameraRef.current.zoom * Math.hypot(current.x - other.x, current.y - other.y) / distance, before);
      update(constrainCamera({ ...next, x: next.x + after.x - before.x, y: next.y + after.y - before.y }));
    } else if (cameraRef.current.zoom > 1) {
      update(constrainCamera({ ...cameraRef.current, x: cameraRef.current.x + current.x - old.x, y: cameraRef.current.y + current.y - old.y }));
    }
  };
  const end = (event: ReactPointerEvent<HTMLDivElement>) => pointers.current.delete(event.pointerId);
  return <>
    <div className="scene-view-tools" role="group" aria-label="图形视角">
      <button className="icon-btn" aria-label="缩小图形" disabled={camera.zoom <= 1} onClick={() => update(zoomCamera(camera, camera.zoom / 1.3))}><Minus size={17} /></button>
      <output aria-label="缩放比例">{Math.round(camera.zoom * 100)}%</output>
      <button className="icon-btn" aria-label="放大图形" disabled={camera.zoom >= 6} onClick={() => update(zoomCamera(camera, camera.zoom * 1.3))}><Plus size={17} /></button>
      {camera.zoom > 1 && <button className="scene-tool-toggle scene-view-reset" aria-label="适应全图" title="复位视角" onClick={() => {
        pointers.current.clear();
        update(INITIAL_CAMERA);
      }}>复位</button>}
      <button className="icon-btn scene-gesture-toggle" aria-label={interact ? '退出手势' : '手势看图'} title={interact ? '退出手势看图，恢复页面滚动' : '手势看图：双指缩放'} aria-pressed={interact} onClick={() => {
        pointers.current.clear();
        setInteract(!interact);
      }}><Hand size={16} aria-hidden="true" /></button>
    </div>
    <div ref={ref} className={`scene-viewport${interact ? ' interactive' : ''}`} data-zoom={camera.zoom} data-zoomed={camera.zoom > 1} data-pan-x={camera.x} data-pan-y={camera.y}
      onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
      <SceneCanvas {...props} camera={camera} displayScale={scale} />
    </div>
    {interact && camera.zoom <= 1 && <div className="scene-gesture-hint">双指缩放 · 放大后可拖动</div>}
  </>;
}

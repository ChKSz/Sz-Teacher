import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { RotateCw, X } from 'lucide-react';
import { Range } from './Range.tsx';

/** 发送前检查图片：放大、旋转，以及拖选或键盘调整裁剪区域。 */
export function ImageEditor({ source, onSave, onClose }: { source: string; onSave: (source: string) => void; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const [rotation, setRotation] = useState(0);
  const [preview, setPreview] = useState(source);
  const [zoom, setZoom] = useState(1);
  const [crop, setCrop] = useState({ left: 0, top: 0, right: 100, bottom: 100 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { dialogRef.current?.showModal(); }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const img = new Image();
    img.onload = () => {
      if (!active) return;
      const canvas = document.createElement('canvas');
      canvas.width = rotation % 180 ? img.naturalHeight : img.naturalWidth;
      canvas.height = rotation % 180 ? img.naturalWidth : img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(rotation * Math.PI / 180);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      setPreview(canvas.toDataURL('image/jpeg', 0.95));
      setCrop({ left: 0, top: 0, right: 100, bottom: 100 });
      setLoading(false);
    };
    img.onerror = () => { if (active) { setError('图片读取失败，请重新选择'); setLoading(false); } };
    img.src = source;
    return () => { active = false; };
  }, [source, rotation]);

  const point = (event: PointerEvent) => {
    const rect = imageRef.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)), y: Math.max(0, Math.min(100, (event.clientY - rect.top) / rect.height * 100)) };
  };
  const save = () => {
    const img = imageRef.current;
    if (!img?.naturalWidth || loading) return;
    const canvas = document.createElement('canvas');
    const left = img.naturalWidth * crop.left / 100;
    const top = img.naturalHeight * crop.top / 100;
    canvas.width = Math.max(1, Math.round(img.naturalWidth * (crop.right - crop.left) / 100));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * (crop.bottom - crop.top) / 100));
    canvas.getContext('2d')!.drawImage(img, left, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    onSave(canvas.toDataURL('image/jpeg', 0.92));
  };

  return createPortal(
    <dialog className="image-editor" ref={dialogRef} aria-label="编辑题目图片" onCancel={onClose}>
      <header className="modal-head"><h2>检查题目图片</h2><button className="icon-btn" onClick={onClose} aria-label="关闭图片编辑"><X size={18} /></button></header>
      <div className="image-editor-body">
        <p className="muted small">拖动框选一道题，保留完整题干和图形；也可以用下方滑块调整边界。</p>
        <div className="image-editor-viewport">
          <div className="crop-stage" style={{ width: `${zoom * 100}%` }}
            onPointerDown={(event) => { if (loading || event.button !== 0) return; event.preventDefault(); originRef.current = point(event); event.currentTarget.setPointerCapture(event.pointerId); }}
            onPointerMove={(event) => {
              const start = originRef.current;
              if (!start) return;
              const end = point(event);
              if (Math.abs(start.x - end.x) < 1 || Math.abs(start.y - end.y) < 1) return;
              setCrop({ left: Math.min(start.x, end.x), right: Math.max(start.x, end.x), top: Math.min(start.y, end.y), bottom: Math.max(start.y, end.y) });
            }}
            onPointerUp={() => { originRef.current = null; }} onPointerCancel={() => { originRef.current = null; }}>
            <img ref={imageRef} src={preview} alt="题目图片裁剪预览" draggable={false} />
            <div className="crop-selection" style={{ left: `${crop.left}%`, top: `${crop.top}%`, width: `${crop.right - crop.left}%`, height: `${crop.bottom - crop.top}%` }} />
          </div>
        </div>
        <div className="image-tools">
          <button className="btn" disabled={loading} onClick={() => setRotation((r) => (r + 90) % 360)}><RotateCw size={16} />向右旋转</button>
          <button className="btn" onClick={() => { setRotation(0); setZoom(1); setCrop({ left: 0, top: 0, right: 100, bottom: 100 }); }}>还原图片</button>
          <label>放大 {zoom.toFixed(1)} 倍<Range min="1" max="3" step="0.1" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /></label>
        </div>
        <div className="crop-edges">
          {([['left', '左边界'], ['right', '右边界'], ['top', '上边界'], ['bottom', '下边界']] as const).map(([key, label]) => (
            <label key={key}>{label}
              <Range min={key === 'right' ? crop.left + 1 : key === 'bottom' ? crop.top + 1 : 0} max={key === 'left' ? crop.right - 1 : key === 'top' ? crop.bottom - 1 : 100} step="1" value={crop[key]} onChange={(e) => setCrop((c) => ({ ...c, [key]: Number(e.target.value) }))} />
            </label>
          ))}
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
      </div>
      <footer className="image-editor-footer"><button className="btn" onClick={onClose}>取消</button><button className="btn primary" disabled={loading || !!error} onClick={save}>保存图片</button></footer>
    </dialog>, document.body,
  );
}

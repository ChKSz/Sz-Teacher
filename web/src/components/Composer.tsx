import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { ArrowUp, Camera, ImagePlus, Square, X } from 'lucide-react';
import { compressImage } from '../api.ts';

const MAX_IMAGES = 4;

export function Composer(props: {
  busy: boolean;
  isFollowUp: boolean;
  onSend: (text: string, images: string[]) => Promise<void>;
  onStop: () => void;
}) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const [localError, setLocalError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const addFiles = async (files: File[]) => {
    const picked = files.filter((f) => f.type.startsWith('image/'));
    if (!picked.length) return;
    setLocalError('');
    if (images.length + picked.length > MAX_IMAGES) {
      setLocalError(`一次最多 ${MAX_IMAGES} 张图片`);
      return;
    }
    setProcessing(true);
    try {
      const urls = await Promise.all(picked.map((f) => compressImage(f)));
      setImages((prev) => [...prev, ...urls].slice(0, MAX_IMAGES));
    } catch {
      setLocalError('图片读取失败，换一张试试');
    } finally {
      setProcessing(false);
    }
  };

  const submit = async () => {
    if (props.busy || processing) return;
    const trimmed = text.trim();
    if (!trimmed && images.length === 0) return;
    const sentText = text;
    const sentImages = images;
    setText('');
    setImages([]);
    try {
      await props.onSend(trimmed, sentImages);
    } catch {
      // 发送失败时把内容放回去，方便重试
      setText((cur) => cur || sentText);
      setImages((cur) => (cur.length ? cur : sentImages));
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (files.some((f) => f.type.startsWith('image/'))) {
      e.preventDefault();
      void addFiles(files);
    }
  };

  const canSend = !processing && (text.trim() !== '' || images.length > 0);

  return (
    <div className="composer">
      <div className="composer-box">
        {(images.length > 0 || processing) && (
          <div className="composer-images">
            {images.map((url, i) => (
              <div key={i} className="thumb">
                <img src={url} alt={`待发送图片 ${i + 1}`} />
                <button className="thumb-remove" onClick={() => setImages(images.filter((_, j) => j !== i))} aria-label="移除图片">
                  <X size={12} />
                </button>
              </div>
            ))}
            {processing && (
              <div className="thumb loading">
                <span className="spinner" />
              </div>
            )}
          </div>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          rows={1}
          placeholder={props.isFollowUp ? '继续追问，比如“第二步为什么？”' : '输入题目，或粘贴、拍照上传图片'}
          aria-label="输入题目"
        />
        <div className="composer-row">
          <button className="icon-btn" onClick={() => cameraRef.current?.click()} title="拍照" aria-label="拍照">
            <Camera size={18} />
          </button>
          <button className="icon-btn" onClick={() => fileRef.current?.click()} title="选择图片" aria-label="选择图片">
            <ImagePlus size={18} />
          </button>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              void addFiles(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void addFiles(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          <span className="composer-hint">Enter 发送 · Shift+Enter 换行</span>
          {props.busy ? (
            <button className="send-btn stop" onClick={props.onStop} aria-label="停止" title="停止生成">
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button className="send-btn" onClick={() => void submit()} disabled={!canSend} aria-label="发送" title="发送">
              <ArrowUp size={18} />
            </button>
          )}
        </div>
      </div>
      {localError && <p className="error-text small composer-error">{localError}</p>}
    </div>
  );
}

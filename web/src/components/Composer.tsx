import { useImperativeHandle, useRef, useState, type Ref, type ClipboardEvent, type KeyboardEvent } from 'react';
import { ArrowUp, Camera, ImagePlus, Sigma, Square, X } from 'lucide-react';
import { compressImage } from '../api.ts';
import { ImageEditor } from './ImageEditor.tsx';
import type { PublicSettings, SettingsUpdate } from '../../../shared/types.ts';
import { ModelMenu } from './ModelMenu.tsx';
import { renderMarkdown } from '../markdown.ts';

const MAX_IMAGES = 4;
export interface ComposerHandle {
  pickImages: (camera: boolean) => void;
  insertText: (text: string) => void;
}

export function Composer(props: {
  ref?: Ref<ComposerHandle>;
  busy: boolean;
  isFollowUp: boolean;
  onSend: (text: string, images: string[]) => Promise<void>;
  onStop: () => void;
  settings: PublicSettings | null;
  onPreferences: (patch: SettingsUpdate) => Promise<boolean>;
  onSettings: () => void;
  styleBusy: boolean;
}) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const [localError, setLocalError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const submittingRef = useRef(false);
  const processingRef = useRef(false);
  const [editingImage, setEditingImage] = useState<number | null>(null);
  const [mathOpen, setMathOpen] = useState(false);
  const insertFormula = (template: string) => {
    const field = textRef.current;
    const start = field?.selectionStart ?? text.length;
    const end = field?.selectionEnd ?? start;
    const formula = template.replace('□', text.slice(start, end) || 'x');
    setText(text.slice(0, start) + formula + text.slice(end));
    requestAnimationFrame(() => { field?.focus(); field?.setSelectionRange(start, start + formula.length); });
  };

  useImperativeHandle(props.ref, () => ({
    pickImages: (camera) => (camera ? cameraRef : fileRef).current?.click(),
    insertText: (value) => { setText((current) => current ? `${current}\n${value}` : value); textRef.current?.focus(); },
  }), []);

  const addFiles = async (files: File[]) => {
    if (processingRef.current) return;
    const picked = files.filter((f) => f.type.startsWith('image/'));
    if (!picked.length) return;
    setLocalError('');
    if (images.length + picked.length > MAX_IMAGES) {
      setLocalError(`一次最多 ${MAX_IMAGES} 张图片`);
      return;
    }
    setProcessing(true);
    processingRef.current = true;
    try {
      const urls = await Promise.all(picked.map((f) => compressImage(f)));
      setImages((prev) => [...prev, ...urls].slice(0, MAX_IMAGES));
    } catch {
      setLocalError('图片读取失败，换一张试试');
    } finally {
      setProcessing(false);
      processingRef.current = false;
    }
  };

  const submit = async () => {
    if (props.busy || processing || props.styleBusy || submittingRef.current || editingImage !== null) return;
    const trimmed = text.trim();
    if (!trimmed && images.length === 0) return;
    const sentText = text;
    const sentImages = images;
    submittingRef.current = true;
    setText('');
    setImages([]);
    try {
      await props.onSend(trimmed, sentImages);
    } catch {
      // 发送失败时把内容放回去，方便重试
      setText((cur) => cur || sentText);
      setImages((cur) => (cur.length ? cur : sentImages));
    } finally {
      submittingRef.current = false;
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

  const canSend = !processing && !props.styleBusy && (text.trim() !== '' || images.length > 0);

  return (
    <div className="composer">
      <div className="composer-box">
        {(images.length > 0 || processing) && (
          <div className="composer-images">
            {images.map((url, i) => (
              <div key={i} className="thumb">
                <button className="thumb-edit" onClick={() => setEditingImage(i)} aria-label={`编辑图片 ${i + 1}`} title="放大、旋转或裁剪"><img src={url} alt={`待发送图片 ${i + 1}`} /></button>
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
          ref={textRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          rows={1}
          placeholder={props.isFollowUp ? '继续追问，比如“第二步为什么？”' : '输入题目，或粘贴、拍照上传图片'}
          aria-label="输入题目"
        />
        {mathOpen && <div className="math-tools">
          <div className="formula-shortcuts" role="group" aria-label="插入公式">
            {[['行内公式', '$□$'], ['独立公式', '$$□$$'], ['分数', '$\\frac{□}{b}$'], ['根号', '$\\sqrt{□}$'], ['平方', '$□^2$']].map(([label, value]) => <button key={label} onClick={() => insertFormula(value!)}>{label}</button>)}
          </div>
          <div className="math-preview markdown" aria-label="公式预览" dangerouslySetInnerHTML={{ __html: text.trim() ? renderMarkdown(text) : '<span class="muted">输入 LaTeX 公式，预览会显示在这里。</span>' }} />
        </div>}
        <div className="composer-row">
          <button className="icon-btn" onClick={() => cameraRef.current?.click()} title="拍照" aria-label="拍照">
            <Camera size={18} />
          </button>
          <button className="icon-btn" onClick={() => fileRef.current?.click()} title="选择图片" aria-label="选择图片">
            <ImagePlus size={18} />
          </button>
          <button className={`icon-btn ${mathOpen ? 'active' : ''}`} onClick={() => setMathOpen(!mathOpen)} aria-label="公式输入与预览" aria-expanded={mathOpen} title="LaTeX 公式输入与预览"><Sigma size={18} /></button>
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
          <div className="composer-spacer" />
          <ModelMenu settings={props.settings} busy={props.busy || props.styleBusy} onChange={props.onPreferences} onSettings={props.onSettings} />
          {images.length > 0 && <span className="image-count">{images.length}/{MAX_IMAGES} 张 · 点击图片编辑</span>}
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
      {editingImage !== null && images[editingImage] && <ImageEditor source={images[editingImage]} onClose={() => setEditingImage(null)} onSave={(source) => { setImages((list) => list.map((url, i) => i === editingImage ? source : url)); setEditingImage(null); }} />}
    </div>
  );
}

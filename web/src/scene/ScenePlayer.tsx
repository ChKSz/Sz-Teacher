import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, CircleCheck, Hand, Maximize, Minimize, Pause, Play, RotateCcw, SkipBack, StepBack, StepForward, Volume2, VolumeX } from 'lucide-react';
import { SceneCanvas } from './SceneCanvas.tsx';
import { buildTimeline, ease, initialVisible } from './timeline.ts';
import { computeScene, defaultParams, interpolate, formatNumber } from '../../../shared/scene/engine.ts';
import type { Scene } from '../../../shared/scene/types.ts';
import { renderMarkdown } from '../markdown.ts';
import { speak, speechSupported, unlockSpeech, type SpeakHandle } from '../speech.ts';
import { usePreparedSpeech } from '../usePreparedSpeech.ts';
import type { SpeechOptions } from '../../../shared/types.ts';
import { Range } from '../components/Range.tsx';

interface Props {
  scene: Scene;
  tts: SpeechOptions;
  /** 验算结果提示（来自服务器）。 */
  verified?: boolean | null;
  /** 对当前步骤追问；不提供时不显示追问按钮。 */
  onAsk?: (stepNo: number, stepText: string) => void;
}

/**
 * 讲解播放器。
 * - 每一步：显示文字、执行动画、朗读 say。
 * - 自动播放时，动画和朗读都结束后进入下一步。
 * - 任何时候都可以拖动参数滑块"自己试试"，按下一步时恢复剧本状态。
 */
export function ScenePlayer({ scene, tts, verified, onAsk }: Props) {
  const timeline = useMemo(() => buildTimeline(scene), [scene]);
  const [stepIndex, setStepIndex] = useState(-1);
  const [params, setParams] = useState<Record<string, number>>(() => defaultParams(scene));
  const [playing, setPlaying] = useState(false);
  const [voiceOn, setVoiceOn] = useState(() => speechSupported(tts));
  const [speechError, setSpeechError] = useState('');
  const prepared = usePreparedSpeech(scene.steps.map((step) => step.say), tts);
  useEffect(() => { setVoiceOn(speechSupported(tts)); }, [tts.provider]);
  const [animating, setAnimating] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [freeMode, setFreeMode] = useState(false);
  const [paused, setPaused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const playerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const speechRef = useRef<SpeakHandle | null>(null);
  const speechAbortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);

  const state = stepIndex >= 0 ? timeline[stepIndex] : undefined;
  const visible = state?.visible ?? initialVisible(scene);
  const highlighted = freeMode ? new Set<string>() : (state?.highlighted ?? new Set<string>());
  const step = stepIndex >= 0 ? scene.steps[stepIndex] : undefined;

  const stopMedia = useCallback(() => {
    // 让仍在等待声音列表的旧朗读失效。
    runIdRef.current += 1;
    cancelAnimationFrame(rafRef.current);
    speechAbortRef.current?.abort();
    speechRef.current?.stop();
    speechRef.current = null;
    setAnimating(false);
    setSpeaking(false);
  }, []);

  useEffect(() => stopMedia, [stopMedia]);
  useEffect(() => { stopMedia(); setPlaying(false); setPaused(false); setSpeechError(''); }, [prepared.key, stopMedia]);

  useEffect(() => {
    if (!expanded) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    playerRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
      if (event.key === 'Tab') {
        const items = playerRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, summary');
        if (!items?.length) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (event.shiftKey && (document.activeElement === first || document.activeElement === playerRef.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = overflow; window.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [expanded]);

  // 换了剧本就回到开头
  useEffect(() => {
    stopMedia();
    setStepIndex(-1);
    setParams(defaultParams(scene));
    setPlaying(false);
    setFreeMode(false);
    setPaused(false);
  }, [scene, stopMedia]);

  /** 进入第 i 步：设置起始参数，播放动画和朗读。 */
  const enterStep = useCallback(
    (i: number, withMedia: boolean) => {
      stopMedia();
      const runId = ++runIdRef.current;
      setFreeMode(false);
      setPaused(false);
      setStepIndex(i);
      const s = timeline[i];
      if (!s) return;
      if (!withMedia) {
        setParams(s.after);
        return;
      }
      setParams(s.before);

      // 动画：依次执行
      if (s.animations.length) {
        setAnimating(true);
        let k = 0;
        let start = performance.now();
        let current = { ...s.before };
        const tick = (now: number) => {
          if (runIdRef.current !== runId) return;
          const anim = s.animations[k]!;
          const progress = anim.duration === 0 ? 1 : Math.min(1, (now - start) / (anim.duration * 1000));
          current = { ...current, [anim.param]: anim.from + (anim.to - anim.from) * ease(progress) };
          setParams(current);
          if (progress >= 1) {
            k += 1;
            start = now;
            if (k >= s.animations.length) {
              setParams(s.after);
              setAnimating(false);
              return;
            }
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setParams(s.after);
      }

      // 朗读
      const say = scene.steps[i]?.say;
      if (voiceOn && say && speechSupported(tts)) {
        setSpeechError('');
        setSpeaking(true);
        const abort = new AbortController();
        speechAbortRef.current = abort;
        speak(say, tts, abort.signal, prepared.clips[i])
          .then((h) => {
            if (runIdRef.current !== runId) {
              h.stop();
              return;
            }
            speechRef.current = h;
            return h.finished;
          })
          .catch((err: Error) => { if (runIdRef.current === runId) { setSpeechError(err.message); setVoiceOn(false); setPlaying(false); } })
          .finally(() => {
            if (runIdRef.current === runId) setSpeaking(false);
          });
      }
    },
    [scene, stopMedia, timeline, tts, voiceOn, prepared.clips],
  );

  // 自动播放：本步动画和朗读都结束后，稍作停顿进入下一步
  useEffect(() => {
    if (!playing || animating || speaking) return;
    if (stepIndex >= scene.steps.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => enterStep(stepIndex + 1, true), stepIndex < 0 ? 0 : voiceOn ? 500 : 1400);
    return () => clearTimeout(timer);
  }, [playing, animating, speaking, stepIndex, scene.steps.length, enterStep, voiceOn]);

  const togglePlay = () => {
    if (tts.provider === 'xiaomi') unlockSpeech();
    if (playing) {
      setPlaying(false);
      setPaused(stepIndex >= 0);
      stopMedia();
      return;
    }
    if ((paused || freeMode) && stepIndex >= 0) {
      enterStep(stepIndex, true);
    } else if (stepIndex >= scene.steps.length - 1) {
      setStepIndex(-1);
      setParams(defaultParams(scene));
    }
    setPlaying(true);
  };

  const go = (i: number) => {
    if (tts.provider === 'xiaomi') unlockSpeech();
    setPlaying(false);
    setPaused(false);
    if (i < 0) {
      stopMedia();
      setStepIndex(-1);
      setParams(defaultParams(scene));
      return;
    }
    enterStep(Math.min(i, scene.steps.length - 1), true);
  };

  const replay = () => {
    setPlaying(false);
    if (stepIndex >= 0) enterStep(stepIndex, true);
  };

  const onSlide = (name: string, value: number) => {
    setPlaying(false);
    stopMedia();
    setFreeMode(true);
    setPaused(false);
    setParams((p) => ({ ...p, [name]: value }));
  };

  const { points } = useMemo(() => computeScene(scene, params, { traceSamples: 0 }), [scene, params]);
  const readouts = (scene.readouts ?? []).map((r) => interpolate(r, scene, params, points));
  const stepHtml = useMemo(() => (step ? renderMarkdown(step.text ?? step.say) : ''), [step]);

  if (tts.provider === 'xiaomi' && voiceOn && !prepared.ready) {
    return <div className="scene-player scene-audio-loading" aria-busy={prepared.preparing}>
      <div className="scene-title">{scene.title}</div>
      {prepared.preparing ? <div className="scene-working" role="status"><span className="spinner" /><span>正在准备整段动画语音…<small className="scene-wait-hint muted">已准备 {prepared.completed}/{prepared.total} 步，全部就绪后即可连续播放</small></span></div> : <p className="error-text small" role="alert">{prepared.error}</p>}
      <div className="row">{prepared.error && <button className="btn" onClick={prepared.retry}>重试准备语音</button>}<button className="link-btn" onClick={() => setVoiceOn(false)}>先看无声动画</button></div>
    </div>;
  }

  const content = (
    <div className={`scene-player ${expanded ? 'scene-fullscreen' : ''}`} ref={playerRef} tabIndex={expanded ? -1 : undefined} role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined} aria-label={expanded ? '全屏动画讲解' : undefined}>
      <div className="scene-head">
        <span className="scene-title">{scene.title}</span>
        <button className="icon-btn" onClick={() => setExpanded(!expanded)} aria-label={expanded ? '退出全屏' : '全屏看图'} title={expanded ? '退出全屏' : '全屏看图'}>
          {expanded ? <Minimize size={18} /> : <Maximize size={18} />}
        </button>
        {verified === true && <span className="badge ok" title="程序已把结论代回图形验算">
            <CircleCheck size={13} aria-hidden="true" />
            已验算
          </span>}
        {verified === false && <span className="badge warn" title="部分结论与图形不符，请谨慎参考">
            <CircleAlert size={13} aria-hidden="true" />
            验算未通过
          </span>}
      </div>
      <div className="scene-stage">
        <SceneCanvas scene={scene} params={params} visible={visible} highlighted={highlighted} />
        {readouts.length > 0 && (
          <div className="readouts" aria-label="实时数值">
            {readouts.map((r, i) => (
              <div key={i}>{r}</div>
            ))}
          </div>
        )}
      </div>

      <div className="scene-caption" aria-live="polite">
        {step ? (
          <>
            <span className="step-no" aria-label={`第 ${stepIndex + 1}/${scene.steps.length} 步`}>
              <span className="step-no-cur">{String(stepIndex + 1).padStart(2, '0')}</span>
              <span className="step-no-total">/{String(scene.steps.length).padStart(2, '0')}</span>
              <span className="sr-only">第 {stepIndex + 1}/{scene.steps.length} 步</span>
            </span>
            <div className="markdown" dangerouslySetInnerHTML={{ __html: stepHtml }} />
            {onAsk && step && (
              <button
                className="ask-btn"
                onClick={() => {
                  setPlaying(false);
                  setPaused(true);
                  setExpanded(false);
                  stopMedia();
                  onAsk(stepIndex + 1, step.text ?? step.say);
                }}
                title="就这一步提问"
              >
                <Hand size={14} aria-hidden="true" />
                这步没懂
              </button>
            )}
          </>
        ) : (
          <span className="muted">点“讲解”开始，也可以拖动下面的滑块自己观察。</span>
        )}
      </div>

      {(scene.params ?? []).map((p) => (
        <label key={p.name} className="param-slider">
          <span>{p.label ?? p.name}</span>
          <Range
            min={p.min}
            max={p.max}
            step={(p.max - p.min) / 400}
            value={params[p.name] ?? p.min}
            onChange={(e) => onSlide(p.name, Number(e.target.value))}
            aria-label={p.label ?? p.name}
          />
          <span className="param-value">
            {p.name} = {formatNumber(Math.round((params[p.name] ?? p.min) * 100) / 100)}
          </span>
        </label>
      ))}

      <div className="scene-controls">
        <button className="icon-btn" onClick={() => go(-1)} title="回到开头" aria-label="回到开头">
          <SkipBack size={17} />
        </button>
        <button className="icon-btn" onClick={() => go(stepIndex - 1)} disabled={stepIndex <= 0} title="上一步" aria-label="上一步">
          <StepBack size={17} />
        </button>
        <button className="btn primary play-btn" onClick={togglePlay} aria-label={playing ? '暂停' : paused ? '重播本步并继续' : '播放'} title={paused ? '重播当前步骤，再继续后面的讲解' : undefined}>
          {playing ? <Pause size={15} fill="currentColor" aria-hidden="true" /> : stepIndex >= scene.steps.length - 1 ? <RotateCcw size={15} aria-hidden="true" /> : <Play size={15} fill="currentColor" aria-hidden="true" />}
          {playing ? '暂停' : paused ? '重播本步并继续' : stepIndex >= scene.steps.length - 1 ? '重新讲' : '讲解'}
        </button>
        <button
          className="icon-btn"
          onClick={() => go(stepIndex + 1)}
          disabled={stepIndex >= scene.steps.length - 1}
          title="下一步"
          aria-label="下一步"
        >
          <StepForward size={17} />
        </button>
        <button className="icon-btn" onClick={replay} disabled={stepIndex < 0} title="重播这一步" aria-label="重播这一步">
          <RotateCcw size={16} />
        </button>
        {speechSupported(tts) && (
          <button
            className={`icon-btn ${voiceOn ? '' : 'off'}`}
            onClick={() => {
              if (voiceOn) {
                speechAbortRef.current?.abort();
                speechRef.current?.stop();
                setSpeaking(false);
              }
              setVoiceOn(!voiceOn);
            }}
            title={voiceOn ? '关闭朗读' : '打开朗读'}
            aria-label={voiceOn ? '关闭朗读' : '打开朗读'}
          >
            {voiceOn ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>
        )}
        <div className="step-dots" role="tablist" aria-label="步骤">
          {scene.steps.map((_, i) => (
            <button
              key={i}
              className={`dot ${i === stepIndex ? 'active' : ''} ${i < stepIndex ? 'past' : ''}`}
              onClick={() => go(i)}
              aria-label={`第 ${i + 1} 步`}
              role="tab"
              aria-selected={i === stepIndex}
            />
          ))}
        </div>
      </div>
      {speechError && <p className="error-text small" role="alert">{speechError}。可以关闭朗读继续看图，或在设置中检查语音服务。</p>}
      <details className="step-directory">
        <summary>步骤目录 · {scene.steps.length} 步</summary>
        <ol>{scene.steps.map((item, i) => (
          <li key={i}><button className={stepIndex === i ? 'active' : ''} onClick={() => go(i)} aria-current={stepIndex === i ? 'step' : undefined}>
            <span>{i + 1}</span>{item.say.replace(/\s+/g, ' ').slice(0, 90)}
          </button></li>
        ))}</ol>
      </details>
    </div>
  );
  return expanded ? createPortal(content, document.body) : content;
}

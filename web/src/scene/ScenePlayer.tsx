import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, CircleCheck, Ellipsis, Hand, Maximize, Minimize, Pause, Play, RotateCcw, StepBack, StepForward, Volume2, VolumeX } from 'lucide-react';
import { SceneViewport } from './SceneViewport.tsx';
import { INITIAL_CAMERA, type Camera } from './camera.ts';
import { liveReadoutTemplates, stepAnnotations } from './annotations.ts';
import { focusedVisible } from './focus.ts';
import { mathTextRuns } from './labelLayout.ts';
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
  const [completed, setCompleted] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [speechError, setSpeechError] = useState('');
  const prepared = usePreparedSpeech(scene.steps.map((step) => step.say), tts);
  useEffect(() => { setVoiceOn(true); }, [tts.provider]);
  const [animating, setAnimating] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [freeMode, setFreeMode] = useState(false);
  const [paused, setPaused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [camera, setCamera] = useState(INITIAL_CAMERA);
  const [zoomFrame, setZoomFrame] = useState<Set<string> | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [captionCollapsed, setCaptionCollapsed] = useState(false);
  const playerRef = useRef<HTMLDivElement>(null);
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null);
  const optionsRef = useRef<HTMLDetailsElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const transitionRef = useRef<{ timer?: ReturnType<typeof setTimeout>; remaining: number; started: number } | null>(null);
  const rafRef = useRef(0);
  const motionRef = useRef<{ tick: FrameRequestCallback; pausedAt: number | null; held: number } | null>(null);
  const speechRef = useRef<SpeakHandle | null>(null);
  const speechAbortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);

  const state = stepIndex >= 0 ? timeline[stepIndex] : undefined;
  const initialObjects = useMemo(() => initialVisible(scene), [scene]);
  const visible = state?.visible ?? initialObjects;
  const highlighted = useMemo(() => freeMode ? new Set<string>() : (state?.highlighted ?? new Set<string>()), [state, freeMode]);
  const step = stepIndex >= 0 ? scene.steps[stepIndex] : undefined;
  const displayed = useMemo(() => focusMode && !freeMode ? focusedVisible(scene, visible, highlighted, stepIndex) : visible, [focusMode, freeMode, scene, visible, highlighted, stepIndex]);
  const annotations = useMemo(() => stepAnnotations(step, highlighted), [step, highlighted]);
  const changeCamera = useCallback((next: Camera) => {
    setZoomFrame(frame => next.zoom > 1 ? frame ?? displayed : null);
    setCamera(next);
  }, [displayed]);

  const stopMedia = useCallback(() => {
    // Invalidate callbacks when leaving a step, but never on a temporary pause.
    runIdRef.current += 1;
    pausedRef.current = false;
    cancelAnimationFrame(rafRef.current);
    motionRef.current = null;
    clearTimeout(transitionRef.current?.timer);
    transitionRef.current = null;
    speechAbortRef.current?.abort();
    speechAbortRef.current = null;
    speechRef.current?.stop();
    speechRef.current = null;
    setPaused(false);
    setAnimating(false);
    setSpeaking(false);
  }, []);

  const pauseMedia = useCallback(() => {
    pausedRef.current = true;
    setPaused(true);
    cancelAnimationFrame(rafRef.current);
    if (motionRef.current) motionRef.current.pausedAt = performance.now();
    const transition = transitionRef.current;
    if (transition?.timer !== undefined) {
      clearTimeout(transition.timer);
      transition.timer = undefined;
      transition.remaining = Math.max(0, transition.remaining - (performance.now() - transition.started));
    }
    speechRef.current?.pause();
  }, []);

  const resumeMedia = () => {
    pausedRef.current = false;
    setPaused(false);
    const motion = motionRef.current;
    if (motion && motion.pausedAt !== null) {
      motion.held += performance.now() - motion.pausedAt;
      motion.pausedAt = null;
      rafRef.current = requestAnimationFrame(motion.tick);
    }
    speechRef.current?.resume();
  };

  useEffect(() => {
    const rail = progressRef.current;
    const active = rail?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!rail || !active || rail.scrollWidth <= rail.clientWidth) return;
    const viewport = rail.getBoundingClientRect();
    const button = active.getBoundingClientRect();
    // Keep the active marker in view without scrolling the canvas or chat.
    if (button.left < viewport.left) rail.scrollLeft += button.left - viewport.left;
    else if (button.right > viewport.right) rail.scrollLeft += button.right - viewport.right;
  }, [stepIndex, expanded]);

  useEffect(() => stopMedia, [stopMedia]);
  useEffect(() => { stopMedia(); setPlaying(false); setPaused(false); setSpeechError(''); }, [prepared.key, stopMedia]);

  useEffect(() => {
    if (!expanded) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    playerRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (optionsRef.current?.open) {
          optionsRef.current.open = false;
          optionsRef.current.querySelector('summary')?.focus();
        } else setExpanded(false);
      }
      if (event.key === 'Tab') {
        const items = Array.from(playerRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, summary, [tabindex="0"]') ?? [])
          .filter(item => item.getClientRects().length > 0);
        if (!items.length) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (event.shiftKey && (document.activeElement === first || document.activeElement === playerRef.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = overflow; window.removeEventListener('keydown', onKey); fullscreenButtonRef.current?.focus({ preventScroll: true }); };
  }, [expanded]);

  // 换了剧本就回到开头
  useEffect(() => {
    setCamera(INITIAL_CAMERA);
    setZoomFrame(null);
    setCaptionCollapsed(false);
    stopMedia();
    setStepIndex(-1);
    setParams(defaultParams(scene));
    setPlaying(false);
    setCompleted(false);
    setFreeMode(false);
    setPaused(false);
  }, [scene, stopMedia]);

  /** 进入第 i 步：设置起始参数，播放动画和朗读。 */
  const enterStep = useCallback(
    (i: number) => {
      stopMedia();
      setCompleted(false);
      const runId = ++runIdRef.current;
      setFreeMode(false);
      setPaused(false);
      setStepIndex(i);
      const s = timeline[i];
      if (!s) return;
      setSpeechError('');
      setParams(s.before);

      // 动画：依次执行
      if (s.animations.length) {
        setAnimating(true);
        let k = 0;
        let start = performance.now();
        let current = { ...s.before };
        const tick = (now: number) => {
          const motion = motionRef.current;
          if (runIdRef.current !== runId || !motion || pausedRef.current) return;
          const elapsed = now - start - motion.held;
          const anim = s.animations[k]!;
          const progress = anim.duration === 0 ? 1 : Math.max(0, Math.min(1, elapsed / (anim.duration * 1000)));
          current = { ...current, [anim.param]: anim.from + (anim.to - anim.from) * ease(progress) };
          setParams(current);
          if (progress >= 1) {
            k += 1;
            start = now;
            motion.held = 0;
            if (k >= s.animations.length) {
              motionRef.current = null;
              setParams(s.after);
              setAnimating(false);
              return;
            }
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        motionRef.current = { tick, pausedAt: null, held: 0 };
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setParams(s.after);
      }

      // 朗读
      const say = scene.steps[i]?.say;
      if (voiceOn && say?.trim()) {
        if (!speechSupported(tts)) {
          setSpeechError('此浏览器没有可用的朗读功能');
          setPlaying(false);
          pauseMedia();
          return;
        }
        setSpeaking(true);
        const abort = new AbortController();
        speechAbortRef.current = abort;
        speak(say, tts, abort.signal, prepared.clips[i])
          .then((h) => {
            if (runIdRef.current !== runId) {
              h.stop();
              return h.finished;
            }
            speechRef.current = h;
            if (pausedRef.current) h.pause();
            return h.finished;
          })
          .catch((err: Error) => {
            if (runIdRef.current !== runId) return;
            setSpeechError(err.message);
            setPlaying(false);
            pauseMedia();
          })
          .finally(() => {
            if (runIdRef.current === runId) {
              speechRef.current = null;
              speechAbortRef.current = null;
              setSpeaking(false);
            }
          });
      }
    },
    [scene, stopMedia, pauseMedia, timeline, tts, voiceOn, prepared.clips],
  );

  // 自动播放：本步动画和朗读都结束后，稍作停顿进入下一步
  useEffect(() => {
    if (!playing || animating || speaking) return;
    if (stepIndex >= scene.steps.length - 1) {
      setPlaying(false);
      setCompleted(true);
      return;
    }
    const text = scene.steps[stepIndex]?.text ?? scene.steps[stepIndex]?.say ?? '';
    const readTime = Math.max(3000, Math.min(12_000, text.length * 180));
    const transition = transitionRef.current ?? { remaining: voiceOn ? 350 : readTime, started: 0 };
    transitionRef.current = transition;
    transition.started = performance.now();
    const runId = runIdRef.current;
    transition.timer = setTimeout(() => {
      if (runIdRef.current === runId && !pausedRef.current) enterStep(stepIndex + 1);
    }, transition.remaining);
    return () => {
      if (transition.timer === undefined) return;
      clearTimeout(transition.timer);
      transition.timer = undefined;
      transition.remaining = Math.max(0, transition.remaining - (performance.now() - transition.started));
    };
  }, [playing, animating, speaking, stepIndex, scene.steps, enterStep, voiceOn]);

  const togglePlay = () => {
    if (playing || (!paused && (speaking || animating))) {
      setPlaying(false);
      pauseMedia();
      return;
    }
    if (!scene.steps.length) return;
    setPlaying(true);
    if (paused && !speechError) {
      resumeMedia();
      return;
    }
    if (voiceOn && tts.provider === 'xiaomi') unlockSpeech();
    // Start aloud inside the click; on failure the retry explicitly starts this step again.
    enterStep(completed || stepIndex < 0 ? 0 : stepIndex);
  };

  const go = (i: number) => {
    setPlaying(false);
    setPaused(false);
    if (i < 0) {
      stopMedia();
      setCompleted(false);
      setSpeechError('');
      setFreeMode(false);
      setStepIndex(-1);
      setParams(defaultParams(scene));
      return;
    }
    if (voiceOn && tts.provider === 'xiaomi') unlockSpeech();
    enterStep(Math.min(i, scene.steps.length - 1));
  };

  const replay = () => {
    setPlaying(false);
    if (stepIndex >= 0) {
      if (voiceOn && tts.provider === 'xiaomi') unlockSpeech();
      enterStep(stepIndex);
    }
  };

  const onSlide = (name: string, value: number) => {
    setPlaying(false);
    stopMedia();
    setFreeMode(true);
    setPaused(false);
    setCompleted(false);
    setParams((p) => ({ ...p, [name]: value }));
  };

  const toggleVoice = () => {
    if ((playing || speaking || animating) && !pausedRef.current) pauseMedia();
    setPlaying(false);
    speechAbortRef.current?.abort();
    speechAbortRef.current = null;
    speechRef.current?.stop();
    speechRef.current = null;
    setSpeaking(false);
    // Retry a failed narration when it is enabled again, not when going silent.
    if (!voiceOn && pausedRef.current) {
      stopMedia();
    }
    setSpeechError('');
    setVoiceOn(!voiceOn);
  };
  const mediaRunning = playing || (!paused && (speaking || animating));
  const playLabel = mediaRunning ? '暂停' : speechError ? '重试朗读' : paused ? '继续' : !voiceOn ? '无声播放' : completed ? '重新讲' : '开始讲解';

  const readoutTemplates = useMemo(() => liveReadoutTemplates(scene, displayed), [scene, displayed]);
  const readouts = useMemo(() => {
    if (!readoutTemplates.length) return [];
    const { points } = computeScene(scene, params, { traceSamples: 0 });
    return [...new Set(readoutTemplates.map(r => interpolate(r, scene, params, points)))].slice(0, 2);
  }, [scene, params, readoutTemplates]);
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
        <button ref={fullscreenButtonRef} className="icon-btn" onClick={() => setExpanded(!expanded)} aria-label={expanded ? '退出全屏' : '全屏看图'} title={expanded ? '退出全屏' : '全屏看图'}>
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
      <div className="scene-main" tabIndex={expanded ? 0 : undefined} aria-label={expanded ? '图形与讲解内容' : undefined}>
      <div className="scene-stage">
        <SceneViewport scene={scene} params={params} visible={displayed} highlighted={highlighted} annotations={annotations} frameVisible={zoomFrame ?? displayed} camera={camera} onCamera={changeCamera} />
        {readouts.length > 0 && (
          <div className="readouts" aria-label="实时数值">
            {readouts.map((r, i) => (
              <div key={i}>{mathTextRuns(r.replace(/'/g, '′')).map((run, index) => <span key={index} style={{ fontStyle: run.italic ? 'italic' : 'normal' }}>{run.text}</span>)}</div>
            ))}
          </div>
        )}
      </div>

      {step && <div className={`scene-caption ${expanded && captionCollapsed ? 'is-collapsed' : ''}`}>
        <div className="markdown" dangerouslySetInnerHTML={{ __html: stepHtml }} />
        {onAsk && (
          <button
            className="ask-btn"
            onClick={() => {
              if (!pausedRef.current) pauseMedia();
              setPlaying(false);
              setExpanded(false);
              onAsk(stepIndex + 1, step.text ?? step.say);
            }}
            title="就这一步提问"
          >
            <Hand size={14} aria-hidden="true" />
            这步没懂
          </button>
        )}
      </div>}

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

      {speechError && <div className="scene-error" role="alert">
        <p className="error-text small">{speechError}。已停在当前步骤。</p>
        <button className="link-btn" onClick={() => { setVoiceOn(false); setSpeechError(''); }}>改为无声播放</button>
      </div>}
      </div>

      <div className="scene-footer">
      <div className="scene-controls">
        <button className="icon-btn" onClick={() => go(stepIndex - 1)} disabled={stepIndex <= 0} title="上一步" aria-label="上一步">
          <StepBack size={17} />
        </button>
        <button className="btn primary play-btn" onClick={togglePlay} aria-label={playLabel}>
          {mediaRunning ? <Pause size={15} fill="currentColor" aria-hidden="true" /> : completed ? <RotateCcw size={15} aria-hidden="true" /> : <Play size={15} fill="currentColor" aria-hidden="true" />}
          {playLabel}
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
        <details className="scene-options" ref={optionsRef} onBlur={event => {
          if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
        }}>
          <summary aria-label="播放选项" title="播放选项"><Ellipsis size={20} aria-hidden="true" /></summary>
          <div className="scene-options-menu" onClick={event => {
            if ((event.target as HTMLElement).closest('button')) {
              optionsRef.current!.open = false;
              optionsRef.current!.querySelector('summary')?.focus({ preventScroll: true });
            }
          }}>
            <button onClick={toggleVoice}>{voiceOn ? <Volume2 size={16} /> : <VolumeX size={16} />}{voiceOn ? '关闭朗读' : '打开朗读'}</button>
            <button onClick={() => go(-1)} disabled={stepIndex < 0}>回到开头</button>
            <button onClick={replay} disabled={stepIndex < 0}>重播这一步</button>
            {step && <button aria-pressed={focusMode} onClick={() => setFocusMode(!focusMode)}>{focusMode ? '完整图形' : '仅看本步重点'}</button>}
            {step && expanded && <button aria-pressed={captionCollapsed} onClick={() => setCaptionCollapsed(!captionCollapsed)}>{captionCollapsed ? '展开讲解文字' : '收起讲解文字'}</button>}
            <details className="step-directory">
              <summary>跳到指定步骤</summary>
              <ol>{scene.steps.map((_, i) => (
                <li key={i}><button className={stepIndex === i ? 'active' : ''} onClick={() => go(i)} aria-current={stepIndex === i ? 'step' : undefined}>第 {i + 1} 步</button></li>
              ))}</ol>
            </details>
          </div>
        </details>
      </div>
      <div className="scene-progress">
        <div className="step-dots" ref={progressRef} role="tablist" aria-label="步骤">
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
        <span className="scene-progress-count step-no">
          <span aria-hidden="true">
            <span className="step-no-cur">{stepIndex + 1}</span><span className="step-no-total">/{scene.steps.length}</span>
          </span>
          <span className="sr-only">第 {stepIndex + 1}/{scene.steps.length} 步</span>
        </span>
      </div>
      </div>
    </div>
  );
  return expanded ? createPortal(content, document.body) : content;
}

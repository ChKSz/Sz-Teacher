import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SceneCanvas } from './SceneCanvas.tsx';
import { buildTimeline, ease, initialVisible } from './timeline.ts';
import { computeScene, defaultParams, interpolate, formatNumber } from '../../../shared/scene/engine.ts';
import type { Scene } from '../../../shared/scene/types.ts';
import { renderMarkdown } from '../markdown.ts';
import { speak, speechSupported, type SpeakHandle } from '../speech.ts';

interface Props {
  scene: Scene;
  tts: { rate: number; voice: string };
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
  const [voiceOn, setVoiceOn] = useState(speechSupported());
  const [animating, setAnimating] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [freeMode, setFreeMode] = useState(false);
  const rafRef = useRef(0);
  const speechRef = useRef<SpeakHandle | null>(null);
  const runIdRef = useRef(0);

  const state = stepIndex >= 0 ? timeline[stepIndex] : undefined;
  const visible = state?.visible ?? initialVisible(scene);
  const highlighted = freeMode ? new Set<string>() : (state?.highlighted ?? new Set<string>());
  const step = stepIndex >= 0 ? scene.steps[stepIndex] : undefined;

  const stopMedia = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    speechRef.current?.stop();
    speechRef.current = null;
    setAnimating(false);
    setSpeaking(false);
  }, []);

  useEffect(() => stopMedia, [stopMedia]);

  // 换了剧本就回到开头
  useEffect(() => {
    stopMedia();
    setStepIndex(-1);
    setParams(defaultParams(scene));
    setPlaying(false);
    setFreeMode(false);
  }, [scene, stopMedia]);

  /** 进入第 i 步：设置起始参数，播放动画和朗读。 */
  const enterStep = useCallback(
    (i: number, withMedia: boolean) => {
      stopMedia();
      const runId = ++runIdRef.current;
      setFreeMode(false);
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
      if (voiceOn && say && speechSupported()) {
        setSpeaking(true);
        speak(say, tts)
          .then((h) => {
            if (runIdRef.current !== runId) {
              h.stop();
              return;
            }
            speechRef.current = h;
            return h.finished;
          })
          .finally(() => {
            if (runIdRef.current === runId) setSpeaking(false);
          });
      }
    },
    [scene, stopMedia, timeline, tts, voiceOn],
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
    if (playing) {
      setPlaying(false);
      stopMedia();
      return;
    }
    if (stepIndex >= scene.steps.length - 1) {
      setStepIndex(-1);
      setParams(defaultParams(scene));
    }
    setPlaying(true);
  };

  const go = (i: number) => {
    setPlaying(false);
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
    setParams((p) => ({ ...p, [name]: value }));
  };

  const { points } = useMemo(() => computeScene(scene, params, { traceSamples: 0 }), [scene, params]);
  const readouts = (scene.readouts ?? []).map((r) => interpolate(r, scene, params, points));
  const stepHtml = useMemo(() => (step ? renderMarkdown(step.text ?? step.say) : ''), [step]);

  return (
    <div className="scene-player">
      <div className="scene-head">
        <span className="scene-title">{scene.title}</span>
        {verified === true && <span className="badge ok" title="程序已把结论代回图形验算">✓ 已验算</span>}
        {verified === false && <span className="badge warn" title="部分结论与图形不符，请谨慎参考">⚠ 验算未通过</span>}
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
            <span className="step-no">
              第 {stepIndex + 1}/{scene.steps.length} 步
            </span>
            <div className="markdown" dangerouslySetInnerHTML={{ __html: stepHtml }} />
            {onAsk && step && (
              <button
                className="ask-btn"
                onClick={() => {
                  setPlaying(false);
                  stopMedia();
                  onAsk(stepIndex + 1, step.text ?? step.say);
                }}
                title="就这一步提问"
              >
                🙋 这步没懂
              </button>
            )}
          </>
        ) : (
          <span className="muted">点 ▶ 开始讲解，也可以拖动下面的滑块自己观察。</span>
        )}
      </div>

      {(scene.params ?? []).map((p) => (
        <label key={p.name} className="param-slider">
          <span>{p.label ?? p.name}</span>
          <input
            type="range"
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
          ⏮
        </button>
        <button className="icon-btn" onClick={() => go(stepIndex - 1)} disabled={stepIndex <= 0} title="上一步" aria-label="上一步">
          ◀
        </button>
        <button className="btn primary play-btn" onClick={togglePlay} aria-label={playing ? '暂停' : '播放'}>
          {playing ? '⏸ 暂停' : stepIndex >= scene.steps.length - 1 ? '↻ 重新讲' : '▶ 讲解'}
        </button>
        <button
          className="icon-btn"
          onClick={() => go(stepIndex + 1)}
          disabled={stepIndex >= scene.steps.length - 1}
          title="下一步"
          aria-label="下一步"
        >
          ▶
        </button>
        <button className="icon-btn" onClick={replay} disabled={stepIndex < 0} title="重播这一步" aria-label="重播这一步">
          ↻
        </button>
        {speechSupported() && (
          <button
            className={`icon-btn ${voiceOn ? '' : 'off'}`}
            onClick={() => {
              if (voiceOn) speechRef.current?.stop();
              setVoiceOn(!voiceOn);
            }}
            title={voiceOn ? '关闭朗读' : '打开朗读'}
            aria-label={voiceOn ? '关闭朗读' : '打开朗读'}
          >
            {voiceOn ? '🔊' : '🔇'}
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
    </div>
  );
}

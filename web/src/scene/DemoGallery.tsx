import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { ScenePlayer } from './ScenePlayer.tsx';
import { EXAMPLES } from '../../../shared/scene/examples.ts';
import { validateScene } from '../../../shared/scene/validate.ts';
import type { SpeechOptions } from '../../../shared/types.ts';

/** 示例讲解：不需要模型，用来体验播放器。 */
export function DemoGallery({ tts, onClose }: { tts: SpeechOptions; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const scene = EXAMPLES[index]!;
  return (
    <div className="chat-scroll">
      <div className="chat-inner">
        <div className="demo-head">
          <div>
            <h2>示例讲解</h2>
            <p className="muted small">不需要模型，直接体验动画播放器：可以逐步播放，也可以拖动滑块自己观察。</p>
          </div>
          <button className="btn" onClick={onClose}>
            <ArrowLeft size={15} aria-hidden="true" />
            返回
          </button>
        </div>
        <div className="demo-tabs segmented wrap" role="tablist">
          {EXAMPLES.map((s, i) => (
            <button key={s.title} className={i === index ? 'active' : ''} onClick={() => setIndex(i)} role="tab" aria-selected={i === index}>
              {s.title}
            </button>
          ))}
        </div>
        <ScenePlayer scene={scene} tts={tts} verified={validateScene(scene).ok} />
      </div>
    </div>
  );
}

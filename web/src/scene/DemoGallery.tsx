import { useState } from 'react';
import { ScenePlayer } from './ScenePlayer.tsx';
import { EXAMPLES } from '../../../shared/scene/examples.ts';
import { validateScene } from '../../../shared/scene/validate.ts';

/** 示例讲解：不需要模型，用来体验播放器。 */
export function DemoGallery({ tts, onClose }: { tts: { rate: number; voice: string }; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const scene = EXAMPLES[index]!;
  return (
    <div className="chat-scroll">
      <div className="chat-inner">
        <div className="demo-head">
          <h2>示例讲解</h2>
          <button className="btn" onClick={onClose}>
            返回
          </button>
        </div>
        <div className="demo-tabs" role="tablist">
          {EXAMPLES.map((s, i) => (
            <button key={s.title} className={`chip ${i === index ? 'active' : ''}`} onClick={() => setIndex(i)} role="tab" aria-selected={i === index}>
              {s.title}
            </button>
          ))}
        </div>
        <ScenePlayer scene={scene} tts={tts} verified={validateScene(scene).ok} />
      </div>
    </div>
  );
}

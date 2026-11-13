// 开发用：预览任意剧本 JSON（通过 window.__setScene 注入），用于检查模型生成的剧本。
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import 'katex/dist/katex.min.css';
import './styles.css';
import { ScenePlayer } from './scene/ScenePlayer.tsx';
import type { Scene } from '../../shared/scene/types.ts';

declare global {
  interface Window {
    __setScene?: (scene: Scene) => void;
  }
}

function Preview() {
  const [scene, setScene] = useState<Scene | null>(null);
  useEffect(() => {
    window.__setScene = setScene;
  }, []);
  if (!scene) return <p>等待剧本…</p>;
  return (
    <div style={{ maxWidth: 860, margin: '16px auto' }}>
      <ScenePlayer scene={scene} tts={{ rate: 1, voice: '' }} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);

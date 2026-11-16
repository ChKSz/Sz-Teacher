import type { CSSProperties, InputHTMLAttributes } from 'react';

/** 保留原生键盘与触摸语义，统一轨道、进度填色和滑块质感。 */
export function Range(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const min = Number(props.min ?? 0);
  const max = Number(props.max ?? 100);
  const fill = Math.max(0, Math.min(100, (Number(props.value ?? min) - min) / (max - min || 1) * 100));
  return <input {...props} type="range" className={`range-control ${props.className ?? ''}`} style={{ ...props.style, '--range-fill': `${fill}%` } as CSSProperties} />;
}

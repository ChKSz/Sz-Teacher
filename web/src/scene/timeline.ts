// 由步骤推导出每一步开始时的状态（可见对象、参数值），以便随时跳到任意一步。
import { defaultParams } from '../../../shared/scene/engine.ts';
import type { Action, Scene } from '../../../shared/scene/types.ts';

export interface StepState {
  visible: Set<string>;
  highlighted: Set<string>;
  /** 本步开始前的参数值。 */
  before: Record<string, number>;
  /** 本步动画结束后的参数值。 */
  after: Record<string, number>;
  /** 本步的动画（按顺序执行）。 */
  animations: { param: string; from: number; to: number; duration: number }[];
}

export function initialVisible(scene: Scene): Set<string> {
  return new Set(scene.objects.filter((o) => !o.hidden).map((o) => o.id));
}

export function buildTimeline(scene: Scene): StepState[] {
  const states: StepState[] = [];
  let visible = initialVisible(scene);
  let params = defaultParams(scene);
  for (const step of scene.steps) {
    const before = { ...params };
    const nextVisible = new Set(visible);
    const highlighted = new Set<string>();
    const animations: StepState['animations'] = [];
    let current = { ...params };
    const apply = (a: Action) => {
      switch (a.do) {
        case 'show':
          a.ids.forEach((id) => nextVisible.add(id));
          break;
        case 'hide':
          a.ids.forEach((id) => nextVisible.delete(id));
          break;
        case 'highlight':
          a.ids.forEach((id) => {
            highlighted.add(id);
            nextVisible.add(id);
          });
          break;
        case 'set':
          current = { ...current, [a.param]: a.value };
          // set 立即生效：作为动画前的起点
          if (animations.length === 0) Object.assign(before, { [a.param]: a.value });
          else animations.push({ param: a.param, from: a.value, to: a.value, duration: 0 });
          break;
        case 'animate': {
          const from = a.from ?? current[a.param] ?? 0;
          animations.push({ param: a.param, from, to: a.to, duration: Math.max(0.1, a.duration ?? 1.5) });
          current = { ...current, [a.param]: a.to };
          break;
        }
      }
    };
    for (const a of step.actions ?? []) apply(a);
    states.push({ visible: nextVisible, highlighted, before, after: current, animations });
    visible = nextVisible;
    params = current;
  }
  return states;
}

/** 缓动：先加速后减速，看起来更自然。 */
export function ease(k: number): number {
  return k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
}

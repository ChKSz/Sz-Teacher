import { pointDependencies } from '../../../shared/scene/engine.ts';
import { isPointObject, type Scene, type SceneObject } from '../../../shared/scene/types.ts';

function dependencies(o: SceneObject): string[] {
  if (isPointObject(o)) return pointDependencies(o);
  switch (o.type) {
    case 'segment': return [o.from, o.to];
    case 'line': return o.through;
    case 'ray': return [o.from, o.through];
    case 'polygon': case 'angle': return o.points;
    case 'circle': return [o.center, ...(o.through ? [o.through] : [])];
    case 'text': return typeof o.at === 'string' ? [o.at] : [];
    case 'trace': return [o.point];
    default: return [];
  }
}
/** Focus is a reversible presentation filter, never a change to the computed scene. */
export function focusedVisible(scene: Scene, visible: Set<string>, highlighted: Set<string>, stepIndex: number): Set<string> {
  const actions = scene.steps[stepIndex]?.actions ?? [];
  const focus = new Set([...highlighted, ...actions.flatMap(a => a.do === 'show' ? a.ids : [])]);
  // With no explicit teaching focus, preserve the complete figure rather than guess.
  if (!focus.size) return visible;
  const kept = new Set(scene.objects.filter(o => visible.has(o.id) && !o.hidden && !('dashed' in o && o.dashed)).map(o => o.id));
  focus.forEach(id => { if (visible.has(id)) kept.add(id); });
  const byId = new Map(scene.objects.map(o => [o.id, o]));
  const visited = new Set<string>();
  const addDependencies = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const object = byId.get(id);
    if (!object) return;
    for (const dep of dependencies(object)) {
      if (visible.has(dep)) kept.add(dep);
      addDependencies(dep);
    }
  };
  [...kept].forEach(addDependencies);
  return kept;
}

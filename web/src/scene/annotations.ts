import { parseCached, references } from '../../../shared/scene/expr.ts';
import { exprStrings, pointDependencies } from '../../../shared/scene/engine.ts';
import { isPointObject, type Scene, type Step } from '../../../shared/scene/types.ts';

/** Prefer not to label a segment with just its endpoints, which are already on the figure. */
export function isSegmentName(label: string, from: string, to: string): boolean {
  const normalize = (name: string) => name.trim().replace(/[′’]/g, "'");
  const text = normalize(label);
  const a = normalize(from);
  const b = normalize(to);
  return text === a + b || text === b + a;
}

/** Only the constructions introduced or emphasized by this step get extra annotations. */
export function stepAnnotations(step: Step | undefined, highlighted: Set<string>): Set<string> {
  return new Set([...highlighted, ...(step?.actions ?? []).flatMap(action => action.do === 'show' ? action.ids : [])]);
}

/** Show live measurements, not sample values for invisible or stationary constructions. */
export function liveReadoutTemplates(scene: Scene, visible: Set<string>): string[] {
  if (!scene.params?.length) return [];
  const parameterNames = new Set(scene.params.map(param => param.name));
  const moving = new Set<string>();
  const pointObjects = scene.objects.filter(isPointObject);
  const dependencies = new Map(pointObjects.map(point => {
    const ids = new Set(pointDependencies(point));
    for (const value of exprStrings(point)) {
      if (typeof value !== 'string') continue;
      try {
        const refs = references(parseCached(value));
        refs.points.forEach(id => ids.add(id));
        if ([...refs.vars].some(name => parameterNames.has(name))) moving.add(point.id);
      } catch { /* Invalid expressions don't contribute measurements. */ }
    }
    return [point.id, ids] as const;
  }));
  for (const point of scene.objects) {
    if (isPointObject(point) && point.type === 'lineCircle') {
      const circle = scene.objects.find(object => object.id === point.circle);
      if (circle?.type === 'circle') {
        dependencies.get(point.id)?.add(circle.center);
        if (circle.through) dependencies.get(point.id)?.add(circle.through);
        if (typeof circle.radius === 'string') {
          try {
            const refs = references(parseCached(circle.radius));
            refs.points.forEach(id => dependencies.get(point.id)?.add(id));
            if ([...refs.vars].some(name => parameterNames.has(name))) moving.add(point.id);
          } catch { /* Invalid radius expressions are handled by the scene engine. */ }
        }
      }
    }
  }
  // Propagate through constructed points without depending on object declaration order.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, ids] of dependencies) {
      if (!moving.has(id) && [...ids].some(dep => moving.has(dep))) {
        moving.add(id);
        changed = true;
      }
    }
  }
  return [...new Set(scene.readouts ?? [])].filter(template => {
    let live = false;
    try {
      for (const [, expr] of template.matchAll(/\{([^{}]+)\}/g)) {
        const refs = references(parseCached(expr!));
        if ([...refs.points].some(point => !visible.has(point))) return false;
        live ||= [...refs.points].some(point => moving.has(point)) || [...refs.vars].some(name => parameterNames.has(name));
      }
    } catch {
      return false;
    }
    return live;
  });
}

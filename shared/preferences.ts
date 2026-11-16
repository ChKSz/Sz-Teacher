interface SelectOption { value: string; label: string; description?: string }

export const EFFORT_OPTIONS: SelectOption[] = [
  { value: '', label: '默认', description: '由模型决定思考深度' },
  { value: 'low', label: '轻量', description: '响应更快，适合简单问题' },
  { value: 'medium', label: '标准', description: '平衡速度与推理深度' },
  { value: 'high', label: '深入', description: '适合复杂推理与分类讨论' },
];
export const STYLE_OPTIONS: SelectOption[] = [
  { value: 'hint-first', label: '先给提示', description: '先思考，再逐步解开问题' },
  { value: 'direct', label: '完整讲解', description: '直接讲解完整解题过程' },
];
export const MIMO_VOICES: SelectOption[] = [
  { value: 'mimo_default', label: '默认音色' },
  { value: '冰糖', label: '冰糖', description: '中文女声' },
  { value: '茉莉', label: '茉莉', description: '中文女声' },
  { value: '苏打', label: '苏打', description: '中文男声' },
  { value: '白桦', label: '白桦', description: '中文男声' },
];

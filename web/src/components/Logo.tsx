/** 品牌标志：一个三角形，边上有一个动点——对应"动点几何"这个核心场景。 */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" className="logo-bg" />
      <path d="M8.5 23 L16 8.5 L23.5 23 Z" fill="none" className="logo-line" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="19.75" cy="15.75" r="2.6" className="logo-dot" />
    </svg>
  );
}

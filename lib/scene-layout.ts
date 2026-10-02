export function sceneLayout(variant: 'hero' | 'visualizer') {
  const bars = 24;
  const span = variant === 'hero' ? 7.6 : 6.8;
  const spacing = span / (bars - 1);
  return {
    bars,
    span,
    barWidth: spacing * 0.62,
    capWidth: spacing * 0.78,
    maxHeight: variant === 'hero' ? 3.4 : 5.8,
  };
}

// Fit a bounding sphere inside the narrower camera angle, including room to orbit.
export function sceneDistance(
  aspect: number,
  fov: number,
  span: number,
  height: number,
) {
  const vertical = (fov * Math.PI) / 360;
  const horizontal = Math.atan(Math.tan(vertical) * Math.max(0.01, aspect));
  const radius = Math.hypot(span / 2, height / 2, 1);
  return (radius / Math.sin(Math.min(vertical, horizontal))) * 1.18;
}

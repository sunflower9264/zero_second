export function circleOverlapsRect(x, y, radius, rect) {
  return x >= rect.x - radius && x <= rect.x + rect.w + radius
    && y >= rect.y - radius && y <= rect.y + rect.h + radius;
}

export function isCirclePositionValid(x, y, radius, walls, bounds) {
  if (x < bounds.left + radius || x > bounds.right - radius) return false;
  if (y < bounds.top + radius || y > bounds.bottom - radius) return false;
  return !walls.some(wall => circleOverlapsRect(x, y, radius, wall));
}

export function safeCircleEndpoint(sx, sy, tx, ty, radius, walls, bounds) {
  if (!isCirclePositionValid(sx, sy, radius, walls, bounds)) return { x: sx, y: sy, blocked: true };
  const dx = tx - sx;
  const dy = ty - sy;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.001) return { x: sx, y: sy, blocked: false };

  const steps = Math.max(1, Math.ceil(distance / 2));
  let lastT = 0;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const x = sx + dx * t;
    const y = sy + dy * t;
    if (!isCirclePositionValid(x, y, radius, walls, bounds)) {
      let low = lastT;
      let high = t;
      for (let j = 0; j < 10; j += 1) {
        const mid = (low + high) / 2;
        const mx = sx + dx * mid;
        const my = sy + dy * mid;
        if (isCirclePositionValid(mx, my, radius, walls, bounds)) low = mid;
        else high = mid;
      }
      // Back off a fraction of a pixel from the contact point. Landing exactly on the boundary
      // leaves the next dash's validity up to floating-point noise, which is how a player ends up
      // standing flush against a wall and unable to move along it.
      const safe = Math.max(0, low - Math.min(0.02, 0.75 / distance));
      return { x: sx + dx * safe, y: sy + dy * safe, blocked: true };
    }
    lastT = t;
  }
  return { x: tx, y: ty, blocked: false };
}

export function stopBeforeCircle(sx, sy, tx, ty, circleX, circleY, clearance) {
  const dx = tx - sx;
  const dy = ty - sy;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return { x: sx, y: sy };
  const ux = dx / length;
  const uy = dy / length;
  const circleDistance = Math.max(0, Math.min(length, (circleX - sx) * ux + (circleY - sy) * uy));
  const stopDistance = Math.max(0, circleDistance - clearance);
  return { x: sx + ux * stopDistance, y: sy + uy * stopDistance };
}

export function nearestValidCirclePosition(x, y, radius, walls, bounds) {
  if (isCirclePositionValid(x, y, radius, walls, bounds)) return { x, y };
  for (let ring = 2; ring <= 160; ring += 2) {
    const samples = Math.max(16, Math.ceil(ring * 0.8));
    for (let i = 0; i < samples; i += 1) {
      const angle = i / samples * Math.PI * 2;
      const nx = x + Math.cos(angle) * ring;
      const ny = y + Math.sin(angle) * ring;
      if (isCirclePositionValid(nx, ny, radius, walls, bounds)) return { x: nx, y: ny };
    }
  }
  return null;
}


// Removed unused import of BASE_ROTATIONS as it does not exist in constants.ts
import { PartName, Vector2D } from '../types';

export const lerp = (start: number, end: number, t: number): number => start * (1 - t) + end * t;

// Added for smoother, robotic transitions
export const easeInOutQuint = (t: number): number => {
  return t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;
};

// Added for physically plausible impact simulation
export const easeInQuint = (t: number): number => t * t * t * t * t;

// Exporting the clamp function for broader utility
export const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(val, max));

// This function calculates the shortest angular difference between two angles (in degrees).
// It's robust for angles in any range, including those outside [-180, 180].
export const getShortestAngleDiffDeg = (currentDeg: number, startDeg: number): number => {
  let diff = currentDeg - startDeg;

  // Normalize diff to [-180, 180]
  // First, bring it to [0, 360)
  diff = ((diff % 360) + 360) % 360; 
  
  // Then, adjust to [-180, 180]
  if (diff > 180) {
    diff -= 360;
  }
  return diff;
};

// NOTE: This function is currently not used in App.tsx for direct drag updates.
// It would be used for interpolating between two full poses over time.
export const lerpAngleShortestPath = (a: number, b: number, t: number): number => {
  // Use 'a' and 'b' directly for interpolation, but calculate shortest difference based on normalized angles.
  // The 'return a + ...' part needs 'a' as the starting point.

  // Normalize angles to [0, 360) for consistent difference calculation
  const normalizeAngle0to360 = (angle: number): number => {
    return ((angle % 360) + 360) % 360;
  };

  let startAngle = normalizeAngle0to360(a);
  let endAngle = normalizeAngle0to360(b);

  let delta = endAngle - startAngle;

  // Adjust delta to be within [-180, 180] for shortest path
  if (delta > 180) {
    delta -= 360;
  } else if (delta < -180) {
    delta += 360;
  }
  
  // Apply this shortest delta from the original 'a'
  return a + delta * t;
};

const rad = (deg: number): number => deg * Math.PI / 180;
const deg = (rad: number): number => rad * 180 / Math.PI;

export const solve2DJointIK = (
    target: Vector2D, 
    rootPos: Vector2D, 
    len1: number, 
    len2: number,
    rootAngle: number,
): { angle1: number, angle2: number } | null => {
    const dx = target.x - rootPos.x;
    const dy = target.y - rootPos.y;
    const distSq = dx * dx + dy * dy;
    const dist = Math.sqrt(distSq);

    if (dist > len1 + len2 || dist < Math.abs(len1 - len2)) {
        return null; // out of reach
    }

    const angleToTarget = Math.atan2(dy, dx);
    const cosAngle1Arg = clamp((distSq + len1 * len1 - len2 * len2) / (2 * dist * len1), -1, 1);
    const angle1_internal = Math.acos(cosAngle1Arg);
    const angle1_global = angleToTarget - angle1_internal;

    const cosAngle2Arg = clamp((len1 * len1 + len2 * len2 - distSq) / (2 * len1 * len2), -1, 1);
    const angle2_internal = Math.acos(cosAngle2Arg);

    return {
        angle1: deg(angle1_global) - rootAngle,
        angle2: deg(Math.PI - angle2_internal),
    };
};


import { AnimationClip, WalkingEnginePose, EasingType } from '../types';
import { lerp, easeInOutQuint } from './kinematics';

export class AnimationEngine {
  static applyEasing(t: number, easing: EasingType): number {
    switch (easing) {
      case 'easeInOutQuint': return easeInOutQuint(t);
      case 'easeInQuad': return t * t;
      case 'easeOutQuad': return 1 - (1 - t) * (1 - t);
      case 'easeInOutCubic': return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      default: return t;
    }
  }

  static getPoseAtTime(clip: AnimationClip, time: number): WalkingEnginePose | null {
    if (clip.keyframes.length === 0) return null;
    const sorted = [...clip.keyframes].sort((a, b) => a.time - b.time);
    
    if (time <= sorted[0].time) return sorted[0].pose;
    if (time >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].pose;

    let prev = sorted[0];
    let next = sorted[sorted.length - 1];

    for (let i = 0; i < sorted.length - 1; i++) {
      if (time >= sorted[i].time && time < sorted[i + 1].time) {
        prev = sorted[i];
        next = sorted[i + 1];
        break;
      }
    }

    const t = (time - prev.time) / (next.time - prev.time);
    const easedT = this.applyEasing(t, next.easing);

    const blended: any = {};
    const keys = new Set([...Object.keys(prev.pose), ...Object.keys(next.pose)]) as Set<keyof WalkingEnginePose>;
    
    keys.forEach(key => {
      const v1 = (prev.pose as any)[key] ?? 0;
      const v2 = (next.pose as any)[key] ?? 0;
      blended[key] = lerp(v1, v2, easedT);
    });

    return blended as WalkingEnginePose;
  }
}

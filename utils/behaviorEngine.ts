import { WalkingEnginePose, MicroScriptInstance, IdleSettings, WalkingEngineGait, Vector2D } from '../types';
import { lerp, clamp } from './kinematics';

export type CharacterState = 'IDLE' | 'WALKING' | 'TRANSITIONING';

export class BehaviorEngine {
  private static lastLocomotionWeight = 1.0;
  private static latchPosition: Vector2D = { x: 0, y: 0 };
  private static isLatched = false;

  /**
   * Blends Locomotion, Idle, and Micro-Scripts with phase-awareness and activity suppression.
   */
  static blendPose(
    locPose: Partial<WalkingEnginePose>,
    idlePose: Partial<WalkingEnginePose>,
    scriptPose: Partial<WalkingEnginePose>,
    locWeight: number,
    gait: WalkingEngineGait,
    time: number
  ): Partial<WalkingEnginePose> {
    const blended: any = {};
    const keys = new Set([
      ...Object.keys(locPose),
      ...Object.keys(idlePose),
      ...Object.keys(scriptPose)
    ]) as Set<keyof WalkingEnginePose>;

    // Calculate activity-based suppression:
    // If running fast (high intensity * frequency), we suppress upper-body fidgets to maintain kinetic focus.
    const activitySuppression = 1.0 - (clamp(gait.intensity * gait.frequency, 0, 1.5) * 0.4);
    
    // Core Blending Loop
    keys.forEach(key => {
      const lVal = (locPose as any)[key] ?? 0;
      const iVal = (idlePose as any)[key] ?? 0;
      const sVal = (scriptPose as any)[key] ?? 0;

      // Base Layer Blend (Walking vs Idle)
      let base = lerp(iVal, lVal, locWeight);

      // Additive Script Layer (Fidgets/Gestures)
      // Scripts are added to the base pose, but suppressed by locomotion intensity for realism.
      // We skip offsets as those are handled by the grounding engine.
      if (key === 'x_offset' || key === 'y_offset') {
        blended[key] = base;
      } else {
        blended[key] = base + (sVal * activitySuppression);
      }
    });

    // Phase-Aware Transitions: Latching logic to prevent foot-sliding when stopping.
    // When locWeight drops below a threshold, we "latch" the current offset to stabilize the transition.
    if (this.lastLocomotionWeight > 0.5 && locWeight <= 0.5) {
      this.latchPosition = { x: locPose.x_offset || 0, y: locPose.y_offset || 0 };
      this.isLatched = true;
    }

    if (this.isLatched && locWeight < 0.9) {
      // Smoothly blend the latched locomotion offset into the idle offset
      const latchEase = 1.0 - locWeight;
      blended.x_offset = lerp(blended.x_offset, this.latchPosition.x, latchEase * 0.5);
    } else {
      this.isLatched = false;
    }

    this.lastLocomotionWeight = locWeight;
    return blended as Partial<WalkingEnginePose>;
  }

  /**
   * Determines if a micro-script should trigger based on semantic traits and current character Vibe.
   */
  static shouldTriggerFidget(traits: string[], vibe: number): string | null {
    const roll = Math.random();
    // Base trigger rate modified by character agility/nervousness traits
    const baseRate = traits.includes('nervous') || traits.includes('energetic') ? 0.08 : 0.03;
    
    if (roll > baseRate * vibe) return null;

    if (traits.includes('nervous') || traits.includes('anxious') || traits.includes('timid')) {
      return Math.random() > 0.6 ? 'shiver' : 'scratch_neck';
    }
    if (traits.includes('confident') || traits.includes('proud') || traits.includes('heroic')) {
      return 'chest_puff';
    }
    if (traits.includes('robotic') || traits.includes('stiff')) {
      return 'nod'; // Minimal movement
    }
    
    // Default pool
    const pool = ['look_around', 'nod'];
    return pool[Math.floor(Math.random() * pool.length)];
  }
}
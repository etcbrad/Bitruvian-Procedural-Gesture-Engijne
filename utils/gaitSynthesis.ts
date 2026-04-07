import { CharacterMorphology, GaitGenome, GaitParameter, GaitMode, WalkingEngineGait } from '../types';
import { lerp, clamp } from './kinematics';

type GaitAdjustment = { mul?: number; add?: number; min?: number; max?: number };

const MODE_ENVELOPES: Record<GaitMode, Partial<Record<keyof WalkingEngineGait, GaitAdjustment>>> = {
  walk: {
    intensity: { mul: 0.86, min: 0.4, max: 1.65 },
    frequency: { mul: 0.78, min: 0.18, max: 2.1 },
    stride: { mul: 0.74, min: 0.25, max: 1.55 },
    verticality: { mul: 0.72, min: 0.2, max: 1.1 },
    arm_swing: { mul: 0.74, min: 0.15, max: 1.7 },
    footDrag: { mul: 1.04, min: 0.1, max: 1.25 },
    gravity: { mul: 1.04, min: 0.15, max: 1.15 },
    kick_up_force: { mul: 0.92, min: 0, max: 1.25 },
    foot_roll: { mul: 1.08, min: 0.15, max: 1.25 },
    hip_sway: { mul: 0.88, min: 0.05, max: 2.2 },
    elbow_bend: { mul: 0.94, min: 0, max: 1.9 },
    torso_swivel: { mul: 0.9, min: 0, max: 1.4 },
  },
  jog: {
    intensity: { mul: 1.0, min: 0.55, max: 2 },
    frequency: { mul: 1.0, min: 0.2, max: 2.5 },
    stride: { mul: 1.0, min: 0.35, max: 1.9 },
    verticality: { mul: 0.95, min: 0.25, max: 1.2 },
    arm_swing: { mul: 0.98, min: 0.2, max: 2.1 },
    footDrag: { mul: 0.98, min: 0.1, max: 1.2 },
    gravity: { mul: 0.98, min: 0.15, max: 1.1 },
    kick_up_force: { mul: 0.96, min: 0, max: 1.25 },
    foot_roll: { mul: 1.0, min: 0.1, max: 1.2 },
    hip_sway: { mul: 1.0, min: 0.05, max: 2.4 },
    elbow_bend: { mul: 1.0, min: 0, max: 2 },
    torso_swivel: { mul: 1.0, min: 0, max: 1.5 },
  },
  run: {
    intensity: { mul: 1.16, min: 0.7, max: 2.4 },
    frequency: { mul: 1.23, min: 0.28, max: 3.1 },
    stride: { mul: 1.17, min: 0.45, max: 2.25 },
    verticality: { mul: 1.16, min: 0.4, max: 1.35 },
    arm_swing: { mul: 1.24, min: 0.25, max: 2.7 },
    footDrag: { mul: 0.82, min: 0.1, max: 1.0 },
    gravity: { mul: 0.88, min: 0.1, max: 1.0 },
    kick_up_force: { mul: 1.12, min: 0, max: 1.4 },
    foot_roll: { mul: 1.08, min: 0.1, max: 1.3 },
    hip_sway: { mul: 1.08, min: 0.05, max: 2.6 },
    elbow_bend: { mul: 1.08, min: 0, max: 2.2 },
    torso_swivel: { mul: 1.08, min: 0, max: 1.8 },
  },
};

const applyAdjustment = (value: number, adjustment?: GaitAdjustment): number => {
  if (!adjustment) return value;
  const scaled = (value * (adjustment.mul ?? 1)) + (adjustment.add ?? 0);
  const min = adjustment.min ?? Number.NEGATIVE_INFINITY;
  const max = adjustment.max ?? Number.POSITIVE_INFINITY;
  return clamp(scaled, min, max);
};

const removeAdjustment = (value: number, adjustment?: GaitAdjustment): number => {
  if (!adjustment) return value;
  const mul = adjustment.mul ?? 1;
  if (mul === 0) return value;
  return (value - (adjustment.add ?? 0)) / mul;
};

export const applyGaitModeEnvelope = (gait: WalkingEngineGait, mode: GaitMode): WalkingEngineGait => {
  const envelope = MODE_ENVELOPES[mode];
  const next = { ...gait };

  (Object.keys(envelope) as (keyof WalkingEngineGait)[]).forEach((key) => {
    next[key] = applyAdjustment(next[key], envelope[key]);
  });

  return next;
};

export const normalizeGaitModeEnvelope = (gait: WalkingEngineGait, mode: GaitMode): WalkingEngineGait => {
  const envelope = MODE_ENVELOPES[mode];
  const next = { ...gait };

  (Object.keys(envelope) as (keyof WalkingEngineGait)[]).forEach((key) => {
    next[key] = removeAdjustment(next[key], envelope[key]);
  });

  return next;
};

export class GaitSynthesizer {
  static synthesizeGait(morphology: CharacterMorphology, vibeScale: number = 1.0): WalkingEngineGait {
    const g = morphology.gaitDNA;
    const anat = morphology.anatomy;
    const tags = morphology.tags || [];

    const isQueen = tags.some(t => ['queen', 'regal', 'formal', 'stiff', 'elegant'].includes(t.toLowerCase()));
    const isAthlete = tags.some(t => ['athlete', 'runner', 'bold', 'heroic', 'energetic'].includes(t.toLowerCase()));
    const isVillain = tags.some(t => ['villain', 'sneaky', 'aggressive', 'creeping', 'dark'].includes(t.toLowerCase()));

    // Mix in genome variance based on vibeScale
    const scale = (val: number, neutral: number = 1.0, variance: number = 0) => {
        const personalityValue = lerp(neutral, val, vibeScale);
        return personalityValue + (Math.random() - 0.5) * variance * vibeScale;
    };

    const gait: WalkingEngineGait = {
      intensity: scale(this.calculateIntensity(g), 1.0, g.stride.variance),
      frequency: scale(this.calculateFrequency(g, anat), 1.0, g.frequency.variance),
      stride: scale(this.calculateStride(g, anat), 1.0, g.stride.variance),
      lean: scale(this.calculateLean(g, anat), 0, g.bodyPitch.variance),
      upper_body_lean: scale(this.calculateUpperBodyLean(g, anat), 0, g.bodyPitch.variance),
      hip_sway: scale(this.calculateHipSway(g), 0.4, g.bodyRoll.variance),
      waist_twist: scale(this.calculateWaistTwist(g), 0.3, g.bodyRoll.variance),
      arm_swing: scale(this.calculateArmSwing(g), 0.6, g.shoulderSwing.variance),
      elbow_bend: scale(this.calculateElbowBend(g), 0.7, 0.1),
      arm_spread: scale(this.calculateArmSpread(g), 0.1, 0.05),
      gravity: scale(this.calculateGravity(g), 0.3, 0.1),
      verticality: scale(this.calculateVerticality(g), 0.5, g.bodyBounce.variance),
      kick_up_force: scale(this.calculateKickUpForce(g), 0.4, 0.1),
      hover_height: scale(this.calculateHoverHeight(g), 0.1, 0.05),
      foot_roll: scale(this.calculateFootRoll(g, morphology.constraints), 0.6, 0.1),
      toe_bend: scale(this.calculateToeBend(g), 0.8, 0.1),
      footDrag: scale(this.calculateFootDrag(g), 0.5, 0.1),
      footSpring: scale(this.calculateFootSpring(g), 0.5, 0.1),
      torso_swivel: scale(this.calculateTorsoSwivel(g), 0.3, 0.1),
      head_spin: scale(this.calculateHeadSpin(g), 0, 0.2),
      handsAutoBend: scale(this.calculateLimbAutoBend(g, 'hands'), 0.3, 0.1),
      handsAutoStretch: scale(this.calculateLimbAutoStretch(g, 'hands'), 0.3, 0.1),
      feetAutoBend: scale(this.calculateLimbAutoBend(g, 'feet'), 0.4, 0.1),
      feetAutoStretch: scale(this.calculateLimbAutoStretch(g, 'feet'), 0.4, 0.1),
      headAutoBend: 0.1,
      headAutoStretch: 0.05,
      heavyStomp: scale(this.calculateStomp(g), 0, 0.1),
      headVelocitySensitivity: scale(this.calculateHeadSensitivity(g), 0.2, 0.1),
      elbowFlexibility: scale(this.calculateFlexibility(g), 0.5, 0.1),
      elbowMinBend: scale(this.calculateMinBend(g), -5, 5),
      elbowMaxBend: scale(this.calculateMaxBend(g), 150, 10),
    };

    if (isQueen) {
        gait.verticality = lerp(gait.verticality, 0.95, vibeScale);
        gait.waist_twist *= (1 - vibeScale * 0.8);
        gait.hip_sway *= (1 - vibeScale * 0.7);
        gait.arm_swing *= (1 - vibeScale * 0.9);
        gait.lean = lerp(gait.lean, -0.2, vibeScale);
    }
    if (isAthlete) {
        gait.frequency *= (1 + vibeScale * 0.5);
        gait.stride *= (1 + vibeScale * 0.4);
        gait.kick_up_force = lerp(gait.kick_up_force, 0.85, vibeScale);
        gait.arm_swing = lerp(gait.arm_swing, 1.8, vibeScale);
    }
    if (isVillain) {
        gait.gravity = lerp(gait.gravity, 0.85, vibeScale);
        gait.lean = lerp(gait.lean, 0.6, vibeScale);
        gait.footDrag = lerp(gait.footDrag, 0.8, vibeScale);
        gait.headVelocitySensitivity = lerp(gait.headVelocitySensitivity, 0.9, vibeScale);
    }

    return gait;
  }

  private static calculateIntensity(g: GaitGenome): number {
    return Math.min(2, g.stride.base * (1 + g.frequency.base * 0.5) * (1 - g.energyCost * 0.3));
  }
  private static calculateFrequency(g: GaitGenome, anat: any): number {
    return g.frequency.base * (1 + (anat.limbCount - 2) * 0.1) * (2 - g.weight);
  }
  private static calculateStride(g: GaitGenome, anat: any): number {
    return g.stride.base * (1 + anat.limbLength * 0.2) * (1 - g.energyCost * 0.2);
  }
  private static calculateLean(g: GaitGenome, anat: any): number {
    return g.bodyPitch.base * (anat.centerOfMass - 0.5) * 2.5;
  }
  private static calculateUpperBodyLean(g: GaitGenome, anat: any): number {
    return g.bodyPitch.base * 0.7 * (anat.centerOfMass > 0.6 ? 1.2 : -0.6);
  }
  private static calculateHipSway(g: GaitGenome): number {
    return g.bodyRoll.base * (1.2 + g.stride.base);
  }
  private static calculateWaistTwist(g: GaitGenome): number {
    return g.bodyRoll.base * 1.0 * (1 - g.stability * 0.5);
  }
  private static calculateArmSwing(g: GaitGenome): number {
    return Math.min(2, g.shoulderSwing.base * (1 + g.stride.base * 0.4) * (1 - g.weight * 0.4));
  }
  private static calculateElbowBend(g: GaitGenome): number {
    return g.shoulderSwing.base * (1.2 + g.confidence * 0.3);
  }
  private static calculateArmSpread(g: GaitGenome): number {
    return g.shoulderSwing.base * g.agility * 0.6 * (1 - g.weight);
  }
  private static calculateGravity(g: GaitGenome): number {
    return Math.min(1, 0.25 + g.weight * 0.45 + g.bodyBounce.base * 0.3);
  }
  private static calculateVerticality(g: GaitGenome): number {
    return 0.5 + g.bodyBounce.base * 0.4 - g.weight * 0.25;
  }
  private static calculateKickUpForce(g: GaitGenome): number {
    return g.bodyBounce.base * (1.2 - g.weight * 0.6) * g.agility;
  }
  private static calculateHoverHeight(g: GaitGenome): number {
    return g.bodyBounce.base * (1 - g.weight) * 0.7;
  }
  private static calculateFootRoll(g: GaitGenome, constraints: any): number {
    return g.ankleFlexion.base * (constraints.strikeType === 'heel' ? 0.9 : 0.5);
  }
  private static calculateToeBend(g: GaitGenome): number {
    return g.ankleFlexion.base * (1.2 + g.stride.base * 0.2);
  }
  private static calculateFootDrag(g: GaitGenome): number {
    return 1.1 - g.agility * 0.4;
  }
  private static calculateFootSpring(g: GaitGenome): number {
    return g.bodyBounce.base * (1.1 - g.weight * 0.5);
  }
  private static calculateTorsoSwivel(g: GaitGenome): number {
    return g.bodyRoll.base * g.agility * 0.6;
  }
  private static calculateHeadSpin(g: GaitGenome): number {
    return g.confidence * 0.4 * (1 - g.anxiousness * 0.6);
  }
  private static calculateStomp(g: GaitGenome): number {
    return Math.min(1, g.weight * 0.6 * (1 - g.agility * 0.8));
  }
  private static calculateHeadSensitivity(g: GaitGenome): number {
    return 0.5 * (1 + g.anxiousness * 0.4);
  }
  private static calculateFlexibility(g: GaitGenome): number {
    return g.agility * (1.2 - g.weight * 0.4);
  }
  private static calculateMinBend(g: GaitGenome): number {
    return -5 - g.agility * 25;
  }
  private static calculateMaxBend(g: GaitGenome): number {
    return 155 - g.weight * 35;
  }
  private static calculateLimbAutoBend(g: GaitGenome, limbType: string): number {
    return limbType === 'hands' ? g.shoulderSwing.base * 0.4 : g.ankleFlexion.base * 0.5;
  }
  private static calculateLimbAutoStretch(g: GaitGenome, limbType: string): number {
    return limbType === 'hands' ? g.shoulderSwing.base * 0.2 : g.ankleFlexion.base * 0.25;
  }
}

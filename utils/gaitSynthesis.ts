import { CharacterMorphology, GaitGenome, GaitParameter, GaitMode, WalkingEngineGait } from '../types';
import { lerp, clamp } from './kinematics';

type GaitAdjustment = { mul?: number; add?: number; min?: number; max?: number };

const MODE_ENVELOPES: Record<GaitMode, Partial<Record<keyof WalkingEngineGait, GaitAdjustment>>> = {
  idle: {},
  walk: {
    intensity: { mul: 0.8, min: 0.35, max: 1.45 },
    frequency: { mul: 0.74, min: 0.18, max: 1.7 },
    stride: { mul: 0.62, min: 0.18, max: 1.05 },
    verticality: { mul: 0.68, min: 0.2, max: 0.95 },
    arm_swing: { mul: 0.68, min: 0.12, max: 1.45 },
    footDrag: { mul: 1.06, min: 0.1, max: 1.2 },
    gravity: { mul: 1.06, min: 0.18, max: 1.1 },
    kick_up_force: { mul: 0.88, min: 0, max: 1.05 },
    foot_roll: { mul: 1.04, min: 0.12, max: 1.1 },
    hip_sway: { mul: 0.82, min: 0.05, max: 1.9 },
    elbow_bend: { mul: 0.9, min: 0, max: 1.65 },
    knee_bend: { mul: 0.88, min: 0, max: 1.6 },
    torso_swivel: { mul: 0.84, min: 0, max: 1.15 },
  },
  jog: {
    intensity: { mul: 0.96, min: 0.5, max: 1.85 },
    frequency: { mul: 0.95, min: 0.35, max: 2.15 },
    stride: { mul: 0.92, min: 0.35, max: 1.5 },
    verticality: { mul: 0.92, min: 0.25, max: 1.1 },
    arm_swing: { mul: 0.96, min: 0.18, max: 1.9 },
    footDrag: { mul: 0.98, min: 0.08, max: 1.1 },
    gravity: { mul: 1.0, min: 0.15, max: 1.0 },
    kick_up_force: { mul: 0.98, min: 0, max: 1.15 },
    foot_roll: { mul: 1.0, min: 0.1, max: 1.15 },
    hip_sway: { mul: 0.98, min: 0.05, max: 2.0 },
    elbow_bend: { mul: 1.0, min: 0, max: 1.85 },
    knee_bend: { mul: 1.0, min: 0, max: 1.75 },
    torso_swivel: { mul: 0.98, min: 0, max: 1.25 },
  },
  run: {
    intensity: { mul: 1.14, min: 0.65, max: 2.25 },
    frequency: { mul: 1.18, min: 0.5, max: 2.8 },
    stride: { mul: 1.16, min: 0.55, max: 2.0 },
    verticality: { mul: 1.12, min: 0.35, max: 1.25 },
    arm_swing: { mul: 1.2, min: 0.22, max: 2.45 },
    footDrag: { mul: 0.84, min: 0.08, max: 0.95 },
    gravity: { mul: 0.9, min: 0.1, max: 0.95 },
    kick_up_force: { mul: 1.08, min: 0, max: 1.25 },
    foot_roll: { mul: 1.06, min: 0.08, max: 1.2 },
    hip_sway: { mul: 1.04, min: 0.05, max: 2.35 },
    elbow_bend: { mul: 1.16, min: 0, max: 2 },
    knee_bend: { mul: 1.2, min: 0, max: 1.9 },
    torso_swivel: { mul: 1.04, min: 0, max: 1.5 },
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
      knee_bend: scale(this.calculateKneeBend(g), 0.72, 0.1),
      arm_spread: scale(this.calculateArmSpread(g), 0.1, 0.05),
      gravity: scale(this.calculateGravity(g), 0.3, 0.1),
      verticality: scale(this.calculateVerticality(g), 0.5, g.bodyBounce.variance),
      kick_up_force: scale(this.calculateKickUpForce(g), 0.4, 0.1),
      hover_height: scale(this.calculateHoverHeight(g), 0.1, 0.05),
      foot_roll: scale(this.calculateFootRoll(g, morphology.constraints), 0.6, 0.1),
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
      asymmetry: scale(this.calculateAsymmetry(g), 0.06, 0.05),
      limp: scale(this.calculateLimp(g, morphology.tags), 0.02, 0.05),
      limp_bias: scale(this.calculateLimpBias(morphology.tags), 0, 0),
      weight_shift: scale(this.calculateWeightShift(g), 0.3, 0.08),
      step_expression: scale(this.calculateStepExpression(g, morphology.tags), 0.5, 0.08),
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
    const paceNeed = clamp(
      0.2
        + ((anat.limbLength ?? 1) - 0.5) * 0.14
        + ((g.agility ?? 0.5) - 0.5) * 0.2
        + ((g.confidence ?? 0.5) - 0.5) * 0.08
        - (g.energyCost * 0.12),
      -0.15,
      0.55,
    );
    return clamp(0.58 + (g.frequency.base * 0.34) + paceNeed, 0.45, 2.1);
  }
  private static calculateStride(g: GaitGenome, anat: any): number {
    const reachNeed = clamp(
      0.12
        + ((anat.limbLength ?? 1) - 0.5) * 0.16
        + ((g.frequency.base ?? 1) - 1) * 0.18
        + ((g.agility ?? 0.5) - 0.5) * 0.22
        - (g.energyCost * 0.1),
      0,
      1,
    );
    const longStrideBoost = lerp(0.82, 1.12, reachNeed);
    const economy = clamp(1 - g.energyCost * 0.14, 0.72, 1.0);
    return clamp((0.24 + g.stride.base * 0.3 + (anat.limbLength ?? 1) * 0.05) * economy * longStrideBoost, 0.16, 1.55);
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
    return Math.min(2.4, g.shoulderSwing.base * (2.55 + g.stride.base * 0.9) * (1 - g.weight * 0.24));
  }
  private static calculateElbowBend(g: GaitGenome): number {
    return g.shoulderSwing.base * (1.2 + g.confidence * 0.3);
  }
  private static calculateKneeBend(g: GaitGenome): number {
    return g.kneeFlexion.base * (1.15 + g.agility * 0.25) * (1 - g.weight * 0.12);
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
  private static calculateAsymmetry(g: GaitGenome): number {
    return clamp(0.05 + (1 - g.stability) * 0.12 + (1 - g.confidence) * 0.05, 0, 0.3);
  }
  private static calculateLimp(g: GaitGenome, tags: string[]): number {
    const clumsy = tags.some((tag) => ['clumsy', 'timid', 'nervous', 'scared'].includes(tag.toLowerCase()));
    return clamp((1 - g.agility) * 0.08 + (clumsy ? 0.08 : 0), 0, 0.3);
  }
  private static calculateLimpBias(tags: string[]): number {
    if (tags.some((tag) => ['left-leaning', 'left-heavy', 'favor-left'].includes(tag.toLowerCase()))) return -0.5;
    if (tags.some((tag) => ['right-leaning', 'right-heavy', 'favor-right'].includes(tag.toLowerCase()))) return 0.5;
    return 0;
  }
  private static calculateWeightShift(g: GaitGenome): number {
    return clamp(0.28 + (g.weight * 0.18) + (1 - g.stability) * 0.08, 0, 0.6);
  }
  private static calculateStepExpression(g: GaitGenome, tags: string[]): number {
    const expressive = tags.some((tag) => ['energetic', 'heroic', 'bold', 'aggressive'].includes(tag.toLowerCase()));
    const cautious = tags.some((tag) => ['timid', 'nervous', 'relaxed', 'calm'].includes(tag.toLowerCase()));
    return clamp(
      0.42
        + g.stride.base * 0.08
        + g.bodyBounce.base * 0.12
        + (expressive ? 0.08 : 0)
        - (cautious ? 0.04 : 0),
      0,
      1,
    );
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

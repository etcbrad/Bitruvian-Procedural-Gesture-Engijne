import { GroundingResults, IdleSettings, PhysicsControls, WalkingEnginePose, WalkingEngineProportions } from '../types';
import { clamp, lerp } from './kinematics';
import { ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT, GROUNDING_PHYSICS } from '../constants';

type FootSide = 'left' | 'right';

const smooth01 = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

const getSupportBias = (phase: number, side: FootSide): number => {
  const cycle = ((phase % 1) + 1) % 1;
  const offset = side === 'left' ? 0 : 0.5;
  const stanceWave = Math.sin((cycle + offset) * Math.PI * 2);
  return clamp(0.5 - stanceWave * 0.5, 0, 1);
};

const estimateFootContact = (pose: Partial<WalkingEnginePose>, side: FootSide): number => {
  const footAngle = side === 'left' ? (pose.l_foot ?? -90) : (pose.r_foot ?? -90);
  const kneeAngle = side === 'left' ? (pose.l_knee ?? 0) : (pose.r_knee ?? 0);
  const hipAngle = side === 'left' ? (pose.l_hip ?? 0) : (pose.r_hip ?? 0);
  const phase = pose.stride_phase ?? 0;
  const supportBias = getSupportBias(phase, side);
  const plantarAngle = clamp(1 - Math.abs(footAngle + 90) / 58, 0, 1);
  const loadedKnee = clamp(1 - Math.abs(kneeAngle) / 74, 0, 1);
  const settledHip = clamp(1 - Math.abs(hipAngle) / 48, 0, 1);
  return clamp(
    (supportBias * 0.42)
      + (plantarAngle * 0.24)
      + (loadedKnee * 0.16)
      + (settledHip * 0.1),
    0,
    1,
  );
};

export const applyFootGrounding = (
    rawPose: Partial<WalkingEnginePose>,
    props: WalkingEngineProportions,
    baseUnitH: number,
    physics: PhysicsControls,
    locomotionActivePins: string[],
    _idleSettings: IdleSettings,
    gravityCenter: 'left' | 'center' | 'right',
    locomotionWeight: number,
    deltaTime: number,
): GroundingResults => {
    const phase = rawPose.stride_phase ?? 0;
    const leftContact = estimateFootContact(rawPose, 'left');
    const rightContact = estimateFootContact(rawPose, 'right');
    const contactBlend = clamp(leftContact + rightContact, 0, 1.75);
    const isAirborne = contactBlend < 0.28;
    const supportLoad = clamp(contactBlend, 0, 1);
    const leftLoad = supportLoad === 0 ? 0 : leftContact / Math.max(0.001, leftContact + rightContact);
    const rightLoad = supportLoad === 0 ? 0 : rightContact / Math.max(0.001, leftContact + rightContact);
    const weightBearingFoot = supportLoad < 0.15
      ? 'both'
      : leftLoad > rightLoad + 0.12
        ? 'left'
        : rightLoad > leftLoad + 0.12
          ? 'right'
          : 'both';
    const swingFoot: FootSide | null = supportLoad < 0.15
      ? 'left'
      : leftContact < rightContact ? 'left' : 'right';

    const footDrag = clamp((rawPose.l_foot ?? -90) + 90, 0, 36) + clamp((rawPose.r_foot ?? -90) + 90, 0, 36);
    const pushOffEnergy = clamp(((rawPose.l_knee ?? 0) + (rawPose.r_knee ?? 0)) / 70, 0, 1);
    const airFactor = isAirborne ? 1 : clamp(1 - supportLoad * 0.65, 0, 1);
    const emulatedPlant = smooth01(Math.max(leftContact, rightContact));
    const bounce = (physics.bounceIntensity * 6)
      + (pushOffEnergy * 4.5)
      - (supportLoad * 4.2)
      + (airFactor * 8)
      - (footDrag * 0.03);
    const gravityBias = gravityCenter === 'left' ? -1 : gravityCenter === 'right' ? 1 : 0;
    const sideBias = (rightLoad - leftLoad) * 4 + gravityBias * 1.2;
    const pelvisLift = lerp(-1.5, 7, airFactor) + bounce * 0.28 + (phase > 0.5 ? -0.5 : 0.25);
    const bodySway = clamp((rawPose.x_offset ?? 0) + sideBias + (locomotionActivePins.length * 0.12), -16, 16);
    const supportCompression = clamp((1 - supportLoad) * 0.42 + (supportLoad * 0.08), 0, 0.55);
    const leftCompression = clamp(leftContact * 0.52 + supportCompression * (leftLoad > 0.5 ? 0.34 : 0.1), 0, 1);
    const rightCompression = clamp(rightContact * 0.52 + supportCompression * (rightLoad > 0.5 ? 0.34 : 0.1), 0, 1);
    const leftChain = clamp(leftContact * 0.7 + (weightBearingFoot === 'left' ? 0.3 : 0.1), 0, 1);
    const rightChain = clamp(rightContact * 0.7 + (weightBearingFoot === 'right' ? 0.3 : 0.1), 0, 1);

    return {
        adjustedPose: {
            ...rawPose,
            x_offset: bodySway,
            y_offset: (rawPose.y_offset ?? 0) + pelvisLift,
        },
        tensions: {
            leftFootLoad: leftContact,
            rightFootLoad: rightContact,
            airborne: isAirborne ? 1 : 0,
            pushOff: pushOffEnergy,
            supportLoad,
            emulatedPlant,
        },
        footState: {
            weightBearingFoot,
            swingFoot,
            contactPose: supportLoad > 0.18 && !isAirborne,
            leftContact,
            rightContact,
            supportLoad,
            groundBounce: clamp(bounce / 14, 0, 1),
            leftChain,
            rightChain,
            leftCompression,
            rightCompression,
        },
    };
};

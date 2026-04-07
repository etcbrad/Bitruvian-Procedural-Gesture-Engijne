
// utils/groundingEngine.ts

import { WalkingEnginePose, WalkingEngineProportions, PhysicsControls, PartName, IdleSettings, Vector2D, GroundingResults } from '../types';
import { MANNEQUIN_LOCAL_FLOOR_Y, GROUNDING_PHYSICS, ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT } from '../constants';
import { lerp, clamp, solve2DJointIK } from './kinematics';
import { calculateFootTipGlobalPosition } from './locomotionEngine';

const normalizeStridePhase = (phase: number | undefined): number => {
    if (!Number.isFinite(phase ?? Number.NaN)) return 0;
    const wrapped = (phase ?? 0) % 1;
    return wrapped < 0 ? wrapped + 1 : wrapped;
};

const smooth01 = (value: number): number => {
    const x = clamp(value, 0, 1);
    return x * x * (3 - 2 * x);
};

export const applyFootGrounding = (
    rawPose: Partial<WalkingEnginePose>,
    props: WalkingEngineProportions,
    baseUnitH: number,
    physics: PhysicsControls,
    locomotionActivePins: string[],
    idleSettings: IdleSettings,
    gravityCenter: 'left' | 'center' | 'right',
    locomotionWeight: number,
    deltaTime: number,
): GroundingResults => {
    const adjustedPose: Partial<WalkingEnginePose> = { ...rawPose };
    const tensions: Record<string, number> = {};
    
    const floorYGlobal = GROUNDING_PHYSICS.FLOOR_Y_OFFSET_GLOBAL_H_UNIT * baseUnitH; 
    
    // Weighted pin strength to prevent jumps during transition
    const locomotionPinL = locomotionActivePins.includes(PartName.LAnkle) ? 1.0 : 0.0;
    const locomotionPinR = locomotionActivePins.includes(PartName.RAnkle) ? 1.0 : 0.0;
    const idlePinL = (idleSettings.idlePinnedFeet === 'left' || idleSettings.idlePinnedFeet === 'both') ? 1.0 : 0.0;
    const idlePinR = (idleSettings.idlePinnedFeet === 'right' || idleSettings.idlePinnedFeet === 'both') ? 1.0 : 0.0;

    // Phase-Aware Blending: Higher smoothing during transition to prevent snapping
    const transitionSmoothing = locomotionWeight > 0.1 && locomotionWeight < 0.9 ? 0.95 : physics.motionSmoothing;

    const pinStrengthL = lerp(idlePinL, locomotionPinL, locomotionWeight);
    const pinStrengthR = lerp(idlePinR, locomotionPinR, locomotionWeight);

    let currentBodyX = adjustedPose.x_offset ?? 0;
    let currentBodyY = adjustedPose.y_offset ?? 0;

    const lFootTip = calculateFootTipGlobalPosition({ 
        hip: adjustedPose.l_hip ?? 0, 
        knee: adjustedPose.l_knee ?? 0, 
        foot: adjustedPose.l_foot ?? 0, 
    }, props, baseUnitH, false);

    const rFootTip = calculateFootTipGlobalPosition({ 
        hip: adjustedPose.r_hip ?? 0, 
        knee: adjustedPose.r_knee ?? 0, 
        foot: adjustedPose.r_foot ?? 0, 
    }, props, baseUnitH, true);

    const cyclePhase = normalizeStridePhase(adjustedPose.stride_phase);
    const phaseSupportFoot: 'left' | 'right' = cyclePhase < 0.5 ? 'left' : 'right';
    const contactTolerance = baseUnitH * 0.08;
    const leftWorldY = lFootTip.y + currentBodyY;
    const rightWorldY = rFootTip.y + currentBodyY;
    const leftContactScore = clamp(1 - Math.abs(floorYGlobal - leftWorldY) / contactTolerance, 0, 1);
    const rightContactScore = clamp(1 - Math.abs(floorYGlobal - rightWorldY) / contactTolerance, 0, 1);
    const phaseSupportScore = 0.62 + (0.38 * Math.abs(Math.cos(cyclePhase * Math.PI * 2)));
    const contactPose = locomotionWeight > 0.08 && leftContactScore > 0.42 && rightContactScore > 0.42;
    const heightSupportFoot: 'left' | 'right' = leftWorldY >= rightWorldY ? 'left' : 'right';
    const autoSupportFoot: 'left' | 'right' | null = locomotionWeight > 0.08 && locomotionActivePins.length === 0
        ? (
            contactPose
                ? (leftContactScore >= rightContactScore ? 'left' : 'right')
                : (Math.abs(leftContactScore - rightContactScore) > 0.12
                    ? (leftContactScore > rightContactScore ? 'left' : 'right')
                    : (phaseSupportScore >= 0.5 ? phaseSupportFoot : heightSupportFoot))
          )
        : null;
    const secondaryContactFoot: 'left' | 'right' | null = contactPose
        ? (autoSupportFoot === 'left' ? 'right' : 'left')
        : null;
    const autoSupportStrength = clamp(0.78 + locomotionWeight * 0.22, 0.78, 1);
    const autoSecondaryStrength = contactPose
        ? clamp(0.35 + Math.min(leftContactScore, rightContactScore) * 0.5, 0.35, 0.85)
        : 0;

    const idleGroundingBonus = locomotionWeight < 0.2 ? 1.5 : 1.0;
    const yCorrectionStrength = GROUNDING_PHYSICS.GROUNDING_SPRING_FACTOR * (1 - physics.jointElasticity) * idleGroundingBonus;
    const xCorrectionStrength = GROUNDING_PHYSICS.GROUNDING_X_STABILITY_FACTOR * (1 - physics.stabilization);

    const supportPinStrengthL = autoSupportFoot === 'left' ? autoSupportStrength : secondaryContactFoot === 'left' ? autoSecondaryStrength : 0.0;
    const supportPinStrengthR = autoSupportFoot === 'right' ? autoSupportStrength : secondaryContactFoot === 'right' ? autoSecondaryStrength : 0.0;
    const effectivePinStrengthL = Math.max(pinStrengthL, supportPinStrengthL);
    const effectivePinStrengthR = Math.max(pinStrengthR, supportPinStrengthR);
    const thighLengthL = (props.l_upper_leg?.h ?? 1) * ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_UPPER * baseUnitH;
    const calfLengthL = (props.l_lower_leg?.h ?? 1) * ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_LOWER * baseUnitH;
    const thighLengthR = (props.r_upper_leg?.h ?? 1) * ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_UPPER * baseUnitH;
    const calfLengthR = (props.r_lower_leg?.h ?? 1) * ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_LOWER * baseUnitH;
    const crouchFactor = clamp(Math.abs(currentBodyY) / (baseUnitH * 1.5), 0, 1);
    const dynamicSpread = baseUnitH * lerp(GROUNDING_PHYSICS.STABILITY_SPRING_BASE_SPREAD_H_UNIT, GROUNDING_PHYSICS.STABILITY_SPRING_CROUCH_SPREAD_H_UNIT, crouchFactor);

    if (effectivePinStrengthL > 0.01 || effectivePinStrengthR > 0.01) {
        let yCorrection = 0;
        let totalPinWeight = 0;

        const calculateYCorrection = (isRight: boolean, weight: number) => {
            const reach = isRight ? (thighLengthR + calfLengthR) : (thighLengthL + calfLengthL);
            const footTipY = isRight ? rFootTip.y : lFootTip.y;
            const supportWeight = isRight ? effectivePinStrengthR : effectivePinStrengthL;
            const supportOffsetX = autoSupportFoot
                ? (autoSupportFoot === 'right' ? dynamicSpread * 0.35 : -dynamicSpread * 0.35)
                : 0;
            
            let targetAnkleX = supportOffsetX;
            if (effectivePinStrengthL > 0.5 && effectivePinStrengthR > 0.5) {
                targetAnkleX = isRight ? dynamicSpread : -dynamicSpread;
            } else if (effectivePinStrengthL > 0.5) {
                targetAnkleX = -dynamicSpread * 0.5;
            } else if (effectivePinStrengthR > 0.5) {
                targetAnkleX = dynamicSpread * 0.5;
            }

            const hipToTargetX = targetAnkleX - currentBodyX;
            const hipToTargetX_sq = hipToTargetX * hipToTargetX;

            const transitionTargetY = lerp(footTipY + currentBodyY, floorYGlobal, supportWeight);

            if (hipToTargetX_sq > reach * reach) {
                const xOffsetCorr = (Math.abs(hipToTargetX) - (reach * 0.99)) * Math.sign(hipToTargetX);
                currentBodyX += xOffsetCorr * xCorrectionStrength * supportWeight;
                return (transitionTargetY - currentBodyY) * supportWeight;
            }

            const requiredYDist = Math.sqrt(reach * reach - hipToTargetX_sq);
            const requiredHipY = transitionTargetY - requiredYDist;
            return (requiredHipY - currentBodyY) * supportWeight;
        };

        if (effectivePinStrengthL > 0.01) {
            yCorrection += calculateYCorrection(false, effectivePinStrengthL);
            totalPinWeight += effectivePinStrengthL;
        }
        if (effectivePinStrengthR > 0.01) {
            yCorrection += calculateYCorrection(true, effectivePinStrengthR);
            totalPinWeight += effectivePinStrengthR;
        }
        
        const verticalStickiness = locomotionWeight < 0.1 ? 0.8 : yCorrectionStrength;
        if (totalPinWeight > 0) {
            currentBodyY = lerp(currentBodyY, currentBodyY + yCorrection / totalPinWeight, verticalStickiness);
        }

        const hipPos = { x: currentBodyX, y: currentBodyY };

        const solveAndApplyIK = (isRight: boolean, weight: number) => {
            const partName = isRight ? PartName.RAnkle : PartName.LAnkle;
            const thighLen = isRight ? thighLengthR : thighLengthL;
            const calfLen = isRight ? calfLengthR : calfLengthL;
            const reach = thighLen + calfLen;

            let targetAnkleX = 0;
            if (pinStrengthL > 0.5 && pinStrengthR > 0.5) {
                targetAnkleX = isRight ? dynamicSpread : -dynamicSpread;
            } else if (pinStrengthL > 0.5) {
                targetAnkleX = -dynamicSpread * 0.5;
            } else if (pinStrengthR > 0.5) {
                targetAnkleX = dynamicSpread * 0.5;
            }

            const targetPos = { x: targetAnkleX, y: floorYGlobal };
            const ik = solve2DJointIK(targetPos, hipPos, thighLen, calfLen, adjustedPose.bodyRotation ?? 0);

            if (ik) {
                const legAngles = { hip: ik.angle1, knee: ik.angle2, foot: -90 };
                if (isRight) {
                    adjustedPose.r_hip = lerp(adjustedPose.r_hip ?? 0, legAngles.hip, weight);
                    adjustedPose.r_knee = lerp(adjustedPose.r_knee ?? 0, legAngles.knee, weight);
                    adjustedPose.r_foot = lerp(adjustedPose.r_foot ?? -90, legAngles.foot, weight);
                } else {
                    adjustedPose.l_hip = lerp(adjustedPose.l_hip ?? 0, legAngles.hip, weight);
                    adjustedPose.l_knee = lerp(adjustedPose.l_knee ?? 0, legAngles.knee, weight);
                    adjustedPose.l_foot = lerp(adjustedPose.l_foot ?? -90, legAngles.foot, weight);
                }
                
                const dist = Math.hypot(targetPos.x - hipPos.x, targetPos.y - hipPos.y);
                tensions[partName] = clamp(dist / reach, 0, 1) * weight;
            }
        };

        if (effectivePinStrengthL > 0.01) solveAndApplyIK(false, effectivePinStrengthL);
        if (effectivePinStrengthR > 0.01) solveAndApplyIK(true, effectivePinStrengthR);
        
    } else {
        const lowestFootY = Math.max(leftWorldY, rightWorldY);
        
        if (lowestFootY > floorYGlobal - GROUNDING_PHYSICS.FOOT_LIFT_THRESHOLD_H_UNIT * baseUnitH) {
            const correctionY = floorYGlobal - lowestFootY;
            currentBodyY = lerp(currentBodyY, currentBodyY + correctionY, yCorrectionStrength);
        }

        const betweenAnklesX = (lFootTip.x + rFootTip.x) * 0.5;
        const gravityBiasX = gravityCenter === 'left'
            ? -GROUNDING_PHYSICS.COG_X_SIDE_OFFSET_H_UNIT * baseUnitH
            : gravityCenter === 'right'
                ? GROUNDING_PHYSICS.COG_X_SIDE_OFFSET_H_UNIT * baseUnitH
                : 0;
        const idleAnchorBlend = clamp(locomotionWeight / 0.25, 0, 1);
        const supportCenterX = lerp(betweenAnklesX, gravityBiasX, idleAnchorBlend);

        const idleXStability = (1 - locomotionWeight) * 0.1;
        currentBodyX = lerp(currentBodyX, supportCenterX, idleXStability + xCorrectionStrength * 0.5);
    }

    const stanceProgressFor = (isRight: boolean) => {
        const raw = isRight ? (cyclePhase - 0.5) * 2 : cyclePhase * 2;
        return clamp(raw, 0, 1);
    };

    const buildChainMetrics = (isRight: boolean, supportWeight: number) => {
        const stanceProgress = stanceProgressFor(isRight);
        const hipAngle = isRight ? (adjustedPose.r_hip ?? 0) : (adjustedPose.l_hip ?? 0);
        const kneeAngle = isRight ? (adjustedPose.r_knee ?? 0) : (adjustedPose.l_knee ?? 0);
        const footAngle = isRight ? (adjustedPose.r_foot ?? -90) : (adjustedPose.l_foot ?? -90);
        const footTip = isRight ? rFootTip : lFootTip;
        const supportLoad = clamp(supportWeight * (0.4 + (isRight ? rightContactScore : leftContactScore) * 0.6), 0, 1);
        const targetAnkleX = autoSupportFoot
            ? (autoSupportFoot === 'right' ? dynamicSpread * 0.35 : -dynamicSpread * 0.35)
            : 0;
        const hipToFootDistance = Math.hypot(targetAnkleX - currentBodyX, floorYGlobal - (footTip.y + currentBodyY));
        const reach = isRight ? (thighLengthR + calfLengthR) : (thighLengthL + calfLengthL);
        const compression = clamp(1 - hipToFootDistance / reach, 0, 1);
        const footPitch = footAngle + 90;
        const ankleDrive = clamp(Math.abs(footPitch) / 55, 0, 1);
        const heelSettle = clamp(footPitch / 32, 0, 1);
        const toeDrive = clamp(-footPitch / 42, 0, 1);
        const shinDrive = clamp(1 - kneeAngle / 110, 0, 1);
        const thighDrive = clamp(1 - Math.abs(hipAngle) / 70, 0, 1);
        const landingPhase = 1 - smooth01((stanceProgress - 0.16) / 0.26);
        const pushOffPhase = smooth01((stanceProgress - 0.54) / 0.36);
        const landing = supportLoad * landingPhase * (0.14 + compression * 0.24 + shinDrive * 0.18 + heelSettle * 0.14);
        const pushOff = supportLoad * pushOffPhase * (0.16 + compression * 0.24 + ankleDrive * 0.18 + shinDrive * 0.18 + thighDrive * 0.12 + toeDrive * 0.16);
        return { supportLoad, compression, ankleDrive, shinDrive, thighDrive, landing, pushOff };
    };

    const leftChain = buildChainMetrics(false, effectivePinStrengthL);
    const rightChain = buildChainMetrics(true, effectivePinStrengthR);
    const groundReaction = (leftChain.landing + rightChain.landing) - (leftChain.pushOff + rightChain.pushOff);
    const groundBounce = clamp(
        groundReaction * GROUNDING_PHYSICS.GROUND_BOUNCE_FACTOR,
        -baseUnitH * 0.08,
        baseUnitH * 0.05,
    );
    const bounceBlend = clamp((deltaTime / 48) * transitionSmoothing, GROUNDING_PHYSICS.GROUND_BOUNCE_RESPONSE, 0.5);
    currentBodyY = lerp(currentBodyY, currentBodyY + groundBounce, bounceBlend);
    
    const totalTension = (tensions[PartName.LAnkle] || 0) + (tensions[PartName.RAnkle] || 0);
    if (totalTension > GROUNDING_PHYSICS.VERTICALITY_TENSION_THRESHOLD * ((pinStrengthL > 0.5 && pinStrengthR > 0.5) ? 2 : 1)) {
        const straightenFactor = GROUNDING_PHYSICS.VERTICALITY_STRAIGHTEN_FACTOR;
        adjustedPose.waist = lerp(adjustedPose.waist ?? 0, 0, straightenFactor);
        adjustedPose.torso = lerp(adjustedPose.torso ?? 0, 0, straightenFactor);
        adjustedPose.collar = lerp(adjustedPose.collar ?? 0, 0, straightenFactor);
    }
    
    const kneeBend = Math.max(adjustedPose.l_knee ?? 0, adjustedPose.r_knee ?? 0);
    if (kneeBend > GROUNDING_PHYSICS.GRAVITY_OVERLOAD_KNEE_BEND_THRESHOLD) {
        const overloadFactor = (kneeBend - GROUNDING_PHYSICS.GRAVITY_OVERLOAD_KNEE_BEND_THRESHOLD) / (180 - GROUNDING_PHYSICS.GRAVITY_OVERLOAD_KNEE_BEND_THRESHOLD);
        currentBodyX = lerp(currentBodyX, 0, GROUNDING_PHYSICS.GRAVITY_OVERLOAD_CENTERING_FACTOR * overloadFactor);
    }

    adjustedPose.x_offset = currentBodyX;
    adjustedPose.y_offset = currentBodyY;

    const footState = {
        weightBearingFoot: contactPose
            ? 'both'
            : (effectivePinStrengthL >= effectivePinStrengthR ? 'left' : 'right'),
        swingFoot: contactPose
            ? null
            : (effectivePinStrengthL >= effectivePinStrengthR ? 'right' : 'left'),
        contactPose,
        leftContact: leftContactScore,
        rightContact: rightContactScore,
        supportLoad: clamp(leftChain.supportLoad + rightChain.supportLoad, 0, 2),
        groundBounce,
        leftChain: leftChain.landing - leftChain.pushOff,
        rightChain: rightChain.landing - rightChain.pushOff,
        leftCompression: leftChain.compression,
        rightCompression: rightChain.compression,
    } as const;

    return { adjustedPose, tensions, footState };
};

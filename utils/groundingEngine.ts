
// utils/groundingEngine.ts

import { WalkingEnginePose, WalkingEngineProportions, PhysicsControls, PartName, IdleSettings, Vector2D, GroundingResults } from '../types';
import { MANNEQUIN_LOCAL_FLOOR_Y, GROUNDING_PHYSICS, ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT } from '../constants';
import { lerp, clamp, solve2DJointIK } from './kinematics';
import { calculateFootTipGlobalPosition } from './locomotionEngine';

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

    const lFootNatural = calculateFootTipGlobalPosition({ 
        hip: adjustedPose.l_hip ?? 0, 
        knee: adjustedPose.l_knee ?? 0, 
        foot: adjustedPose.l_foot ?? 0, 
    }, props, baseUnitH, false);

    const rFootNatural = calculateFootTipGlobalPosition({ 
        hip: adjustedPose.r_hip ?? 0, 
        knee: adjustedPose.r_knee ?? 0, 
        foot: adjustedPose.r_foot ?? 0, 
    }, props, baseUnitH, true);

    const idleGroundingBonus = locomotionWeight < 0.2 ? 1.5 : 1.0;
    const yCorrectionStrength = GROUNDING_PHYSICS.GROUNDING_SPRING_FACTOR * (1 - physics.jointElasticity) * idleGroundingBonus;
    const xCorrectionStrength = GROUNDING_PHYSICS.GROUNDING_X_STABILITY_FACTOR * (1 - physics.stabilization);

    if (pinStrengthL > 0.01 || pinStrengthR > 0.01) {
        const thighLengthL = (props.l_upper_leg?.h ?? 1) * ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_UPPER * baseUnitH;
        const calfLengthL = (props.l_lower_leg?.h ?? 1) * ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_LOWER * baseUnitH;
        const thighLengthR = (props.r_upper_leg?.h ?? 1) * ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_UPPER * baseUnitH;
        const calfLengthR = (props.r_lower_leg?.h ?? 1) * ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_LOWER * baseUnitH;
        
        const maxLegReachL = thighLengthL + calfLengthL;
        const maxLegReachR = thighLengthR + calfLengthR;

        const crouchFactor = clamp(Math.abs(currentBodyY) / (baseUnitH * 1.5), 0, 1);
        const dynamicSpread = baseUnitH * lerp(GROUNDING_PHYSICS.STABILITY_SPRING_BASE_SPREAD_H_UNIT, GROUNDING_PHYSICS.STABILITY_SPRING_CROUCH_SPREAD_H_UNIT, crouchFactor);

        let yCorrection = 0;
        let totalPinWeight = 0;

        const calculateYCorrection = (isRight: boolean, weight: number) => {
            const reach = isRight ? maxLegReachR : maxLegReachL;
            const footNatY = isRight ? rFootNatural.y : lFootNatural.y;
            
            let targetAnkleX = 0;
            if (pinStrengthL > 0.5 && pinStrengthR > 0.5) {
                targetAnkleX = isRight ? dynamicSpread : -dynamicSpread;
            } else if (pinStrengthL > 0.5) {
                targetAnkleX = -dynamicSpread * 0.5;
            } else if (pinStrengthR > 0.5) {
                targetAnkleX = dynamicSpread * 0.5;
            }

            const hipToTargetX = targetAnkleX - currentBodyX;
            const hipToTargetX_sq = hipToTargetX * hipToTargetX;

            const transitionTargetY = lerp(footNatY + currentBodyY, floorYGlobal, weight);

            if (hipToTargetX_sq > reach * reach) {
                const xOffsetCorr = (Math.abs(hipToTargetX) - (reach * 0.99)) * Math.sign(hipToTargetX);
                currentBodyX += xOffsetCorr * xCorrectionStrength * weight;
                return (transitionTargetY - currentBodyY) * weight;
            }

            const requiredYDist = Math.sqrt(reach * reach - hipToTargetX_sq);
            const requiredHipY = transitionTargetY - requiredYDist;
            return (requiredHipY - currentBodyY) * weight;
        };

        if (pinStrengthL > 0.01) {
            yCorrection += calculateYCorrection(false, pinStrengthL);
            totalPinWeight += pinStrengthL;
        }
        if (pinStrengthR > 0.01) {
            yCorrection += calculateYCorrection(true, pinStrengthR);
            totalPinWeight += pinStrengthR;
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

        if (pinStrengthL > 0.01) solveAndApplyIK(false, pinStrengthL);
        if (pinStrengthR > 0.01) solveAndApplyIK(true, pinStrengthR);
        
    } else {
        const lowestFootY = Math.min(lFootNatural.y + currentBodyY, rFootNatural.y + currentBodyY);
        
        if (lowestFootY > floorYGlobal - GROUNDING_PHYSICS.FOOT_LIFT_THRESHOLD_H_UNIT * baseUnitH) {
            const correctionY = floorYGlobal - lowestFootY;
            currentBodyY = lerp(currentBodyY, currentBodyY + correctionY, yCorrectionStrength);
        }

        const betweenAnklesX = (lFootNatural.x + rFootNatural.x) * 0.5;
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

    return { adjustedPose, tensions };
};

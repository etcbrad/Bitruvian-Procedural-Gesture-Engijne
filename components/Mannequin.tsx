
import React, { useMemo, useCallback } from 'react';
import { Bone } from './Bone';
import { ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT, RIGGING, CUTOUT_GAP_SIZE } from '../constants'; 
import { WalkingEnginePose, WalkingEngineProportions, WalkingEnginePivotOffsets, Vector2D, JointModesState, LotteSettings, PartName } from '../types';

interface MannequinProps {
  pose: WalkingEnginePose;
  bodyRotation: number;
  pivotOffsets: Record<string, number>;
  props: WalkingEngineProportions;
  showPivots: boolean;
  baseUnitH: number;
  onAnchorMouseDown: (boneKey: keyof WalkingEnginePivotOffsets, clientX: number) => void;
  draggingBoneKey: keyof WalkingEnginePivotOffsets | null;
  isPaused: boolean;
  activePins: string[];
  tensions: Record<string, number>;
  jointModes: JointModesState;
  lotteSettings: LotteSettings;
  ghosts?: { phase: number; color: string; opacity: number }[];
  ghostDataGenerator?: (phase: number) => Partial<WalkingEnginePose>;
}

const RENDER_ORDER: (keyof WalkingEngineProportions)[] = [
    'waist', 'torso', 'l_upper_leg', 'r_upper_leg', 'l_lower_leg', 'r_lower_leg', 'l_foot', 'r_foot',
    'collar', 'l_upper_arm', 'r_upper_arm', 'head', 'l_lower_arm', 'r_lower_arm', 'l_hand', 'r_hand'
];

const partDefinitions: Record<keyof WalkingEngineProportions, any> = {
    head: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.HEAD, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.HEAD_WIDTH, variant: 'head-tall-oval', drawsUpwards: true, label: 'Head', boneKey: 'neck' },
    collar: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.COLLAR, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.COLLAR_WIDTH, variant: 'collar-horizontal-oval-shape', drawsUpwards: true, label: 'Collar', boneKey: 'collar' },
    torso: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.TORSO, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.TORSO_WIDTH, variant: 'torso-teardrop-pointy-down', drawsUpwards: true, label: 'Torso', boneKey: 'torso' },
    waist: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.WAIST, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.WAIST_WIDTH, variant: 'waist-teardrop-pointy-up', drawsUpwards: true, label: 'Waist', boneKey: 'waist' },
    r_upper_arm: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.UPPER_ARM, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_ARM, variant: 'deltoid-shape', label: 'R.Bicep', boneKey: PartName.RShoulder },
    r_lower_arm: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LOWER_ARM, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_FOREARM, variant: 'limb-tapered', label: 'R.Forearm', boneKey: PartName.RElbow },
    r_hand: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.HAND, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.HAND_WIDTH, variant: 'hand-foot-arrowhead-shape', label: 'R.Hand', boneKey: PartName.RWrist },
    l_upper_arm: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.UPPER_ARM, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_ARM, variant: 'deltoid-shape', label: 'L.Bicep', boneKey: PartName.LShoulder },
    l_lower_arm: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LOWER_ARM, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_FOREARM, variant: 'limb-tapered', label: 'L.Forearm', boneKey: PartName.LElbow },
    l_hand: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.HAND, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.HAND_WIDTH, variant: 'hand-foot-arrowhead-shape', label: 'L.Hand', boneKey: PartName.LWrist },
    r_upper_leg: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_UPPER, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_THIGH, variant: 'limb-tapered', label: 'R.Thigh', boneKey: PartName.RThigh },
    r_lower_leg: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_LOWER, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_CALF, variant: 'limb-tapered', label: 'R.Calf', boneKey: PartName.RKnee },
    r_foot: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.FOOT, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.FOOT_WIDTH, variant: 'hand-foot-arrowhead-shape', label: 'R.Foot', boneKey: PartName.RAnkle },
    l_upper_leg: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_UPPER, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_THIGH, variant: 'limb-tapered', label: 'L.Thigh', boneKey: PartName.LThigh },
    l_lower_leg: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_LOWER, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_CALF, variant: 'limb-tapered', label: 'L.Calf', boneKey: PartName.LKnee },
    l_foot: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.FOOT, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.FOOT_WIDTH, variant: 'hand-foot-arrowhead-shape', label: 'L.Foot', boneKey: PartName.LAnkle },
};

const rotateVec = (vec: Vector2D, angleDeg: number): Vector2D => {
  const r = angleDeg * Math.PI / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: vec.x * c - vec.y * s, y: vec.x * s + vec.y * c };
};
const addVec = (v1: Vector2D, v2: Vector2D): Vector2D => ({ x: v1.x + v2.x, y: v1.y + v2.y });

export const Mannequin: React.FC<MannequinProps> = ({
  pose, bodyRotation, pivotOffsets, props, showPivots, baseUnitH,
  onAnchorMouseDown, draggingBoneKey, isPaused,
  activePins, tensions, jointModes, lotteSettings, ghosts, ghostDataGenerator
}) => {
    const getScaledDimension = useCallback((rawAnatomyValue: number, propKey: keyof WalkingEngineProportions, axis: 'w' | 'h') => {
        const propScale = props[propKey]?.[axis] || 1;
        return rawAnatomyValue * baseUnitH * propScale;
    }, [props, baseUnitH]);

    const calculateTransforms = useCallback((currentPose: WalkingEnginePose) => {
        const transforms: Partial<Record<keyof WalkingEngineProportions, { position: Vector2D; rotation: number }>> = {};
        const isCutoutMode = lotteSettings.enabled && lotteSettings.cutoutSnap;

        const getRotation = (partKey: string) => {
            const partRotation = (currentPose as any)[partKey] || 0;
            const offset = (pivotOffsets as any)[partKey] || 0; 
            return partRotation + offset;
        };

        const getDrawLength = (rawAnatomyValue: number, propKey: keyof WalkingEngineProportions, axis: 'h'): number => {
            const fullLength = getScaledDimension(rawAnatomyValue, propKey, axis);
            return isCutoutMode ? Math.max(0, fullLength - CUTOUT_GAP_SIZE * 2) : fullLength;
        };

        const getChildPivotPosition = (parentGlobalPos: Vector2D, parentDrawLength: number, parentGlobalRot: number, drawsParentUpwards: boolean): Vector2D => {
            const yOffset = drawsParentUpwards 
                ? -(parentDrawLength + (isCutoutMode ? CUTOUT_GAP_SIZE * 2 : 0)) 
                : (parentDrawLength + (isCutoutMode ? CUTOUT_GAP_SIZE * 2 : 0));
            return addVec(parentGlobalPos, rotateVec({ x: 0, y: yOffset }, parentGlobalRot));
        };

        // WAIST (Root)
        const waistDrawLen = getDrawLength(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.WAIST, 'waist', 'h');
        const waistRot = getRotation(PartName.Waist) + bodyRotation;
        transforms.waist = { position: { x: 0, y: 0 }, rotation: waistRot };

        // TORSO
        const torsoDrawLen = getDrawLength(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.TORSO, 'torso', 'h');
        const torsoPos = getChildPivotPosition(transforms.waist.position, waistDrawLen, waistRot, true);
        const torsoRot = waistRot + getRotation(PartName.Torso);
        transforms.torso = { position: torsoPos, rotation: torsoRot };

        // COLLAR (Master Parent for Head/Arms - Redesign Phase 0.2)
        const collarDrawLen = getDrawLength(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.COLLAR, 'collar', 'h');
        const collarStartPos = getChildPivotPosition(torsoPos, torsoDrawLen, torsoRot, true);
        const collarRot = torsoRot + getRotation(PartName.Collar);
        transforms.collar = { position: collarStartPos, rotation: collarRot };
        
        // HEAD (Child of Collar)
        const headPos = getChildPivotPosition(collarStartPos, collarDrawLen, collarRot, true);
        const headRot = collarRot + getRotation('neck');
        transforms.head = { position: headPos, rotation: headRot };

        // ARMS (Children of Collar - Low Anchors)
        const armAnchorsY = RIGGING.SHOULDER_Y_OFFSET_FROM_COLLAR_END * baseUnitH;
        
        const rShoulderOffset = {x: RIGGING.R_SHOULDER_X_OFFSET_FROM_COLLAR_CENTER * baseUnitH, y: armAnchorsY};
        const rShoulderStartPos = addVec(collarStartPos, rotateVec({x: rShoulderOffset.x, y: -collarDrawLen + rShoulderOffset.y}, collarRot)); 
        const rShoulderRot = collarRot + getRotation(PartName.RShoulder);
        transforms.r_upper_arm = { position: rShoulderStartPos, rotation: rShoulderRot };

        const rUpperArmLen = getDrawLength(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.UPPER_ARM, 'r_upper_arm', 'h'); 
        const rElbowPos = getChildPivotPosition(rShoulderStartPos, rUpperArmLen, rShoulderRot, false);
        const rElbowRot = rShoulderRot + getRotation(PartName.RElbow);
        transforms.r_lower_arm = {position: rElbowPos, rotation: rElbowRot};

        const rLowerArmLen = getDrawLength(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LOWER_ARM, 'r_lower_arm', 'h'); 
        const rHandPos = getChildPivotPosition(rElbowPos, rLowerArmLen, rElbowRot, false);
        const rHandRot = rElbowRot + getRotation(PartName.RWrist);
        transforms.r_hand = {position: rHandPos, rotation: rHandRot};

        const lShoulderOffset = {x: RIGGING.L_SHOULDER_X_OFFSET_FROM_COLLAR_CENTER * baseUnitH, y: armAnchorsY};
        const lShoulderStartPos = addVec(collarStartPos, rotateVec({x: lShoulderOffset.x, y: -collarDrawLen + lShoulderOffset.y}, collarRot)); 
        const lShoulderRot = collarRot + getRotation(PartName.LShoulder);
        transforms.l_upper_arm = { position: lShoulderStartPos, rotation: lShoulderRot };

        const lUpperArmLen = getDrawLength(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.UPPER_ARM, 'l_upper_arm', 'h'); 
        const lElbowPos = getChildPivotPosition(lShoulderStartPos, lUpperArmLen, lShoulderRot, false);
        const lElbowRot = lShoulderRot + getRotation(PartName.LElbow);
        transforms.l_lower_arm = {position: lElbowPos, rotation: lElbowRot};

        const lLowerArmLen = getDrawLength(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LOWER_ARM, 'l_lower_arm', 'h'); 
        const lHandPos = getChildPivotPosition(lElbowPos, lLowerArmLen, lElbowRot, false);
        const lHandRot = lElbowRot + getRotation(PartName.LWrist);
        transforms.l_hand = {position: lHandPos, rotation: lHandRot};

        // LEGS (FK)
        const legsPos = { x: 0, y: 0 };
        const rThighRot = bodyRotation + getRotation(PartName.RThigh);
        transforms.r_upper_leg = {position: legsPos, rotation: rThighRot};
        const rThighLen = getDrawLength(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_UPPER, 'r_upper_leg', 'h'); 
        const rKneePos = getChildPivotPosition(legsPos, rThighLen, rThighRot, false);
        const rKneeRot = rThighRot + getRotation(PartName.RKnee);
        transforms.r_lower_leg = {position: rKneePos, rotation: rKneeRot};
        const rLowerLegLen = getDrawLength(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_LOWER, 'r_lower_leg', 'h'); 
        const rFootPos = getChildPivotPosition(rKneePos, rLowerLegLen, rKneeRot, false);
        const rFootRot = rKneeRot + getRotation(PartName.RAnkle);
        transforms.r_foot = {position: rFootPos, rotation: rFootRot};
        const rFootLen = getDrawLength(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.FOOT, 'r_foot', 'h'); 

        const lThighRot = bodyRotation + getRotation(PartName.LThigh);
        transforms.l_upper_leg = {position: legsPos, rotation: lThighRot};
        const lThighLen = getDrawLength(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_UPPER, 'l_upper_leg', 'h'); 
        const lKneePos = getChildPivotPosition(legsPos, lThighLen, lThighRot, false);
        const lKneeRot = lThighRot + getRotation(PartName.LKnee);
        transforms.l_lower_leg = {position: lKneePos, rotation: lKneeRot};
        const lLowerLegLen = getDrawLength(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_LOWER, 'l_lower_leg', 'h'); 
        const lFootPos = getChildPivotPosition(lKneePos, lLowerLegLen, lKneeRot, false);
        const lFootRot = lKneeRot + getRotation(PartName.LAnkle);
        transforms.l_foot = {position: lFootPos, rotation: lFootRot};
        const lFootLen = getDrawLength(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.FOOT, 'l_foot', 'h'); 

        return transforms;
    }, [bodyRotation, pivotOffsets, baseUnitH, lotteSettings.enabled, lotteSettings.cutoutSnap, getScaledDimension]);

    const activeTransforms = useMemo(() => calculateTransforms(pose), [calculateTransforms, pose]);

    return (
        <g>
            {RENDER_ORDER.map(partKey => {
                const partProps = partDefinitions[partKey];
                const target = activeTransforms[partKey];
                if (!target) return null;
                const boneKey = partProps.boneKey as keyof WalkingEnginePivotOffsets;
                const isPinned = Array.isArray(activePins) && activePins.includes(boneKey);
                const currentTension = tensions[boneKey] || 0;
                const boneLength = getScaledDimension(partProps.rawH, partKey, 'h');
                const boneWidth = getScaledDimension(partProps.rawW, partKey, 'w');

                return (
                    <g key={String(partKey)} transform={`translate(${target.position.x}, ${target.position.y}) rotate(${target.rotation})`}>
                        <Bone 
                            rotation={0} length={boneLength} width={boneWidth} variant={partProps.variant}
                            drawsUpwards={partProps.drawsUpwards} boneKey={boneKey} proportionKey={partKey}
                            visible={true} colorClass={partKey === 'collar' ? 'fill-olive' : 'fill-black'}
                            showPivots={showPivots} onAnchorMouseDown={onAnchorMouseDown}
                            isBeingDragged={draggingBoneKey === partProps.boneKey}
                            isPausedAndPivotsVisible={showPivots} isPinned={isPinned} tension={currentTension}
                        />
                    </g>
                );
            })}
        </g>
    );
};

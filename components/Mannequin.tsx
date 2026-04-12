import React, { useCallback, useMemo } from 'react';
import { Bone } from './Bone';
import { ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT, RIGGING, CUTOUT_GAP_SIZE } from '../constants';
import {
  JointModesState,
  LotteSettings,
  PartName,
  Vector2D,
  WalkingEnginePivotOffsets,
  WalkingEnginePose,
  WalkingEngineProportions,
} from '../types';

interface MannequinProps {
  pose: WalkingEnginePose;
  bodyRotation: number;
  pivotOffsets: Record<string, number>;
  props: WalkingEngineProportions;
  showPivots: boolean;
  showLabels?: boolean;
  baseUnitH: number;
  onAnchorMouseDown: (boneKey: keyof WalkingEnginePivotOffsets, clientX: number, event: React.MouseEvent) => void;
  onBodyMouseDown?: (boneKey: keyof WalkingEnginePivotOffsets, clientX: number, event: React.MouseEvent) => void;
  draggingBoneKey: keyof WalkingEnginePivotOffsets | null;
  isPaused: boolean;
  poserActive?: boolean;
  activePins: string[];
  tensions: Record<string, number>;
  jointModes: JointModesState;
  lotteSettings: LotteSettings;
  isExploded?: boolean;
}

const RENDER_ORDER: (keyof WalkingEngineProportions)[] = [
  'waist',
  'torso',
  'l_upper_leg',
  'r_upper_leg',
  'l_lower_leg',
  'r_lower_leg',
  'l_foot',
  'r_foot',
  'collar',
  'l_upper_arm',
  'r_upper_arm',
  'head',
  'l_lower_arm',
  'r_lower_arm',
  'l_hand',
  'r_hand',
];

type PartDefinition = {
  rawH: number;
  rawW: number;
  variant: string;
  drawsUpwards?: boolean;
  label: string;
  boneKey: keyof WalkingEnginePivotOffsets;
};

const partDefinitions: Record<keyof WalkingEngineProportions, PartDefinition> = {
  head: {
    rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.HEAD,
    rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.HEAD_WIDTH,
    variant: 'head-tall-oval',
    drawsUpwards: true,
    label: 'Head',
    boneKey: 'neck',
  },
  collar: {
    rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.COLLAR,
    rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.COLLAR_WIDTH,
    variant: 'collar-horizontal-oval-shape',
    drawsUpwards: true,
    label: 'Collar',
    boneKey: 'collar',
  },
  torso: {
    rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.TORSO,
    rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.TORSO_WIDTH,
    variant: 'torso-teardrop-pointy-down',
    drawsUpwards: true,
    label: 'Torso',
    boneKey: 'torso',
  },
  waist: {
    rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.WAIST,
    rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.WAIST_WIDTH,
    variant: 'waist-teardrop-pointy-up',
    drawsUpwards: true,
    label: 'Waist',
    boneKey: 'waist',
  },
  r_upper_arm: {
    rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.UPPER_ARM,
    rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_ARM,
    variant: 'deltoid-shape',
    label: 'R.Bicep',
    boneKey: PartName.RShoulder,
  },
  r_lower_arm: {
    rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LOWER_ARM,
    rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_FOREARM,
    variant: 'limb-tapered',
    label: 'R.Forearm',
    boneKey: PartName.RElbow,
  },
  r_hand: {
    rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.HAND,
    rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.HAND_WIDTH,
    variant: 'hand-foot-arrowhead-shape',
    label: 'R.Hand',
    boneKey: PartName.RWrist,
  },
  l_upper_arm: {
    rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.UPPER_ARM,
    rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_ARM,
    variant: 'deltoid-shape',
    label: 'L.Bicep',
    boneKey: PartName.LShoulder,
  },
  l_lower_arm: {
    rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LOWER_ARM,
    rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_FOREARM,
    variant: 'limb-tapered',
    label: 'L.Forearm',
    boneKey: PartName.LElbow,
  },
  l_hand: {
    rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.HAND,
    rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.HAND_WIDTH,
    variant: 'hand-foot-arrowhead-shape',
    label: 'L.Hand',
    boneKey: PartName.LWrist,
  },
  r_upper_leg: {
    rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_UPPER,
    rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_THIGH,
    variant: 'limb-tapered',
    label: 'R.Thigh',
    boneKey: PartName.RThigh,
  },
  r_lower_leg: {
    rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_LOWER,
    rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_CALF,
    variant: 'limb-tapered',
    label: 'R.Calf',
    boneKey: PartName.RKnee,
  },
  r_foot: {
    rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.FOOT,
    rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.FOOT_WIDTH,
    variant: 'hand-foot-arrowhead-shape',
    label: 'R.Foot',
    boneKey: PartName.RAnkle,
  },
  l_upper_leg: {
    rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_UPPER,
    rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_THIGH,
    variant: 'limb-tapered',
    label: 'L.Thigh',
    boneKey: PartName.LThigh,
  },
  l_lower_leg: {
    rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_LOWER,
    rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_CALF,
    variant: 'limb-tapered',
    label: 'L.Calf',
    boneKey: PartName.LKnee,
  },
  l_foot: {
    rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.FOOT,
    rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.FOOT_WIDTH,
    variant: 'hand-foot-arrowhead-shape',
    label: 'L.Foot',
    boneKey: PartName.LAnkle,
  },
};

const EXPLODED_LAYOUT_POSITIONS: Record<keyof WalkingEngineProportions, Vector2D> = {
  head: { x: 0, y: -290 },
  collar: { x: 0, y: -170 },
  torso: { x: 0, y: -40 },
  waist: { x: 0, y: 100 },
  l_upper_arm: { x: -260, y: -120 },
  l_lower_arm: { x: -260, y: 30 },
  l_hand: { x: -260, y: 170 },
  r_upper_arm: { x: 260, y: -120 },
  r_lower_arm: { x: 260, y: 30 },
  r_hand: { x: 260, y: 170 },
  l_upper_leg: { x: -120, y: 250 },
  l_lower_leg: { x: -120, y: 410 },
  l_foot: { x: -120, y: 555 },
  r_upper_leg: { x: 120, y: 250 },
  r_lower_leg: { x: 120, y: 410 },
  r_foot: { x: 120, y: 555 },
};

const rotateVec = (vec: Vector2D, angleDeg: number): Vector2D => {
  const r = angleDeg * Math.PI / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: vec.x * c - vec.y * s, y: vec.x * s + vec.y * c };
};

const addVec = (a: Vector2D, b: Vector2D): Vector2D => ({ x: a.x + b.x, y: a.y + b.y });

export const Mannequin: React.FC<MannequinProps> = ({
  pose,
  bodyRotation,
  pivotOffsets,
  props,
  showPivots,
  showLabels = false,
  baseUnitH,
  onAnchorMouseDown,
  onBodyMouseDown,
  draggingBoneKey,
  isPaused,
  poserActive = false,
  activePins,
  tensions,
  jointModes,
  lotteSettings,
  isExploded = false,
}) => {
  const getScaledDimension = useCallback((rawAnatomyValue: number, propKey: keyof WalkingEngineProportions, axis: 'w' | 'h') => {
    const propScale = props[propKey]?.[axis] || 1;
    return rawAnatomyValue * baseUnitH * propScale;
  }, [props, baseUnitH]);

  const calculateTransforms = useCallback((currentPose: WalkingEnginePose) => {
    const transforms: Partial<Record<keyof WalkingEngineProportions, { position: Vector2D; rotation: number }>> = {};
    const isCutoutMode = lotteSettings.enabled && lotteSettings.cutoutSnap;

    const getRotation = (partKey: keyof WalkingEnginePose | string) => {
      const partRotation = (currentPose as any)[partKey] || 0;
      const offset = (pivotOffsets as any)[partKey] || 0;
      return partRotation + offset;
    };

    const getDrawLength = (rawAnatomyValue: number, propKey: keyof WalkingEngineProportions): number => {
      const fullLength = getScaledDimension(rawAnatomyValue, propKey, 'h');
      return isCutoutMode ? Math.max(0, fullLength - CUTOUT_GAP_SIZE * 2) : fullLength;
    };

    const getChildPivotPosition = (parentGlobalPos: Vector2D, parentDrawLength: number, parentGlobalRot: number, drawsParentUpwards: boolean): Vector2D => {
      const yOffset = drawsParentUpwards
        ? -(parentDrawLength + (isCutoutMode ? CUTOUT_GAP_SIZE * 2 : 0))
        : (parentDrawLength + (isCutoutMode ? CUTOUT_GAP_SIZE * 2 : 0));
      return addVec(parentGlobalPos, rotateVec({ x: 0, y: yOffset }, parentGlobalRot));
    };

    const waistDrawLen = getDrawLength(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.WAIST, 'waist');
    const waistRot = getRotation(PartName.Waist) + bodyRotation;
    transforms.waist = { position: { x: 0, y: 0 }, rotation: waistRot };

    const torsoDrawLen = getDrawLength(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.TORSO, 'torso');
    const torsoPos = getChildPivotPosition(transforms.waist.position, waistDrawLen, waistRot, true);
    const torsoRot = waistRot + getRotation(PartName.Torso);
    transforms.torso = { position: torsoPos, rotation: torsoRot };

    const collarDrawLen = getDrawLength(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.COLLAR, 'collar');
    const collarStartPos = getChildPivotPosition(torsoPos, torsoDrawLen, torsoRot, true);
    const collarRot = torsoRot + getRotation(PartName.Collar);
    transforms.collar = { position: collarStartPos, rotation: collarRot };

    const headPos = getChildPivotPosition(collarStartPos, collarDrawLen, collarRot, true);
    const headRot = collarRot + getRotation('neck');
    transforms.head = { position: headPos, rotation: headRot };

    const armAnchorsY = RIGGING.SHOULDER_Y_OFFSET_FROM_COLLAR_END * baseUnitH;

    const rShoulderOffset = { x: RIGGING.R_SHOULDER_X_OFFSET_FROM_COLLAR_CENTER * baseUnitH, y: armAnchorsY };
    const rShoulderStartPos = addVec(collarStartPos, rotateVec({ x: rShoulderOffset.x, y: -collarDrawLen + rShoulderOffset.y }, collarRot));
    const rShoulderRot = collarRot + getRotation(PartName.RShoulder);
    transforms.r_upper_arm = { position: rShoulderStartPos, rotation: rShoulderRot };

    const rUpperArmLen = getDrawLength(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.UPPER_ARM, 'r_upper_arm');
    const rElbowPos = getChildPivotPosition(rShoulderStartPos, rUpperArmLen, rShoulderRot, false);
    const rElbowRot = rShoulderRot + getRotation(PartName.RElbow);
    transforms.r_lower_arm = { position: rElbowPos, rotation: rElbowRot };

    const rLowerArmLen = getDrawLength(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LOWER_ARM, 'r_lower_arm');
    const rHandPos = getChildPivotPosition(rElbowPos, rLowerArmLen, rElbowRot, false);
    const rHandRot = rElbowRot + getRotation(PartName.RWrist);
    transforms.r_hand = { position: rHandPos, rotation: rHandRot };

    const lShoulderOffset = { x: RIGGING.L_SHOULDER_X_OFFSET_FROM_COLLAR_CENTER * baseUnitH, y: armAnchorsY };
    const lShoulderStartPos = addVec(collarStartPos, rotateVec({ x: lShoulderOffset.x, y: -collarDrawLen + lShoulderOffset.y }, collarRot));
    const lShoulderRot = collarRot + getRotation(PartName.LShoulder);
    transforms.l_upper_arm = { position: lShoulderStartPos, rotation: lShoulderRot };

    const lUpperArmLen = getDrawLength(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.UPPER_ARM, 'l_upper_arm');
    const lElbowPos = getChildPivotPosition(lShoulderStartPos, lUpperArmLen, lShoulderRot, false);
    const lElbowRot = lShoulderRot + getRotation(PartName.LElbow);
    transforms.l_lower_arm = { position: lElbowPos, rotation: lElbowRot };

    const lLowerArmLen = getDrawLength(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LOWER_ARM, 'l_lower_arm');
    const lHandPos = getChildPivotPosition(lElbowPos, lLowerArmLen, lElbowRot, false);
    const lHandRot = lElbowRot + getRotation(PartName.LWrist);
    transforms.l_hand = { position: lHandPos, rotation: lHandRot };

    const legsPos = { x: 0, y: 0 };
    const rThighRot = bodyRotation + getRotation(PartName.RThigh);
    transforms.r_upper_leg = { position: legsPos, rotation: rThighRot };
    const rThighLen = getDrawLength(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_UPPER, 'r_upper_leg');
    const rKneePos = getChildPivotPosition(legsPos, rThighLen, rThighRot, false);
    const rKneeRot = rThighRot + getRotation(PartName.RKnee);
    transforms.r_lower_leg = { position: rKneePos, rotation: rKneeRot };
    const rLowerLegLen = getDrawLength(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_LOWER, 'r_lower_leg');
    const rFootPos = getChildPivotPosition(rKneePos, rLowerLegLen, rKneeRot, false);
    const rFootRot = rKneeRot + getRotation(PartName.RAnkle);
    transforms.r_foot = { position: rFootPos, rotation: rFootRot };

    const lThighRot = bodyRotation + getRotation(PartName.LThigh);
    transforms.l_upper_leg = { position: legsPos, rotation: lThighRot };
    const lThighLen = getDrawLength(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_UPPER, 'l_upper_leg');
    const lKneePos = getChildPivotPosition(legsPos, lThighLen, lThighRot, false);
    const lKneeRot = lThighRot + getRotation(PartName.LKnee);
    transforms.l_lower_leg = { position: lKneePos, rotation: lKneeRot };
    const lLowerLegLen = getDrawLength(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_LOWER, 'l_lower_leg');
    const lFootPos = getChildPivotPosition(lKneePos, lLowerLegLen, lKneeRot, false);
    const lFootRot = lKneeRot + getRotation(PartName.LAnkle);
    transforms.l_foot = { position: lFootPos, rotation: lFootRot };

    return transforms;
  }, [bodyRotation, pivotOffsets, baseUnitH, lotteSettings.enabled, lotteSettings.cutoutSnap, getScaledDimension]);

  const activeTransforms = useMemo(() => calculateTransforms(pose), [calculateTransforms, pose]);

  const renderPart = (partKey: keyof WalkingEngineProportions) => {
    const partProps = partDefinitions[partKey];
    const target = activeTransforms[partKey];
    if (!target) return null;

    const boneKey = partProps.boneKey;
    const isPinned = Array.isArray(activePins) && activePins.includes(boneKey);
    const currentTension = tensions[boneKey] || 0;
    const jointMode = jointModes[boneKey] ?? 'fk';
    const boneLength = getScaledDimension(partProps.rawH, partKey, 'h');
    const boneWidth = getScaledDimension(partProps.rawW, partKey, 'w');
    const drawVariant = isExploded && partKey !== 'head' && partKey !== 'collar' && partKey !== 'torso' && partKey !== 'waist'
      ? (partKey.includes('foot') ? 'foot-block-shape' : partProps.variant)
      : partProps.variant;

    const position = isExploded ? EXPLODED_LAYOUT_POSITIONS[partKey] : target.position;
    const rotation = target.rotation;

    return (
      <g key={String(partKey)} transform={`translate(${position.x}, ${position.y}) rotate(${rotation})`}>
        <Bone
          rotation={0}
          length={boneLength}
          width={boneWidth}
          variant={drawVariant}
          drawsUpwards={partProps.drawsUpwards}
          boneKey={boneKey}
          proportionKey={partKey}
          visible
          colorClass={partKey === 'collar' ? 'fill-olive' : 'fill-black'}
          showLabel={showLabels || isExploded}
          label={partProps.label}
          showPivots={showPivots}
          onAnchorMouseDown={onAnchorMouseDown}
          onBodyMouseDown={onBodyMouseDown}
          isBeingDragged={draggingBoneKey === boneKey}
          isPausedAndPivotsVisible={(isPaused || poserActive) && showPivots}
          isPinned={isPinned}
          tension={currentTension}
          isBendActive={jointMode === 'bend'}
          isStretchActive={jointMode === 'stretch'}
        />
      </g>
    );
  };

  return (
    <g className="mannequin-root fill-black">
      {showPivots && !isExploded && (
        <circle
          cx="0"
          cy="0"
          r={ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.ROOT_SIZE * baseUnitH * 0.7}
          fill="#DDDDDD"
          stroke="#000000"
          strokeWidth="1"
          data-no-export={true}
        />
      )}

      <g>
        {RENDER_ORDER.map(renderPart)}
      </g>
    </g>
  );
};

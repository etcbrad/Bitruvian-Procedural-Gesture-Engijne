
import React from 'react';
import { Vector2D, WalkingEnginePivotOffsets, WalkingEngineProportions, PartName } from '../types'; 
import { CUTOUT_GAP_SIZE } from '../constants'; 

export interface BoneProps { 
  rotation: number;
  length: number;
  width?: number;
  variant?: string;
  showPivots: boolean;
  visible?: boolean;
  offset?: Vector2D;
  children?: React.ReactNode;
  drawsUpwards?: boolean;
  colorClass?: string;
  boneKey?: keyof WalkingEnginePivotOffsets;
  proportionKey?: keyof WalkingEngineProportions;
  onAnchorMouseDown?: (boneKey: keyof WalkingEnginePivotOffsets, clientX: number) => void;
  isBeingDragged?: boolean;
  isPausedAndPivotsVisible?: boolean;
  patternFillId?: string;
  isPinned?: boolean;
  isBendActive?: boolean;    
  isStretchActive?: boolean; 
  tension?: number; 
  isCutoutMode?: boolean; 
  opacity?: number;
}

export const COLORS = {
  ANCHOR_DEFAULT: "#111827", 
  ANCHOR_TENSION: "#FF2A6D", // High-luminance Pinkish-Red for tension
  SELECTION: "#D1D5DB",
  RIDGE: "#333333",
  PIN_HIGHLIGHT: "#6B7280", 
  DEFAULT_FILL: "#000000",
  ACCENT_STRETCH: "#9CA3AF", 
  ACCENT_BEND: "#4B5563",    
};

const resolveColor = (colorClass?: string): string | undefined => {
  switch (colorClass) {
    case 'fill-olive':
      return '#5D663D';
    case 'fill-black':
      return '#000000';
    case 'fill-mono-dark':
      return '#F9FAFB';
    case 'fill-mono-light':
      return '#6B7280';
    default:
      return undefined;
  }
};

export const Bone: React.FC<BoneProps> = ({
  length, width = 15, variant = 'diamond', showPivots = true, visible = true, offset = { x: 0, y: 0 }, children, drawsUpwards = false, colorClass = "fill-mono-dark", boneKey, onAnchorMouseDown, isBeingDragged = false, isPausedAndPivotsVisible = false, patternFillId, isPinned = false, isBendActive = false, isStretchActive = false, tension = 0, isCutoutMode = false, opacity = 1
}) => {
  const effectiveDrawLength = isCutoutMode ? Math.max(0, length - CUTOUT_GAP_SIZE * 2) : length;
  const visualEndPoint = drawsUpwards ? -effectiveDrawLength : effectiveDrawLength;

  const getBonePath = (boneLength: number, boneWidth: number, varName: string, upwards: boolean): string => {
    const effLen = upwards ? -boneLength : boneLength;
    const hw = boneWidth / 2;
    switch (varName) {
      case 'head-tall-oval': return `M ${-hw*0.4},0 L ${hw*0.4},0 L ${hw},${-boneLength} L ${-hw},${-boneLength} Z`;
      case 'collar-horizontal-oval-shape': return `M ${hw},0 C ${hw*0.6},${-boneLength*0.3} ${hw*0.5},${-boneLength*0.6} ${hw*0.3},${-boneLength} L ${-hw*0.3},${-boneLength} C ${-hw*0.5},${-boneLength*0.6} ${-hw*0.6},${-boneLength*0.3} ${-hw},0 Z`;
      case 'waist-teardrop-pointy-up': return `M ${hw},0 L ${hw*0.2},${-boneLength} L ${-hw*0.2},${-boneLength} L ${-hw},0 Z`;
      case 'torso-teardrop-pointy-down': return `M ${hw*0.4},0 C ${hw*0.4},${-boneLength*0.3} ${hw},${-boneLength*0.7} ${hw},${-boneLength} L ${-hw},${-boneLength} C ${-hw},${-boneLength*0.7} ${-hw*0.4},${-boneLength*0.3} ${-hw*0.4},0 Z`;
      case 'deltoid-shape': return `M ${hw} 0 C ${hw} ${boneLength*0.2} ${hw*1.2} ${boneLength*0.4} ${hw*1.2} ${boneLength*0.7} L 0 ${boneLength} L ${-hw*1.2} ${boneLength*0.7} C ${-hw*1.2} ${boneLength*0.4} ${-hw} ${boneLength*0.2} ${-hw} 0 Z`;
      case 'limb-tapered': return `M ${hw},0 L ${hw*0.6},${effLen} L ${-hw*0.6},${effLen} L ${-hw},0 Z`;
      case 'hand-foot-arrowhead-shape': return `M ${-hw*0.3},0 L ${hw*0.3},0 L 0,${effLen} Z`;
      case 'toe-triangle': return `M ${-hw},0 L ${hw},0 L 0,${effLen} Z`;
      default: return `M 0 0 L ${hw} ${effLen*0.4} L 0 ${effLen} L ${-hw} ${effLen*0.4} Z`;
    }
  };

  const cursorStyle = isPausedAndPivotsVisible ? (isBeingDragged ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default';
  
  // Tension feedback for anchors
  const anchorColor = tension > 0.05 ? COLORS.ANCHOR_TENSION : COLORS.ANCHOR_DEFAULT; 
  const anchorScale = 1 + Math.min(1, tension) * 0.8; 
  const anchorOpacity = Math.min(1, 0.8 + tension * 2); 
  const resolvedColor = resolveColor(colorClass);

  return (
    <g transform={`rotate(0)`} className={colorClass} style={{ opacity, color: resolvedColor }}>
      {visible && (
        <path 
            d={getBonePath(effectiveDrawLength, width, variant, drawsUpwards)} 
            fill={patternFillId || (isBendActive ? COLORS.ACCENT_BEND : "currentColor")} 
            stroke={isStretchActive ? COLORS.ACCENT_STRETCH : COLORS.RIDGE} 
            strokeWidth={0.5} 
            onMouseDown={(e) => isPausedAndPivotsVisible && onAnchorMouseDown && boneKey && onAnchorMouseDown(boneKey, e.clientX)}
            style={{ cursor: isPausedAndPivotsVisible ? 'pointer' : 'default' }}
        />
      )}
      {children}
      {showPivots && visible && boneKey && (
        <g>
          <circle 
            cx="0" cy="0" 
            r={5 * anchorScale} 
            fill={anchorColor} 
            fillOpacity={anchorOpacity}
            stroke="white" 
            strokeWidth="1" 
            className={`drop-shadow-md transition-all duration-200 ${cursorStyle}`}
            onMouseDown={(e) => isPausedAndPivotsVisible && onAnchorMouseDown && onAnchorMouseDown(boneKey, e.clientX)}
          />
          {isPinned && (
              <circle cx="0" cy="0" r={10 * anchorScale} fill="none" stroke={COLORS.PIN_HIGHLIGHT} strokeWidth="1.5" strokeDasharray="3 3">
                  <animateTransform attributeName="transform" type="rotate" from="0 0 0" to="360 0 0" dur="4s" repeatCount="indefinite" />
              </circle>
          )}
        </g>
      )}
    </g>
  );
};

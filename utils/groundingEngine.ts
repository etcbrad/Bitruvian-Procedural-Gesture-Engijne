import { GroundingResults, IdleSettings, PhysicsControls, WalkingEnginePose, WalkingEngineProportions } from '../types';

// Ground awareness is intentionally disabled for now.
// The function stays in place so the rest of the app can keep calling it,
// but it no longer applies any support locking, contact detection, or bounce correction.
export const applyFootGrounding = (
    rawPose: Partial<WalkingEnginePose>,
    _props: WalkingEngineProportions,
    _baseUnitH: number,
    _physics: PhysicsControls,
    _locomotionActivePins: string[],
    _idleSettings: IdleSettings,
    _gravityCenter: 'left' | 'center' | 'right',
    _locomotionWeight: number,
    _deltaTime: number,
): GroundingResults => {
    return {
        adjustedPose: { ...rawPose },
        tensions: {},
        footState: undefined,
    };
};

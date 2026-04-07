import { renderToStaticMarkup } from 'react-dom/server';
import JSZip from 'jszip';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { Mannequin } from '../components/Mannequin';
import { DEFAULT_LOTTE_SETTINGS, DEFAULT_PROPORTIONS, MANNEQUIN_LOCAL_FLOOR_Y } from '../constants';
import { IdleSettings, LotteSettings, WalkingEngineGait, WalkingEnginePivotOffsets, WalkingEnginePose } from '../types';

export type AnimatedExportFormat = 'gif' | 'webm';

export type ExportLoopContext = {
  viewBox: string;
  groundY: number;
  baseUnitH: number;
  gait: WalkingEngineGait;
  idleSettings: IdleSettings;
  activePins: string[];
  pivotOffsets: WalkingEnginePivotOffsets;
  gravityCenter: 'left' | 'center' | 'right';
  lotteSettings?: LotteSettings;
};

export type LoopFrameSample = {
  frameIndex: number;
  timeMs: number;
  phase: number;
  pose: WalkingEnginePose;
};

const EXPORT_BACKGROUND = '#F9FAFB';
const EXPORT_GRID_COLOR = 'rgba(229, 231, 235, 0.85)';

const parseViewBox = (viewBox: string) => {
  const values = viewBox
    .split(/[\s,]+/)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (values.length !== 4) {
    return { x: -500, y: -1100, width: 1000, height: 1000 };
  }

  const [x, y, width, height] = values;
  return { x, y, width, height };
};

const createCanvas = (width: number, height: number): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
};

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (!blob) {
      reject(new Error(`Failed to export ${type}`));
      return;
    }
    resolve(blob);
  }, type, quality);
});

const imageToCanvas = async (canvas: HTMLCanvasElement, svgMarkup: string): Promise<void> => {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable');

  const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = URL.createObjectURL(svgBlob);

  try {
    const image = new Image();
    const ready = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Failed to load export SVG'));
    });
    image.decoding = 'async';
    image.src = objectUrl;
    await ready;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  const delayMs = navigator.webdriver ? 6000 : 250;
  window.setTimeout(() => {
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, delayMs);
};

const makeLoopDurationMs = (gait: WalkingEngineGait): number => {
  const frequency = Math.max(0.001, gait.frequency);
  return (Math.PI * 2) / (0.005 * frequency);
};

const makeFrameCount = (durationMs: number, fps: number): number => {
  const frameSpacing = 1000 / Math.max(1, fps);
  return Math.max(1, Math.round(durationMs / frameSpacing));
};

const buildSamples = (
  context: ExportLoopContext,
  sampleCount: number,
  generatePoseAtPhase: (phase: number) => WalkingEnginePose,
): LoopFrameSample[] => {
  const durationMs = makeLoopDurationMs(context.gait);
  return Array.from({ length: sampleCount }, (_, frameIndex) => {
    const phase = frameIndex / sampleCount;
    const timeMs = durationMs * phase;
    return {
      frameIndex,
      timeMs,
      phase,
      pose: generatePoseAtPhase(phase),
    };
  });
};

const buildExportSvg = (context: ExportLoopContext, pose: WalkingEnginePose): string => {
  const { x, y, width, height } = parseViewBox(context.viewBox);
  const lotteSettings = context.lotteSettings ?? DEFAULT_LOTTE_SETTINGS;
  const sceneY = context.groundY - (MANNEQUIN_LOCAL_FLOOR_Y * context.baseUnitH) + pose.y_offset;
  const sceneX = pose.x_offset;

  return renderToStaticMarkup(
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={context.viewBox}
      width={width}
      height={height}
      shapeRendering="geometricPrecision"
    >
      <defs>
        <pattern id="export-triangle-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M12 0 L0 12 L12 24 L24 12 Z M0 0 L12 24 L24 0 Z" fill="none" stroke={EXPORT_GRID_COLOR} strokeWidth="1" />
        </pattern>
      </defs>
      <rect x={x} y={y} width={width} height={height} fill={EXPORT_BACKGROUND} />
      <rect x={x} y={y} width={width} height={height} fill="url(#export-triangle-grid)" opacity="0.55" />
      <g transform={`translate(${sceneX}, ${sceneY})`}>
        <Mannequin
          pose={pose}
          bodyRotation={pose.bodyRotation ?? 0}
          pivotOffsets={context.pivotOffsets}
          props={DEFAULT_PROPORTIONS}
          showPivots={false}
          baseUnitH={context.baseUnitH}
          onAnchorMouseDown={() => undefined}
          draggingBoneKey={null}
          isPaused={false}
          activePins={context.activePins}
          tensions={{}}
          jointModes={{}}
          lotteSettings={lotteSettings}
          ghosts={[]}
          ghostDataGenerator={() => ({})}
        />
      </g>
    </svg>,
  );
};

const createStamp = () => new Date().toISOString().replace(/[:.]/g, '-');

const yieldToFrame = () => new Promise<void>((resolve) => {
  window.requestAnimationFrame(() => resolve());
});

const exportSamplesAsPngZip = async (
  context: ExportLoopContext,
  samples: LoopFrameSample[],
  fileName: string,
) => {
  const { width, height } = parseViewBox(context.viewBox);
  const canvas = createCanvas(width, height);
  const zip = new JSZip();
  const framesFolder = zip.folder('frames');

  if (!framesFolder) throw new Error('Unable to create zip folder');

  for (const sample of samples) {
    const markup = buildExportSvg(context, sample.pose);
    await imageToCanvas(canvas, markup);
    const png = await canvasToBlob(canvas, 'image/png');
    const frameName = `frame-${String(sample.frameIndex + 1).padStart(4, '0')}.png`;
    framesFolder.file(frameName, png);
    if ((sample.frameIndex + 1) % 4 === 0) {
      await yieldToFrame();
    }
  }

  zip.file(
    'manifest.json',
    JSON.stringify(
      {
        type: 'loop-frames',
        durationMs: makeLoopDurationMs(context.gait),
        frameCount: samples.length,
        fps: samples.length / (makeLoopDurationMs(context.gait) / 1000),
        gravityCenter: context.gravityCenter,
        gait: context.gait,
      },
      null,
      2,
    ),
  );

  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, fileName);
};

const exportKeyframesJson = async (
  context: ExportLoopContext,
  generatePoseAtPhase: (phase: number) => WalkingEnginePose,
  fileName: string,
) => {
  const durationMs = makeLoopDurationMs(context.gait);
  const keyframes = [
    { label: 'start', phase: 0 },
    { label: 'quarter', phase: 0.25 },
    { label: 'half', phase: 0.5 },
    { label: 'three-quarter', phase: 0.75 },
    { label: 'pre-reset', phase: 0.999 },
  ].map((item) => ({
    ...item,
    timeMs: Math.round(durationMs * item.phase),
    pose: generatePoseAtPhase(item.phase),
  }));

  const payload = {
    type: 'keyframes',
    durationMs,
    gravityCenter: context.gravityCenter,
    gait: context.gait,
    idleSettings: context.idleSettings,
    keyframes,
  };

  downloadBlob(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    fileName,
  );
};

const exportGif = async (
  context: ExportLoopContext,
  samples: LoopFrameSample[],
  fileName: string,
) => {
  const { width, height } = parseViewBox(context.viewBox);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  let palette: number[][] | null = null;
  const gif = GIFEncoder({ initialCapacity: width * height * 4 });
  const delay = Math.max(10, Math.round(makeLoopDurationMs(context.gait) / samples.length));

  for (const sample of samples) {
    await imageToCanvas(canvas, buildExportSvg(context, sample.pose));
    const imageData = ctx.getImageData(0, 0, width, height).data;

    if (!palette) {
      palette = quantize(imageData, 256);
    }

    const index = applyPalette(imageData, palette);
    gif.writeFrame(index, width, height, {
      palette,
      delay,
      repeat: 0,
    });
    if ((sample.frameIndex + 1) % 4 === 0) {
      await yieldToFrame();
    }
  }

  gif.finish();
  downloadBlob(new Blob([gif.bytes()], { type: 'image/gif' }), fileName);
};

const exportWebm = async (
  context: ExportLoopContext,
  samples: LoopFrameSample[],
  fileName: string,
) => {
  const { width, height } = parseViewBox(context.viewBox);
  const canvas = createCanvas(width, height);
  const fps = Math.max(1, Math.round(samples.length / (makeLoopDurationMs(context.gait) / 1000)));
  const stream = canvas.captureStream(fps);
  const preferredTypes = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  const mimeType = preferredTypes.find((type) => MediaRecorder.isTypeSupported(type));

  if (!mimeType) {
    throw new Error('WebM recording is not supported in this browser');
  }

  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, { mimeType });

  const finished = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = () => reject(new Error('WebM export failed'));
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });

  recorder.start();

  const frameDelay = Math.max(8, Math.round(makeLoopDurationMs(context.gait) / samples.length));
  for (const sample of samples) {
    await imageToCanvas(canvas, buildExportSvg(context, sample.pose));
    await new Promise((resolve) => window.setTimeout(resolve, frameDelay));
    if ((sample.frameIndex + 1) % 4 === 0) {
      await yieldToFrame();
    }
  }

  recorder.stop();
  const blob = await finished;
  downloadBlob(blob, fileName);
};

export const createExportSamples = (
  context: ExportLoopContext,
  generatePoseAtPhase: (phase: number) => WalkingEnginePose,
  fps: number,
): { durationMs: number; samples: LoopFrameSample[] } => {
  const durationMs = makeLoopDurationMs(context.gait);
  const frameCount = makeFrameCount(durationMs, fps);
  return {
    durationMs,
    samples: buildSamples(context, frameCount, generatePoseAtPhase),
  };
};

export const exportLoopFrames = async (
  context: ExportLoopContext,
  generatePoseAtPhase: (phase: number) => WalkingEnginePose,
  fps: number,
): Promise<void> => {
  const { samples } = createExportSamples(context, generatePoseAtPhase, fps);
  await exportSamplesAsPngZip(context, samples, `bitruvian-loop-frames-${createStamp()}.zip`);
};

export const exportKeyframes = async (
  context: ExportLoopContext,
  generatePoseAtPhase: (phase: number) => WalkingEnginePose,
): Promise<void> => {
  await exportKeyframesJson(context, generatePoseAtPhase, `bitruvian-keyframes-${createStamp()}.json`);
};

export const exportAnimatedLoop = async (
  context: ExportLoopContext,
  generatePoseAtPhase: (phase: number) => WalkingEnginePose,
  fps: number,
  format: AnimatedExportFormat,
): Promise<void> => {
  const { samples } = createExportSamples(context, generatePoseAtPhase, fps);

  if (format === 'gif') {
    await exportGif(context, samples, `bitruvian-loop-${createStamp()}.gif`);
    return;
  }

  await exportWebm(context, samples, `bitruvian-loop-${createStamp()}.webm`);
};

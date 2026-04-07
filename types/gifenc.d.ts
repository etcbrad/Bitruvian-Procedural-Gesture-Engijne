declare module 'gifenc' {
  export type GifEncPalette = number[][];
  export type GifEncQuantizeOptions = {
    format?: 'rgb565' | 'rgb444' | 'rgba4444';
    clearAlpha?: boolean;
    clearAlphaColor?: number;
    clearAlphaThreshold?: number;
    oneBitAlpha?: boolean | number;
    useSqrt?: boolean;
  };
  export type GifEncFrameOptions = {
    palette?: GifEncPalette | null;
    transparent?: boolean;
    transparentIndex?: number;
    delay?: number;
    repeat?: number;
    dispose?: number;
    colorDepth?: number;
    first?: boolean;
  };
  export type GifEncoder = {
    writeFrame: (pixels: Uint8Array, width: number, height: number, options?: GifEncFrameOptions) => void;
    finish: () => void;
    bytes: () => Uint8Array;
  };
  export function GIFEncoder(options?: { initialCapacity?: number; auto?: boolean }): GifEncoder;
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: GifEncQuantizeOptions): GifEncPalette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: GifEncPalette, format?: 'rgb565' | 'rgb444' | 'rgba4444'): Uint8Array;
}

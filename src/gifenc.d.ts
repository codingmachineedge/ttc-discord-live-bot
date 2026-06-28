declare module "gifenc" {
  export type GifEncoderInstance = {
    writeFrame(index: Uint8Array, width: number, height: number, options?: Record<string, unknown>): void;
    finish(): void;
    bytes(): Uint8Array;
  };
  const gifenc: {
    GIFEncoder(options?: Record<string, unknown>): GifEncoderInstance;
    quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: Record<string, unknown>): number[][];
    applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: number[][], format?: string): Uint8Array;
  };
  export default gifenc;
}

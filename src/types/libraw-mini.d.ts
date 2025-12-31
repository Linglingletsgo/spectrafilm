// Type definitions for libraw-mini
declare module 'libraw-mini' {
  export class LibRaw {
    constructor(): Promise<LibRaw>;
    init(): Promise<void>;
    open(buffer: ArrayBuffer, options: Record<string, any>): Promise<number>;
    setparams(params: Record<string, any>): Promise<boolean>;
    getimage(callback?: (count: number, msg: string) => void): Promise<{
      width: number;
      height: number;
      format_str: string;
      data: Uint8ClampedArray;
    }>;
    close(): void;
  }
}

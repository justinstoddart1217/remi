// The part of pngjs 7 the harness uses (the package ships no types, and @types/pngjs is not a
// dependency).
declare module 'pngjs' {
  export interface PNGOptions {
    width?: number;
    height?: number;
    fill?: boolean;
  }
  export class PNG {
    constructor(options?: PNGOptions);
    width: number;
    height: number;
    data: Buffer;
    static sync: {
      read(buffer: Buffer): PNG;
      write(png: PNG, options?: Record<string, unknown>): Buffer;
    };
  }
}

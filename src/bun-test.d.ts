declare module "bun:test" {
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function describe(name: string, fn: () => void): void;
  export function expect(actual: unknown): {
    not: {
      toBe(expected: unknown): void;
      toEqual(expected: unknown): void;
      toBeNull(): void;
      toBeTruthy(): void;
      toBeFalsy(): void;
      toBeCloseTo(expected: number, digits?: number): void;
      toBeGreaterThan(expected: number): void;
      toBeLessThan(expected: number): void;
      toContain(expected: unknown): void;
      toBeUndefined(): void;
      toThrow(): void;
    };
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeNull(): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeCloseTo(expected: number, digits?: number): void;
    toBeGreaterThan(expected: number): void;
    toBeLessThan(expected: number): void;
    toContain(expected: unknown): void;
    toBeUndefined(): void;
    toThrow(): void;
  };
  export function beforeEach(fn: () => void): void;
}

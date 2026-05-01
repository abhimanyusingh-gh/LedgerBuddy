export type TAN = string & { readonly __brand: unique symbol };

export const TAN_FORMAT = /^[A-Z]{4}[0-9]{5}[A-Z]$/;

export function toTAN(value: string): TAN {
  return value as TAN;
}

export function isTAN(value: string): value is TAN {
  return TAN_FORMAT.test(value);
}

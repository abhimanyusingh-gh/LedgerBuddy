import { Types } from "mongoose";
import { ALLOWED_UPLOAD_EXTENSIONS } from "../constants.js";

export function toValidObjectId(value: string): Types.ObjectId | null {
  return Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null;
}

export function isAllowedFileExtension(filename: string): boolean {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return false;
  return ALLOWED_UPLOAD_EXTENSIONS.includes(filename.slice(dot).toLowerCase());
}

export function validateDateRange(from?: Date, to?: Date): { valid: boolean; message?: string } {
  if (from && to && from > to) {
    return { valid: false, message: "Parameter 'from' must be before 'to'." };
  }
  if (to) {
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
    if (to > oneYearFromNow) {
      return { valid: false, message: "Date range cannot extend more than 1 year into the future." };
    }
  }
  return { valid: true };
}

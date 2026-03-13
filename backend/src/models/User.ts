import { Schema, model, type InferSchemaType } from "mongoose";

const userSchema = new Schema(
  {
    email: { type: String, required: true },
    externalSubject: { type: String, required: true },
    tenantId: { type: String, required: true },
    displayName: { type: String, required: true },
    encryptedRefreshToken: { type: String },
    lastLoginAt: { type: Date, required: true },
    passwordHash: { type: String },
    tempPassword: { type: String },
    mustChangePassword: { type: Boolean, default: false },
    emailVerified: { type: Date },
    verificationTokenHash: { type: String }
  },
  {
    timestamps: true
  }
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ externalSubject: 1 }, { unique: true });
userSchema.index({ tenantId: 1, email: 1 });

type User = InferSchemaType<typeof userSchema>;

export const UserModel = model<User>("User", userSchema);

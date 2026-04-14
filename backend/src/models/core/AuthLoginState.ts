import { Schema, model, type InferSchemaType } from "mongoose";

const authLoginStateSchema = new Schema(
  {
    state: { type: String, required: true, unique: true },
    codeVerifier: { type: String, required: true },
    redirectUri: { type: String, required: true },
    nextPath: { type: String, required: true, default: "/" },
    expiresAt: { type: Date, required: true }
  },
  {
    timestamps: true
  }
);

authLoginStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

type AuthLoginState = InferSchemaType<typeof authLoginStateSchema>;

export const AuthLoginStateModel = model<AuthLoginState>("AuthLoginState", authLoginStateSchema);

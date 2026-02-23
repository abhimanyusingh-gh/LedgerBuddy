import mongoose from "mongoose";
import { loadRuntimeManifest } from "../core/runtimeManifest.js";

let connected = false;

export async function connectToDatabase() {
  if (connected) {
    return;
  }

  const runtimeManifest = loadRuntimeManifest();
  await mongoose.connect(runtimeManifest.database.uri);
  connected = true;
}

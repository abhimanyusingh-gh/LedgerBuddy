type StoreReset = () => void;

const registeredStores: StoreReset[] = [];

export function registerStoreReset(reset: StoreReset): void {
  registeredStores.push(reset);
}

export function resetStores(): void {
  for (const reset of registeredStores) {
    reset();
  }
}

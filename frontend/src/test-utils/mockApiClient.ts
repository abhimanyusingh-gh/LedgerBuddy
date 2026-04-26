type MockApiClientMethods = {
  get: jest.Mock;
  post: jest.Mock;
  patch: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
};

type MockApiClientModule<T extends Record<string, unknown> = Record<string, never>> = {
  apiClient: MockApiClientMethods;
} & T;

function buildApiClientMethods(): MockApiClientMethods {
  return {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn()
  };
}

export function buildApiClientMockModule<
  T extends Record<string, unknown> = Record<string, never>
>(extraExports?: T): MockApiClientModule<T> {
  return {
    apiClient: buildApiClientMethods(),
    ...(extraExports ?? ({} as T))
  };
}

export function getMockedApiClient(): MockApiClientMethods {
  const mocked = jest.requireMock("@/api/client") as { apiClient: MockApiClientMethods };
  return mocked.apiClient;
}

export function getMockedApiClientModule<
  T extends Record<string, unknown> = Record<string, never>
>(): MockApiClientModule<T> {
  return jest.requireMock("@/api/client") as MockApiClientModule<T>;
}

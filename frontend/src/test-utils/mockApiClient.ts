type MockApiClientMethods = {
  get: jest.Mock;
  post: jest.Mock;
  patch: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
};

type MockApiClientModule = {
  apiClient: MockApiClientMethods;
} & Record<string, unknown>;

function buildApiClientMethods(): MockApiClientMethods {
  return {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn()
  };
}

export function buildApiClientMockModule(
  extraExports: Record<string, unknown> = {}
): MockApiClientModule {
  return {
    apiClient: buildApiClientMethods(),
    ...extraExports
  };
}

export function getMockedApiClient(): MockApiClientMethods {
  const mocked = jest.requireMock("@/api/client") as { apiClient: MockApiClientMethods };
  return mocked.apiClient;
}

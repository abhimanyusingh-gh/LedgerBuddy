import { Types } from "mongoose";
import type { FileStore } from "@/core/interfaces/FileStore.js";
import { toUUID } from "@/types/uuid.js";

export const defaultAuth = {
  userId: toUUID("user-1"),
  email: "admin@test.com",
  tenantId: toUUID("tenant-a"),
  tenantName: "Test Tenant",
  role: "TENANT_ADMIN",
  isPlatformAdmin: false
};

const DEFAULT_ACTIVE_CLIENT_ORG_ID = new Types.ObjectId("65f0000000000000000000aa");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function findHandler(router: any, method: string, path: string): Function {
  for (const layer of router.stack) {
    if (layer.route?.path === path && layer.route.methods[method]) {
      const stack = layer.route.stack;
      return stack[stack.length - 1].handle;
    }
  }
  throw new Error(`No handler found for ${method.toUpperCase()} ${path}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function findSecondHandler(router: any, method: string, path: string): Function {
  for (const layer of router.stack) {
    if (layer.route?.path === path && layer.route.methods[method]) {
      const stack = layer.route.stack;
      if (stack.length < 2) {
        throw new Error(`Route ${method.toUpperCase()} ${path} does not have a second handler`);
      }
      return stack[stack.length - 1].handle;
    }
  }
  throw new Error(`No handler found for ${method.toUpperCase()} ${path}`);
}

export function mockRequest(overrides: Record<string, unknown> = {}) {
  const listeners: Record<string, Function[]> = {};
  return {
    authContext: null,
    query: {},
    params: {},
    body: {},
    activeClientOrgId: DEFAULT_ACTIVE_CLIENT_ORG_ID,
    on(event: string, cb: Function) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    },
    _emit(event: string) {
      for (const cb of listeners[event] ?? []) cb();
    },
    ...overrides
  };
}

export function mockResponse() {
  const res: Record<string, unknown> = {
    statusCode: 200,
    jsonBody: undefined as unknown,
    headers: {} as Record<string, string>,
    written: [] as string[],
    sentBody: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.jsonBody = data;
      return res;
    },
    writeHead(code: number, headers: Record<string, string>) {
      res.statusCode = code;
      Object.assign(res.headers as Record<string, string>, headers);
      return res;
    },
    write(data: string) {
      (res.written as string[]).push(data);
      return true;
    },
    setHeader(name: string, value: string) {
      (res.headers as Record<string, string>)[name.toLowerCase()] = value;
      return res;
    },
    send(body: unknown) {
      res.sentBody = body;
      return res;
    }
  };
  return res;
}

export function createMockFileStore(overrides?: Partial<FileStore>): FileStore {
  return {
    name: "mock",
    putObject: jest.fn(async (input: { key: string }) => ({
      key: input.key,
      path: `/data/${input.key}`,
      contentType: "application/pdf"
    })),
    getObject: jest.fn(async () => ({
      body: Buffer.from("pdf-data"),
      contentType: "application/pdf"
    })),
    deleteObject: jest.fn(async () => {}),
    listObjects: jest.fn(async () => [] as { key: string; lastModified: Date }[]),
    ...overrides
  } as unknown as FileStore;
}

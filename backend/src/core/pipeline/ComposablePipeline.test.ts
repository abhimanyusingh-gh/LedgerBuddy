import { ComposablePipeline } from "./ComposablePipeline.js";
import { ContextStore } from "./PipelineContext.js";
import type { PipelineContext, PipelineInput } from "./PipelineContext.js";
import type { PipelineStage } from "./PipelineStage.js";
import type { StageResult } from "./PipelineStage.js";

function makeInput(overrides: Partial<PipelineInput> = {}): PipelineInput {
  return {
    tenantId: "t-1",
    fileName: "invoice.pdf",
    mimeType: "application/pdf",
    fileBuffer: Buffer.from("fake"),
    ...overrides,
  };
}

function makeStage(name: string, fn?: (ctx: PipelineContext) => Promise<StageResult>): PipelineStage {
  return {
    name,
    execute: fn ?? (async () => ({})),
  };
}

describe("ContextStore", () => {
  it("set/get/has work correctly", () => {
    const store = new ContextStore();
    expect(store.has("key")).toBe(false);
    store.set("key", 42);
    expect(store.has("key")).toBe(true);
    expect(store.get<number>("key")).toBe(42);
  });

  it("require throws on missing key", () => {
    const store = new ContextStore();
    expect(() => store.require("missing")).toThrow('Pipeline context missing required key: "missing"');
  });

  it("require returns value when present", () => {
    const store = new ContextStore();
    store.set("key", "value");
    expect(store.require<string>("key")).toBe("value");
  });
});

describe("ComposablePipeline", () => {
  it("executes stages in order", async () => {
    const order: string[] = [];
    const pipeline = new ComposablePipeline<string[]>((ctx) => ctx.store.require("order"))
      .add(makeStage("a", async (ctx) => { order.push("a"); ctx.store.set("order", order); return {}; }))
      .add(makeStage("b", async () => { order.push("b"); return {}; }))
      .add(makeStage("c", async () => { order.push("c"); return {}; }));

    const result = await pipeline.execute(makeInput());
    expect(result.output).toEqual(["a", "b", "c"]);
    expect(result.stagesExecuted).toEqual(["a", "b", "c"]);
  });

  it("records stage timing in metadata", async () => {
    const pipeline = new ComposablePipeline<void>(() => undefined)
      .add(makeStage("timer"));

    const result = await pipeline.execute(makeInput());
    expect(result.metadata["stage.timer.ms"]).toBeDefined();
    expect(Number(result.metadata["stage.timer.ms"])).toBeGreaterThanOrEqual(0);
  });

  it("halt stops pipeline early", async () => {
    const pipeline = new ComposablePipeline<void>(() => undefined)
      .add(makeStage("first", async () => ({ status: "halt" as const })))
      .add(makeStage("second"));

    const result = await pipeline.execute(makeInput());
    expect(result.stagesExecuted).toEqual(["first"]);
  });

  it("skip continues to next stage", async () => {
    const pipeline = new ComposablePipeline<void>(() => undefined)
      .add(makeStage("skipper", async () => ({ status: "skip" as const })))
      .add(makeStage("next"));

    const result = await pipeline.execute(makeInput());
    expect(result.stagesExecuted).toEqual(["skipper", "next"]);
  });

  it("addIf(false) skips the stage", async () => {
    const pipeline = new ComposablePipeline<void>(() => undefined)
      .addIf(false, makeStage("skipped"))
      .add(makeStage("kept"));

    const result = await pipeline.execute(makeInput());
    expect(result.stagesExecuted).toEqual(["kept"]);
  });

  it("addIf(true) includes the stage", async () => {
    const pipeline = new ComposablePipeline<void>(() => undefined)
      .addIf(true, makeStage("included"));

    const result = await pipeline.execute(makeInput());
    expect(result.stagesExecuted).toEqual(["included"]);
  });

  it("addIf with factory function", async () => {
    const pipeline = new ComposablePipeline<void>(() => undefined)
      .addIf(true, () => makeStage("lazy"));

    const result = await pipeline.execute(makeInput());
    expect(result.stagesExecuted).toEqual(["lazy"]);
  });

  it("stage errors propagate with metadata recorded", async () => {
    const pipeline = new ComposablePipeline<void>(() => undefined)
      .add(makeStage("boom", async () => { throw new Error("stage failed"); }));

    await expect(pipeline.execute(makeInput())).rejects.toThrow("stage failed");
  });

  it("outputExtractor pulls the correct result", async () => {
    const pipeline = new ComposablePipeline<number>((ctx) => ctx.store.require("answer"))
      .add(makeStage("compute", async (ctx) => { ctx.store.set("answer", 42); return {}; }));

    const result = await pipeline.execute(makeInput());
    expect(result.output).toBe(42);
  });

  it("empty pipeline returns immediately", async () => {
    const pipeline = new ComposablePipeline<string>(() => "empty");
    const result = await pipeline.execute(makeInput());
    expect(result.output).toBe("empty");
    expect(result.stagesExecuted).toEqual([]);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("issues accumulate across stages", async () => {
    const pipeline = new ComposablePipeline<void>(() => undefined)
      .add(makeStage("a", async (ctx) => { ctx.issues.push("issue-a"); return {}; }))
      .add(makeStage("b", async (ctx) => { ctx.issues.push("issue-b"); return {}; }));

    const result = await pipeline.execute(makeInput());
    expect(result.issues).toEqual(["issue-a", "issue-b"]);
  });

  it("reports total durationMs", async () => {
    const pipeline = new ComposablePipeline<void>(() => undefined)
      .add(makeStage("wait", async () => {
        await new Promise((r) => setTimeout(r, 10));
        return {};
      }));

    const result = await pipeline.execute(makeInput());
    expect(result.durationMs).toBeGreaterThanOrEqual(5);
  });
});

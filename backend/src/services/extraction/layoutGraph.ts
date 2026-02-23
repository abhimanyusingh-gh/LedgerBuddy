import { createHash } from "node:crypto";
import type { OcrBlock } from "../../core/interfaces/OcrProvider.js";

interface LayoutGraphNode {
  id: string;
  page: number;
  text: string;
  bbox: [number, number, number, number];
  blockType: string;
}

interface LayoutGraphEdge {
  from: string;
  to: string;
  relation: "right" | "below";
}

interface LayoutGraph {
  nodes: LayoutGraphNode[];
  edges: LayoutGraphEdge[];
  signature: string;
}

export function buildLayoutGraph(blocks: OcrBlock[]): LayoutGraph {
  const nodes = blocks
    .map((block, index) => {
      const text = block.text.trim();
      if (!text) {
        return undefined;
      }

      return {
        id: `b-${index + 1}`,
        page: normalizePage(block.page),
        text,
        bbox: block.bbox,
        blockType: block.blockType?.trim().toLowerCase() || "text"
      } satisfies LayoutGraphNode;
    })
    .filter((node): node is LayoutGraphNode => node !== undefined)
    .sort((left, right) => compareNodes(left, right));

  const edges: LayoutGraphEdge[] = [];
  for (const node of nodes) {
    const samePage = nodes.filter((candidate) => candidate.page === node.page && candidate.id !== node.id);
    const rightNode = findClosestRightNode(node, samePage);
    if (rightNode) {
      edges.push({ from: node.id, to: rightNode.id, relation: "right" });
    }

    const lowerNode = findClosestLowerNode(node, samePage);
    if (lowerNode) {
      edges.push({ from: node.id, to: lowerNode.id, relation: "below" });
    }
  }

  return {
    nodes,
    edges,
    signature: buildGraphSignature(nodes, edges)
  };
}

function compareNodes(left: LayoutGraphNode, right: LayoutGraphNode): number {
  if (left.page !== right.page) {
    return left.page - right.page;
  }
  if (left.bbox[1] !== right.bbox[1]) {
    return left.bbox[1] - right.bbox[1];
  }
  return left.bbox[0] - right.bbox[0];
}

function findClosestRightNode(
  source: LayoutGraphNode,
  candidates: LayoutGraphNode[]
): LayoutGraphNode | undefined {
  const sourceCenterY = (source.bbox[1] + source.bbox[3]) / 2;
  let winner: LayoutGraphNode | undefined;
  let winnerDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (candidate.bbox[0] <= source.bbox[2]) {
      continue;
    }

    const candidateCenterY = (candidate.bbox[1] + candidate.bbox[3]) / 2;
    const yDistance = Math.abs(candidateCenterY - sourceCenterY);
    if (yDistance > Math.max(24, (source.bbox[3] - source.bbox[1]) * 1.5)) {
      continue;
    }

    const xDistance = candidate.bbox[0] - source.bbox[2];
    if (xDistance < winnerDistance) {
      winnerDistance = xDistance;
      winner = candidate;
    }
  }

  return winner;
}

function findClosestLowerNode(
  source: LayoutGraphNode,
  candidates: LayoutGraphNode[]
): LayoutGraphNode | undefined {
  const sourceCenterX = (source.bbox[0] + source.bbox[2]) / 2;
  let winner: LayoutGraphNode | undefined;
  let winnerDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (candidate.bbox[1] <= source.bbox[3]) {
      continue;
    }

    const candidateCenterX = (candidate.bbox[0] + candidate.bbox[2]) / 2;
    const xDistance = Math.abs(candidateCenterX - sourceCenterX);
    if (xDistance > Math.max(64, (source.bbox[2] - source.bbox[0]) * 2.5)) {
      continue;
    }

    const yDistance = candidate.bbox[1] - source.bbox[3];
    if (yDistance < winnerDistance) {
      winnerDistance = yDistance;
      winner = candidate;
    }
  }

  return winner;
}

function normalizePage(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return Math.round(value);
}

function buildGraphSignature(nodes: LayoutGraphNode[], edges: LayoutGraphEdge[]): string {
  const payload = JSON.stringify({
    nodes: nodes.map((node) => ({
      page: node.page,
      blockType: node.blockType,
      bbox: node.bbox.map((entry) => Math.round(entry / 10) * 10),
      textLength: bucketTextLength(node.text.length)
    })),
    edges: edges.map((edge) => ({ relation: edge.relation }))
  });

  return createHash("sha1").update(payload).digest("hex").slice(0, 20);
}

function bucketTextLength(length: number): string {
  if (length <= 8) {
    return "short";
  }
  if (length <= 32) {
    return "medium";
  }
  return "long";
}

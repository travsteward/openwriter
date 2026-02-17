/**
 * Pure tree operations on WorkspaceNode[].
 * All functions return mutated copies — caller writes to disk.
 */

import type { WorkspaceNode, DocItem, ContainerItem } from './workspace-types.js';
import { generateContainerId } from './workspace-types.js';

const MAX_DEPTH = 3;

// ============================================================================
// FIND
// ============================================================================

interface FindResult<T> {
  node: T;
  parent: WorkspaceNode[] | ContainerItem;
  index: number;
}

/** Recursive find — returns node, its parent array, and index within that array. */
export function findNode(
  nodes: WorkspaceNode[],
  predicate: (n: WorkspaceNode) => boolean,
  parentRef?: ContainerItem,
): FindResult<WorkspaceNode> | null {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (predicate(node)) {
      return { node, parent: parentRef ?? nodes, index: i };
    }
    if (node.type === 'container') {
      const found = findNode(node.items, predicate, node);
      if (found) return found;
    }
    if (node.type === 'doc' && node.children) {
      for (const child of node.children) {
        const found = findNode(child.items, predicate, child);
        if (found) return found;
      }
    }
  }
  return null;
}

export function findDocNode(root: WorkspaceNode[], file: string): FindResult<DocItem> | null {
  return findNode(root, (n) => n.type === 'doc' && n.file === file) as FindResult<DocItem> | null;
}

export function findContainer(root: WorkspaceNode[], containerId: string): FindResult<ContainerItem> | null {
  return findNode(root, (n) => n.type === 'container' && n.id === containerId) as FindResult<ContainerItem> | null;
}

/** Get the items array that a container or root holds. */
function getItemsArray(root: WorkspaceNode[], containerId: string | null): WorkspaceNode[] | null {
  if (containerId === null) return root;
  const found = findContainer(root, containerId);
  if (!found) return null;
  return (found.node as ContainerItem).items;
}

// ============================================================================
// DEPTH
// ============================================================================

/** Calculate the depth of a node in the tree. Root level = 0. */
export function getDepth(root: WorkspaceNode[], identifier: string): number {
  function walk(nodes: WorkspaceNode[], depth: number): number {
    for (const node of nodes) {
      const id = node.type === 'doc' ? node.file : node.id;
      if (id === identifier) return depth;
      if (node.type === 'container') {
        const found = walk(node.items, depth + 1);
        if (found >= 0) return found;
      }
    }
    return -1;
  }
  return walk(root, 0);
}

/** Calculate the depth of a target container (where we'd insert into). */
function getContainerDepth(root: WorkspaceNode[], containerId: string | null): number {
  if (containerId === null) return 0;
  return getDepth(root, containerId) + 1;
}

// ============================================================================
// ADD
// ============================================================================

export function addDocToContainer(
  root: WorkspaceNode[],
  containerId: string | null,
  file: string,
  title: string,
  afterIdentifier?: string | null,
): void {
  // Check for duplicate
  if (findDocNode(root, file)) {
    throw new Error(`Document "${file}" already exists in workspace`);
  }
  const target = getItemsArray(root, containerId);
  if (!target) throw new Error(`Container "${containerId}" not found`);
  const doc: DocItem = { type: 'doc', file, title };

  if (afterIdentifier) {
    const afterIdx = target.findIndex((n) =>
      (n.type === 'doc' && n.file === afterIdentifier) || (n.type === 'container' && n.id === afterIdentifier),
    );
    if (afterIdx === -1) {
      target.push(doc);
    } else {
      target.splice(afterIdx + 1, 0, doc);
    }
  } else {
    target.unshift(doc);
  }
}

export function addContainer(
  root: WorkspaceNode[],
  parentContainerId: string | null,
  name: string,
): ContainerItem {
  const depth = getContainerDepth(root, parentContainerId);
  if (depth >= MAX_DEPTH) {
    throw new Error(`Maximum nesting depth (${MAX_DEPTH}) reached`);
  }
  const target = getItemsArray(root, parentContainerId);
  if (!target) throw new Error(`Parent container "${parentContainerId}" not found`);

  const container: ContainerItem = {
    type: 'container',
    id: generateContainerId(),
    name,
    items: [],
  };
  target.unshift(container);
  return container;
}

// ============================================================================
// REMOVE
// ============================================================================

/** Remove a node by file (doc) or id (container). Returns the removed node. */
export function removeNode(root: WorkspaceNode[], identifier: string): WorkspaceNode {
  // Try as doc first, then as container
  const found = findNode(root, (n) =>
    (n.type === 'doc' && n.file === identifier) || (n.type === 'container' && n.id === identifier),
  );
  if (!found) throw new Error(`Node "${identifier}" not found`);

  const parentArray = found.parent instanceof Array ? found.parent : (found.parent as ContainerItem).items;
  const [removed] = parentArray.splice(found.index, 1);
  return removed;
}

// ============================================================================
// MOVE / REORDER
// ============================================================================

/**
 * Move a node to a different container (or root).
 * afterIdentifier = null → insert at beginning; otherwise insert after that node.
 */
export function moveNode(
  root: WorkspaceNode[],
  identifier: string,
  targetContainerId: string | null,
  afterIdentifier: string | null,
): void {
  const removed = removeNode(root, identifier);

  // Check depth for containers being moved
  if (removed.type === 'container') {
    const targetDepth = getContainerDepth(root, targetContainerId);
    if (targetDepth >= MAX_DEPTH) {
      // Re-add at root to not lose data, then throw
      root.push(removed);
      throw new Error(`Cannot move: would exceed max depth (${MAX_DEPTH})`);
    }
  }

  const target = getItemsArray(root, targetContainerId);
  if (!target) {
    root.push(removed); // don't lose data
    throw new Error(`Target container "${targetContainerId}" not found`);
  }

  if (afterIdentifier === null) {
    target.unshift(removed);
  } else {
    const afterIdx = target.findIndex((n) =>
      (n.type === 'doc' && n.file === afterIdentifier) || (n.type === 'container' && n.id === afterIdentifier),
    );
    if (afterIdx === -1) {
      target.push(removed);
    } else {
      target.splice(afterIdx + 1, 0, removed);
    }
  }
}

/** Reorder within the same parent. */
export function reorderNode(
  root: WorkspaceNode[],
  identifier: string,
  afterIdentifier: string | null,
): void {
  const found = findNode(root, (n) =>
    (n.type === 'doc' && n.file === identifier) || (n.type === 'container' && n.id === identifier),
  );
  if (!found) throw new Error(`Node "${identifier}" not found`);

  const parentArray = found.parent instanceof Array ? found.parent : (found.parent as ContainerItem).items;
  const [removed] = parentArray.splice(found.index, 1);

  if (afterIdentifier === null) {
    parentArray.unshift(removed);
  } else {
    const afterIdx = parentArray.findIndex((n) =>
      (n.type === 'doc' && n.file === afterIdentifier) || (n.type === 'container' && n.id === afterIdentifier),
    );
    if (afterIdx === -1) {
      parentArray.push(removed);
    } else {
      parentArray.splice(afterIdx + 1, 0, removed);
    }
  }
}

// ============================================================================
// QUERIES
// ============================================================================

/** Collect all doc files in the tree. */
export function collectAllFiles(nodes: WorkspaceNode[]): string[] {
  const files: string[] = [];
  for (const node of nodes) {
    if (node.type === 'doc') {
      files.push(node.file);
    } else if (node.type === 'container') {
      files.push(...collectAllFiles(node.items));
    }
  }
  return files;
}

/** Count total doc items in the tree. */
export function countDocs(nodes: WorkspaceNode[]): number {
  return collectAllFiles(nodes).length;
}

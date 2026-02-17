/**
 * Tag index operations for workspace v2.
 * Tags are a cross-cutting index: tag → [file1, file2, ...].
 */

export function addTag(tags: Record<string, string[]>, tagName: string, file: string): void {
  if (!tags[tagName]) tags[tagName] = [];
  if (!tags[tagName].includes(file)) tags[tagName].push(file);
}

export function removeTag(tags: Record<string, string[]>, tagName: string, file: string): void {
  if (!tags[tagName]) return;
  tags[tagName] = tags[tagName].filter((f) => f !== file);
  if (tags[tagName].length === 0) delete tags[tagName];
}

export function removeFileFromAllTags(tags: Record<string, string[]>, file: string): void {
  for (const tagName of Object.keys(tags)) {
    removeTag(tags, tagName, file);
  }
}

export function listFilesForTag(tags: Record<string, string[]>, tagName: string): string[] {
  return tags[tagName] || [];
}

export function listTagsForFile(tags: Record<string, string[]>, file: string): string[] {
  const result: string[] = [];
  for (const [tagName, files] of Object.entries(tags)) {
    if (files.includes(file)) result.push(tagName);
  }
  return result;
}

import { getJsonPathForPosition, getLocationForJsonPath, parseWithPointers } from '@stoplight/yaml';
import type { YamlParserResult } from '@stoplight/yaml';
import type { IRuleResult } from '@openlint/openlint-core';
import type { ChangedLines } from './diffFilter';

type JsonPath = Array<string | number>;

interface Position {
  line: number;
  character: number;
}

interface Range {
  start: Position;
  end: Position;
}

interface Location {
  range: Range;
}

interface ChangedOwnership {
  changedLines: ReadonlySet<number>;
  nodeStartLines: Set<number>;
  nodeRanges: Range[];
  changedPaths: JsonPath[];
}

export interface DiagnosticAttribution {
  includes(result: IRuleResult): boolean;
}

export function createDiagnosticAttribution(text: string, changedLines: ChangedLines): DiagnosticAttribution {
  const ownership = buildChangedOwnership(text, changedLines);

  if (!ownership) {
    return {
      includes: result => changedLines.contains(result.range.start.line)
    };
  }

  return {
    includes: result => isRelevantDiagnostic(result, ownership)
  };
}

function buildChangedOwnership(text: string, changedLines: ChangedLines): ChangedOwnership | undefined {
  let parsed: YamlParserResult<unknown>;

  try {
    parsed = parseWithPointers(text);
  } catch {
    return undefined;
  }

  const lines = text.split(/\r?\n/);
  const changedPaths = new Map<string, JsonPath>();
  const nodeStartLines = new Set<number>();
  const nodeRanges: Range[] = [];

  for (const line of changedLines.lines) {
    const path = findPathForLine(parsed, lines, line);

    if (!path) {
      continue;
    }

    changedPaths.set(pathKey(path), path);

    const location = getPathLocation(parsed, path);
    if (location) {
      nodeStartLines.add(location.range.start.line);
      nodeRanges.push(location.range);
    }

    for (const ancestor of ancestors(path)) {
      const ancestorLocation = getPathLocation(parsed, ancestor);
      if (ancestorLocation) {
        nodeStartLines.add(ancestorLocation.range.start.line);
      }
    }
  }

  return {
    changedLines: changedLines.lines,
    nodeStartLines,
    nodeRanges,
    changedPaths: [...changedPaths.values()]
  };
}

function findPathForLine(parsed: YamlParserResult<unknown>, lines: string[], line: number): JsonPath | undefined {
  const text = lines[line];

  if (text === undefined) {
    return undefined;
  }

  const firstContentCharacter = Math.max(0, text.search(/\S/));
  const lastCharacter = Math.max(0, text.length - 1);
  const candidates = uniqueNumbers([firstContentCharacter, 0, lastCharacter]);

  for (const character of candidates) {
    const path = getJsonPathForPosition(parsed, { line, character });
    if (path && path.length > 0) {
      return path as JsonPath;
    }
  }

  return undefined;
}

function getPathLocation(parsed: YamlParserResult<unknown>, path: JsonPath): Location | undefined {
  const location = getLocationForJsonPath(parsed, path, true);
  return location as Location | undefined;
}

function isRelevantDiagnostic(result: IRuleResult, ownership: ChangedOwnership): boolean {
  const diagnosticRange = result.range;

  if (ownership.changedLines.has(diagnosticRange.start.line)) {
    return true;
  }

  if (rangeTouchesAnyLine(diagnosticRange, ownership.changedLines)) {
    return true;
  }

  if (ownership.nodeStartLines.has(diagnosticRange.start.line)) {
    return true;
  }

  if (ownership.nodeRanges.some(range => rangesOverlap(diagnosticRange, range))) {
    return true;
  }

  const diagnosticPath = result.path as JsonPath | undefined;

  return Array.isArray(diagnosticPath) && ownership.changedPaths.some(path => pathsOverlap(diagnosticPath, path));
}

function ancestors(path: JsonPath): JsonPath[] {
  const result: JsonPath[] = [];

  for (let index = path.length - 1; index > 0; index -= 1) {
    result.push(path.slice(0, index));
  }

  return result;
}

function pathsOverlap(left: JsonPath, right: JsonPath): boolean {
  return pathContains(left, right) || pathContains(right, left);
}

function pathContains(parent: JsonPath, child: JsonPath): boolean {
  if (parent.length > child.length) {
    return false;
  }

  return parent.every((segment, index) => segment === child[index]);
}

function rangesOverlap(left: Range, right: Range): boolean {
  return comparePositions(left.start, right.end) <= 0 && comparePositions(right.start, left.end) <= 0;
}

function rangeTouchesAnyLine(range: Range, lines: ReadonlySet<number>): boolean {
  for (let line = range.start.line; line <= range.end.line; line += 1) {
    if (lines.has(line)) {
      return true;
    }
  }

  return false;
}

function comparePositions(left: Position, right: Position): number {
  if (left.line !== right.line) {
    return left.line - right.line;
  }

  return left.character - right.character;
}

function pathKey(path: JsonPath): string {
  return JSON.stringify(path);
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)];
}

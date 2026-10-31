import * as vscode from 'vscode';
import { Ruleset } from '@openlint/openlint-core';
import { Resolver } from '@openlint/openlint-ref-resolver';
import type { ExtensionContext } from 'vscode';
import { createBuiltinRuleset } from './builtinRuleset';
import { DEFAULT_RULESET, type ExtensionConfig, type LoaderConfig } from './config';
import { resolveHeaders, resolveUrlCredentialHeaders } from './auth';
import { loadDesktopRuleset } from './desktopRuleset';
import { getWorkspaceFolder } from './documentSelector';
import { sanitizeText, sanitizeUrl, type Logger } from './logger';
import type { RulesetIo } from './rulesetIo';
import { loadWebRuleset } from './webRuleset';

const httpPattern = /^https?:\/\//i;

export class RulesetLoader {
  private cachedRuleset?: Ruleset;
  private cachedKey?: string;
  private generation = 0;

  constructor(
    private readonly context: ExtensionContext,
    private readonly logger: Logger
  ) {}

  clear(): void {
    this.generation += 1;
    this.cachedRuleset = undefined;
    this.cachedKey = undefined;
  }

  async load(documentUri: vscode.Uri, config: ExtensionConfig): Promise<Ruleset> {
    return (await this.loadWithInfo(documentUri, config)).ruleset;
  }

  async loadWithInfo(documentUri: vscode.Uri, config: ExtensionConfig): Promise<{ ruleset: Ruleset; cache: 'hit' | 'miss' }> {
    const generation = this.generation;
    const location = await resolveRulesetLocation(documentUri, config.ruleset);
    const cacheKey = JSON.stringify({
      location: location?.toString(true) ?? 'builtin',
      remoteAuth: config.remoteAuth,
      loaders: config.loaders
    });

    if (generation === this.generation && this.cachedRuleset && this.cachedKey === cacheKey) {
      this.logger.debug(config.outputVerbosity, `Using cached ruleset for ${location ? sanitizeUrl(location.toString(true)) : 'the built-in ruleset'}.`);
      return { ruleset: this.cachedRuleset, cache: 'hit' };
    }

    const ruleset = location
      ? await this.bundle(location, config)
      : this.useBuiltinRuleset(config);

    if (generation === this.generation) {
      this.cachedRuleset = ruleset;
      this.cachedKey = cacheKey;
    }
    return { ruleset, cache: 'miss' };
  }

  async createDocumentResolver(config: ExtensionConfig): Promise<Resolver> {
    const fetcher = await this.createFetch(undefined, config);

    return new Resolver({
      resolvers: {
        http: { resolve: ref => this.resolveHttpReference(fetcher, ref.href()) },
        https: { resolve: ref => this.resolveHttpReference(fetcher, ref.href()) },
        file: { resolve: ref => this.resolveFileReference(ref.href()) }
      }
    });
  }

  private useBuiltinRuleset(config: ExtensionConfig): Ruleset {
    this.logger.info(config.outputVerbosity, 'No ruleset file found. Using the built-in OpenAPI, AsyncAPI, and Arazzo rulesets.');
    return createBuiltinRuleset();
  }

  private async bundle(location: vscode.Uri, config: ExtensionConfig) {
    const fetcher = await this.createFetch(location.toString(true), config);
    const io: RulesetIo = {
      fetch: fetcher,
      fs: createVscodeFs()
    };

    if (__WEB_EXTENSION__) {
      return loadWebRuleset(location, io, this.logger, config.outputVerbosity);
    }

    return loadDesktopRuleset(location, io, this.logger, config.outputVerbosity);
  }

  private async createFetch(rulesetUrl: string | undefined, config: ExtensionConfig): Promise<typeof fetch> {
    const rulesetCredentials = rulesetUrl ? resolveUrlCredentialHeaders(rulesetUrl) : undefined;

    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const requestUrl = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      const urlCredentials = resolveUrlCredentialHeaders(requestUrl);
      const loader = findLoader(urlCredentials.url, config.loaders);
      const isRulesetRequest = urlCredentials.url === rulesetCredentials?.url;
      const selectedAuth = isRulesetRequest ? config.remoteAuth : loader;
      if (loader?.module) {
        const loaded = await this.tryModuleLoader(loader, urlCredentials.url, init);
        if (loaded) {
          return loaded;
        }
      }

      const headers = {
        ...Object.fromEntries(new Headers(init?.headers).entries()),
        ...await resolveHeaders(this.context, selectedAuth),
        ...urlCredentials.headers
      };
      return fetch(toFetchInput(input, urlCredentials.url), { ...init, headers });
    };
  }

  private async resolveHttpReference(fetcher: typeof fetch, requestUrl: string): Promise<string> {
    const response = await fetcher(requestUrl);
    if (response.ok) {
      const text = await response.text();
      const contentType = response.headers.get('content-type');
      assertResolvableReferenceBody(requestUrl, contentType, text);

      return text;
    }

    throw new Error(`Failed to resolve document $ref ${sanitizeUrl(requestUrl)}: HTTP ${response.status} ${response.statusText}`);
  }

  private async resolveFileReference(requestUrl: string): Promise<string> {
    const bytes = await vscode.workspace.fs.readFile(toResolvedFileUri(requestUrl));

    return decodeUtf8(bytes);
  }

  private async tryModuleLoader(loader: LoaderConfig, requestUrl: string, init?: RequestInit): Promise<Response | undefined> {
    if (vscode.env.appHost !== 'desktop') {
      console.warn('Local JavaScript OpenLint loaders are only supported in VS Code desktop.');
      return undefined;
    }

    const moduleUri = await resolveRulesetLocation(undefined, loader.module);
    if (!moduleUri) {
      throw new Error(`OpenLint loader module ${loader.module} was not found.`);
    }

    const imported = await import(moduleUri.toString(true));
    const load = imported.load ?? imported.default;

    if (typeof load !== 'function') {
      throw new Error(`OpenLint loader module ${loader.module} must export a load function or default function.`);
    }

    const result = await load(requestUrl, { init, vscode });
    if (result instanceof Response) {
      return result;
    }

    if (typeof result === 'string') {
      return new Response(result);
    }

    if (result instanceof Uint8Array) {
      const body = new Uint8Array(result.byteLength);
      body.set(result);
      return new Response(body.buffer);
    }

    return undefined;
  }
}

function assertResolvableReferenceBody(requestUrl: string, contentType: string | null, text: string): void {
  if (!isHtmlResponse(contentType, text)) {
    return;
  }

  const title = extractHtmlTitle(text);
  const detail = title ? ` Page title: "${title}".` : '';

  throw new Error(`Resolved document $ref ${sanitizeUrl(requestUrl)} returned HTML instead of YAML/JSON.${detail} Check the matching openlint.loaders entry and its authentication; Bitbucket may be returning a login page or HTML error response.`);
}

function isHtmlResponse(contentType: string | null, text: string): boolean {
  if (contentType?.toLowerCase().includes('text/html')) {
    return true;
  }

  return /^\s*<!doctype\s+html\b/i.test(text) || /^\s*<html[\s>]/i.test(text);
}

function extractHtmlTitle(text: string): string | undefined {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text);
  const title = match?.[1]
    .replace(/\s+/g, ' ')
    .trim();

  return title ? sanitizeText(title) : undefined;
}

function toFetchInput(input: RequestInfo | URL, url: string): RequestInfo | URL {
  if (typeof input === 'string' || input instanceof URL) {
    return url;
  }

  return new Request(url, {
    method: input.method,
    headers: input.headers,
    body: input.body,
    cache: input.cache,
    credentials: input.credentials,
    integrity: input.integrity,
    keepalive: input.keepalive,
    mode: input.mode,
    redirect: input.redirect,
    referrer: input.referrer,
    referrerPolicy: input.referrerPolicy,
    signal: input.signal
  });
}

function toResolvedFileUri(location: string): vscode.Uri {
  if (/^[a-zA-Z]:[\\/]/.test(location) || location.startsWith('/') || location.startsWith('\\\\')) {
    return vscode.Uri.file(decodeUriPath(location));
  }

  const uri = vscode.Uri.parse(location);
  if (uri.scheme) {
    return uri;
  }

  throw new Error(`Expected a resolved file reference, received ${sanitizeText(location)}.`);
}

function decodeUriPath(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

async function resolveRulesetLocation(documentUri: vscode.Uri | undefined, configuredLocation: string | undefined): Promise<vscode.Uri | undefined> {
  const location = configuredLocation?.trim() || DEFAULT_RULESET;

  if (httpPattern.test(location)) {
    return vscode.Uri.parse(location);
  }

  if (/^[a-zA-Z]:[\\/]/.test(location) || location.startsWith('/')) {
    return vscode.Uri.file(location);
  }

  const base = documentUri ? getWorkspaceFolder(documentUri)?.uri : vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!base) {
    throw new Error(`Cannot resolve relative OpenLint ruleset path "${location}" without a workspace folder.`);
  }

  if (location === DEFAULT_RULESET) {
    return findDefaultRuleset(base);
  }

  return vscode.Uri.joinPath(base, ...location.split(/[\\/]/).filter(Boolean));
}

async function findDefaultRuleset(base: vscode.Uri): Promise<vscode.Uri | undefined> {
  let entries: Array<[string, vscode.FileType]>;
  try {
    entries = await vscode.workspace.fs.readDirectory(base);
  } catch {
    return undefined;
  }

  const names = entries
    .filter(([name, type]) => isFile(type) && Ruleset.isDefaultRulesetFile(name))
    .map(([name]) => name)
    .sort((left, right) => rankRulesetFile(left) - rankRulesetFile(right));

  const chosen = names[0];
  return chosen ? vscode.Uri.joinPath(base, chosen) : undefined;
}

function isFile(type: vscode.FileType): boolean {
  return (type & vscode.FileType.File) === vscode.FileType.File;
}

function rankRulesetFile(name: string): number {
  const family = name.includes('openlint') ? 0 : 100;
  const dotted = name.startsWith('.') ? 0 : 10;
  const extension = name.endsWith('.yaml')
    ? 0
    : name.endsWith('.yml')
      ? 1
      : name.endsWith('.json')
        ? 2
        : name.endsWith('.js')
          ? 3
          : 4;

  return family + dotted + extension;
}

function findLoader(requestUrl: string, loaders: LoaderConfig[]): LoaderConfig | undefined {
  return loaders.find(loader => {
    if (!loader.match) {
      return false;
    }

    if (requestUrl.startsWith(loader.match)) {
      return true;
    }

    try {
      return new RegExp(loader.match).test(requestUrl);
    } catch {
      return false;
    }
  });
}

function createVscodeFs(): RulesetIo['fs'] {
  return {
    promises: {
      readFile: async (path: string | URL, options?: { encoding?: BufferEncoding | null } | BufferEncoding | null) => {
        const uri = toResolvedFileUri(path instanceof URL ? path.toString() : path);
        const bytes = await vscode.workspace.fs.readFile(uri);
        const encoding = typeof options === 'string' ? options : options?.encoding;

        return encoding ? decodeUtf8(bytes) : bytes;
      }
    }
  };
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

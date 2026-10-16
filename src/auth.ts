import * as vscode from 'vscode';
import type { AuthConfig } from './config';

export async function resolveHeaders(
  context: vscode.ExtensionContext,
  auth: AuthConfig | undefined
): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...(auth?.headers ?? {}) };
  const bearerToken = auth?.bearerToken ?? await readSecret(context, auth?.bearerTokenSecret);

  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }

  const basic = auth?.basic;
  if (basic?.username) {
    const password = basic.password ?? await readSecret(context, basic.passwordSecret);
    if (password !== undefined) {
      headers.Authorization = basicAuthHeader(basic.username, password);
    }
  }

  return headers;
}

export function resolveUrlCredentialHeaders(url: string): { url: string; headers: Record<string, string> } {
  try {
    const parsed = new URL(url);
    if (!parsed.username) {
      return { url, headers: {} };
    }

    const username = decodeURIComponent(parsed.username);
    const password = decodeURIComponent(parsed.password);
    parsed.username = '';
    parsed.password = '';

    return {
      url: parsed.toString(),
      headers: {
        Authorization: basicAuthHeader(username, password)
      }
    };
  } catch {
    return { url, headers: {} };
  }
}

async function readSecret(context: vscode.ExtensionContext, key: string | undefined): Promise<string | undefined> {
  if (!key) {
    return undefined;
  }

  return context.secrets.get(key);
}

function base64(value: string): string {
  const globalBuffer = globalThis as typeof globalThis & {
    Buffer?: { from(value: string, encoding: string): { toString(encoding: string): string } };
  };

  if (globalBuffer.Buffer) {
    return globalBuffer.Buffer.from(value, 'utf8').toString('base64');
  }

  if (typeof btoa === 'function') {
    const bytes = new TextEncoder().encode(value);
    return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
  }

  return value;
}

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${base64(`${username}:${password}`)}`;
}

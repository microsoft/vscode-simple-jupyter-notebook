/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { promises as fs } from 'fs';
import { EventEmitter, Event } from 'vscode';
import { Observable } from 'rxjs';

type ResolvedMap<T> = { [K in keyof T]: T[K] extends PromiseLike<infer U> ? U : T[K] };

export const promiseMap = async <T extends { [key: string]: unknown }>(
  obj: T,
): Promise<ResolvedMap<T>> => {
  const out: Partial<ResolvedMap<T>> = {};
  await Promise.all(Object.keys(obj).map(async key => ((out as any)[key] = await obj[key])));
  return out as ResolvedMap<T>;
};

export const uniqueBy = <T, R>(
  data: ReadonlyArray<T>,
  extract: (value: T) => R,
): ReadonlyArray<T> => {
  const seen = new Set<R>();
  return data.filter(item => {
    const value = extract(item);
    if (seen.has(value)) {
      return false;
    }

    seen.add(value);
    return true;
  });
};

export const observeCodeEvent = <T>(event: Event<T>): Observable<T> =>
  new Observable(subscriber => {
    const disposable = event(data => subscriber.next(data));
    return () => disposable.dispose();
  });

export const exists = async (path: string) => {
  try {
    await fs.stat(path);
    return true;
  } catch {
    return false;
  }
};

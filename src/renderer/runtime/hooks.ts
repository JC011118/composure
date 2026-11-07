import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import type { EngineSnapshot, InterviewEngine } from '../../engine/engine';
import type { SessionController } from './controller';
import type { Store } from './store';

export const ControllerContext = createContext<SessionController | null>(null);

export function useController(): SessionController {
  const c = useContext(ControllerContext);
  if (!c) throw new Error('ControllerContext missing');
  return c;
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

const nullSnapshot = () => null;

export function useEngineSnapshot(engine: InterviewEngine | null): EngineSnapshot | null {
  const subscribe = useCallback((cb: () => void) => (engine ? engine.subscribe(cb) : () => {}), [engine]);
  const get = engine ? engine.getSnapshot : nullSnapshot;
  return useSyncExternalStore(subscribe, get, get);
}

export const fmtSeconds = (ms: number | null | undefined, digits = 1): string =>
  ms === null || ms === undefined ? '—' : `${(ms / 1000).toFixed(digits)} s`;

export const fmtSigned = (x: number, digits = 0): string =>
  `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(digits)}`;

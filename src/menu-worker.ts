import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createInterface } from 'node:readline';

export type MenuResult = 'invoked' | 'dismissed' | 'failed' | 'unavailable' | 'open-folder';
type Result = MenuResult;
type Request = { resolve: (result: Result) => void; started: number; waitedForStartup: boolean; timer: NodeJS.Timeout };

export function menuWorker(executable: string, cold: boolean, log: boolean) {
  let worker: ReturnType<typeof start> | undefined;
  let stopped = false;
  function start() {
    const launched = performance.now();
    const child = spawn(executable, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = createInterface({ input: child.stdout });
    const state = { child, ready: false, request: undefined as Request | undefined };
    const timer = setTimeout(() => child.kill(), 5000);
    function clear(result: Result) {
      const request = state.request;
      state.request = undefined;
      if (request) clearTimeout(request.timer);
      request?.resolve(result);
    }
    function lost() {
      clearTimeout(timer);
      lines.close();
      if (worker === state) worker = undefined;
      clear('unavailable');
    }
    child.once('error', lost);
    child.once('exit', lost);
    child.stdin.on('error', () => { child.kill(); lost(); });
    lines.on('line', line => {
      if (line === 'ready') {
        clearTimeout(timer);
        state.ready = true;
        if (log) console.info('[windows-menu] worker ready', {
          pid: child.pid, mode: cold ? 'cold' : 'warm', startupMs: Math.round(performance.now() - launched),
        });
        return;
      }
      const fields = /^show (\S+) (\S+)$/.exec(line);
      if (fields && state.request) {
        clearTimeout(state.request.timer);
        if (log) console.info('[windows-menu] before popup', {
          pid: child.pid, mode: cold ? 'cold' : 'warm',
          elapsedMs: Math.round(performance.now() - state.request.started),
          waitedForStartup: state.request.waitedForStartup,
          parseMs: Number(fields[1]), shellMs: Number(fields[2]),
        });
        return;
      }
      const done = /^done ([0-4])$/.exec(line);
      if (!done || !state.request) return;
      const results: Result[] = ['invoked', 'dismissed', 'unavailable', 'failed', 'open-folder'];
      clear(results[Number(done[1])]);
      if (cold) {
        if (worker === state) worker = undefined;
        child.stdin.end();
      }
    });
    return state;
  }
  return {
    preheat() { if (!cold && !stopped) worker ??= start(); },
    /** 请求排队到已启动的辅助进程；路径以 UTF-16LE 十六进制编码，不进入命令行或日志。 */
    show(target: string, point: { x: number; y: number }, started: number,
      folder: boolean, authorize: (pid: number) => boolean): Promise<Result> {
      if (stopped) return Promise.resolve('unavailable');
      const state = worker ??= start();
      if (state.request) return Promise.resolve('dismissed');
      if (!state.child.pid || !authorize(state.child.pid)) {
        if (cold) { worker = undefined; state.child.stdin.end(); }
        return Promise.resolve('unavailable');
      }
      return new Promise(resolve => {
        state.request = { resolve, started, waitedForStartup: !state.ready,
          timer: setTimeout(() => state.child.kill(), 15000) };
        state.child.stdin.write(`${point.x} ${point.y} ${Number(folder)} ${Buffer.from(target, 'utf16le').toString('hex')}\n`);
      });
    },
    stop() {
      stopped = true;
      worker?.child.kill();
      worker = undefined;
    },
  };
}

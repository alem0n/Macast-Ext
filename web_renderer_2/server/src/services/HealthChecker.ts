import http from 'http';
import https from 'https';
import * as CastService from './CastService';
import { broadcastAll } from './SessionManager';
import { WsPlaylistUpdatedMessage } from '../types';

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes between full scans
const REQUEST_TIMEOUT_MS = 10_000; // 10 seconds per URL
const MAX_CONCURRENT = 3; // parallel HEAD requests
const MAX_FAILS = 2; // consecutive failures before removal

const TAG = '[HealthChecker]';

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
const failCounts = new Map<string, number>(); // url → consecutive failures

function log(msg: string, ...args: unknown[]): void {
  console.log(`${TAG} ${msg}`, ...args);
}

function checkUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const client = url.startsWith('https:') ? https : http;

    const req = client.request(
      url,
      { method: 'HEAD', timeout: REQUEST_TIMEOUT_MS },
      (res) => {
        const alive = res.statusCode != null && res.statusCode >= 200 && res.statusCode < 400;
        res.resume(); // consume response body so socket can be reused
        resolve(alive);
      },
    );

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

async function checkAll(): Promise<void> {
  if (running) return;
  running = true;

  try {
    const playlist = CastService.getPlaylist();
    if (playlist.length === 0) {
      failCounts.clear();
      return;
    }

    // Clean up fail counts for URLs no longer in playlist
    const activeUrls = new Set(playlist.map((item) => item.url));
    for (const url of failCounts.keys()) {
      if (!activeUrls.has(url)) {
        failCounts.delete(url);
      }
    }

    const total = playlist.length;
    log(`checking ${total} URLs (concurrency=${MAX_CONCURRENT})…`);

    // Check in batches of MAX_CONCURRENT
    for (let i = 0; i < playlist.length; i += MAX_CONCURRENT) {
      const batch = playlist.slice(i, i + MAX_CONCURRENT);
      const results = await Promise.all(batch.map((item) => checkUrl(item.url)));

      results.forEach((alive, j) => {
        const url = playlist[i + j].url;
        if (alive) {
          failCounts.delete(url);
        } else {
          const fails = (failCounts.get(url) || 0) + 1;
          failCounts.set(url, fails);
          const shortUrl = url.length > 80 ? url.substring(0, 80) + '…' : url;
          log(`FAIL #${fails}/${MAX_FAILS} — ${shortUrl}`);
        }
      });
    }

    // Collect URLs that exceeded max consecutive failures
    const deadUrls = new Set<string>();
    for (const [url, fails] of failCounts) {
      if (fails >= MAX_FAILS) {
        deadUrls.add(url);
      }
    }

    if (deadUrls.size > 0) {
      const removed = CastService.removeDeadUrls(deadUrls);

      // Remove their fail-count entries
      for (const url of deadUrls) {
        failCounts.delete(url);
      }

      log(`purged ${removed} dead URL(s) after ${MAX_FAILS} consecutive failures`);

      // Notify all clients
      const msg: WsPlaylistUpdatedMessage = {
        type: 'playlist:updated',
        payload: { items: CastService.getPlaylist() },
      };
      broadcastAll(msg);
    } else {
      const alive = total - deadUrls.size;
      log(`all ${alive}/${total} URLs alive (${failCounts.size} with warnings)`);
    }
  } catch (err) {
    log(`ERROR during check cycle: ${err}`);
  } finally {
    running = false;
  }
}

export function startHealthChecker(): void {
  const intervalSec = CHECK_INTERVAL_MS / 1000;
  log(`starting — will check every ${intervalSec}s, timeout=${REQUEST_TIMEOUT_MS / 1000}s/concurrency=${MAX_CONCURRENT}/maxFails=${MAX_FAILS}`);

  // Run immediately on start, then on interval
  checkAll();
  timer = setInterval(checkAll, CHECK_INTERVAL_MS);
}

export function stopHealthChecker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    log('stopped');
  }
}

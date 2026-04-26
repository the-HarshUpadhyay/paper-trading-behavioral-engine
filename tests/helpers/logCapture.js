// tests/helpers/logCapture.js — Container log capture via Docker Engine API + JSON parsing
// Reads structured pino-http logs from the API container via the Docker socket

const http = require('node:http');
const { execSync } = require('node:child_process');

// ── Constants ───────────────────────────────────────────────────────────────

const DOCKER_SOCKET = '/var/run/docker.sock';

// UUID v4 regex
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ── Container Discovery ─────────────────────────────────────────────────────

/**
 * Find the API container ID by listing Docker containers and matching the name.
 * Uses the Docker Engine API via Unix socket.
 */
async function findApiContainerId() {
  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath: DOCKER_SOCKET,
      path: '/containers/json?all=false',
      method: 'GET',
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const containers = JSON.parse(Buffer.concat(chunks).toString());
          // Find the API container (name includes "api")
          const api = containers.find(c =>
            c.Names && c.Names.some(n =>
              n.includes('api') && !n.includes('worker')
            )
          );
          if (api) {
            resolve(api.Id);
          } else {
            reject(new Error('API container not found'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Cache the container ID
let _cachedContainerId = null;

async function getApiContainerId() {
  if (!_cachedContainerId) {
    _cachedContainerId = await findApiContainerId();
  }
  return _cachedContainerId;
}

// ── Log Fetch via Docker API ────────────────────────────────────────────────

/**
 * Fetch raw log lines from the API container since a given epoch timestamp.
 * Uses GET /containers/{id}/logs via Docker Engine API.
 *
 * @param {number} sinceEpoch - Unix epoch seconds
 * @returns {Promise<string[]>} Array of raw log lines
 */
async function fetchContainerLogs(sinceEpoch) {
  const containerId = await getApiContainerId();

  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath: DOCKER_SOCKET,
      path: `/containers/${containerId}/logs?stdout=true&stderr=true&since=${sinceEpoch}&timestamps=false`,
      method: 'GET',
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        // Docker multiplexed stream: each frame has 8-byte header
        // header[0] = stream type (1=stdout, 2=stderr)
        // header[4..7] = payload length (big-endian uint32)
        const lines = [];
        let offset = 0;
        while (offset < raw.length) {
          if (offset + 8 > raw.length) break;
          const payloadLen = raw.readUInt32BE(offset + 4);
          if (offset + 8 + payloadLen > raw.length) break;
          const payload = raw.slice(offset + 8, offset + 8 + payloadLen).toString('utf8');
          // Split by newlines (a frame may contain multiple lines)
          const frameLines = payload.split('\n').filter(l => l.trim().length > 0);
          lines.push(...frameLines);
          offset += 8 + payloadLen;
        }
        resolve(lines);
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ── Log Parsing ─────────────────────────────────────────────────────────────

/**
 * Parse raw log lines into JSON objects.
 * Filters out non-JSON lines (e.g., startup messages, Docker metadata).
 * Returns { parsed: LogEntry[], failed: string[] }
 */
function parseLogs(rawLines) {
  const parsed = [];
  const failed = [];

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue; // skip non-JSON lines

    try {
      const obj = JSON.parse(trimmed);
      parsed.push(obj);
    } catch {
      failed.push(trimmed);
    }
  }

  return { parsed, failed };
}

/**
 * Capture and parse structured logs since a given epoch second.
 * Returns only pino-http request completion logs (msg === "request completed").
 */
async function captureRequestLogs(sinceEpoch) {
  const rawLines = await fetchContainerLogs(sinceEpoch);
  const { parsed, failed } = parseLogs(rawLines);

  // Filter to request completion logs only (pino-http emits these after each request)
  const requestLogs = parsed.filter(log => log.msg === 'request completed');
  return { requestLogs, allLogs: parsed, failed, rawLines };
}

/**
 * Find log entries matching a specific traceId.
 */
function findLogsByTraceId(logs, traceId) {
  return logs.filter(log =>
    log.traceId === traceId ||
    (log.req && log.req.traceId === traceId)
  );
}

/**
 * Find log entries matching a specific URL path.
 */
function findLogsByUrl(logs, urlPath) {
  return logs.filter(log =>
    log.req && log.req.url && log.req.url.startsWith(urlPath)
  );
}

/**
 * Get current epoch seconds (for Docker --since), with a small buffer.
 */
function epochNow(bufferSec = 3) {
  return Math.floor(Date.now() / 1000) - bufferSec;
}

/**
 * Wait for logs to be flushed from the container's stdout buffer.
 */
function waitForLogFlush(ms = 500) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Structured Log Validators ───────────────────────────────────────────────

/**
 * Validate that a log entry contains ALL required observability fields
 * with correct types and non-empty values.
 * Returns { valid: boolean, errors: string[] }
 */
function validateLogEntry(log) {
  const errors = [];

  // traceId: must be a non-empty UUID string
  if (!log.traceId) {
    errors.push('missing traceId');
  } else if (typeof log.traceId !== 'string') {
    errors.push(`traceId is ${typeof log.traceId}, expected string`);
  } else if (!UUID_RE.test(log.traceId)) {
    errors.push(`traceId "${log.traceId}" is not a valid UUID`);
  }

  // userId: must be a non-empty string
  if (!log.userId) {
    errors.push('missing userId');
  } else if (typeof log.userId !== 'string') {
    errors.push(`userId is ${typeof log.userId}, expected string`);
  }

  // responseTime (latency): must exist and be a number
  if (log.responseTime == null) {
    errors.push('missing responseTime (latency)');
  } else if (typeof log.responseTime !== 'number') {
    errors.push(`responseTime is ${typeof log.responseTime}, expected number`);
  } else if (log.responseTime < 0) {
    errors.push(`responseTime is ${log.responseTime}, expected >= 0`);
  }

  // statusCode: must be in res.statusCode
  const statusCode = log.res && log.res.statusCode;
  if (statusCode == null) {
    errors.push('missing res.statusCode');
  } else if (typeof statusCode !== 'number') {
    errors.push(`res.statusCode is ${typeof statusCode}, expected number`);
  } else if (statusCode < 100 || statusCode > 599) {
    errors.push(`res.statusCode ${statusCode} is out of valid HTTP range`);
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  UUID_RE,
  getApiContainerId,
  fetchContainerLogs,
  parseLogs,
  captureRequestLogs,
  findLogsByTraceId,
  findLogsByUrl,
  epochNow,
  waitForLogFlush,
  validateLogEntry,
};

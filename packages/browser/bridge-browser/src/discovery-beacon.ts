/**
 * Discovery beacon: a loopback-only HTTP listener on a well-known port that
 * answers `GET /ext/bridge-config` with the bridge WebSocket URL of the dsh
 * instance it belongs to.
 *
 * The extension can only find the bridge by probing fixed ports, but hosts
 * such as DeepSeek Harness Desktop start `dsh web --port 0` and land on a
 * random port every launch. The beacon gives those instances a stable place
 * for the extension to ask "where is your bridge?" without any host-side
 * configuration. It serves nothing else: every other path is 404, and it
 * never binds anything but 127.0.0.1.
 *
 * Multiple dsh instances on one machine each take the next free port in the
 * candidate window, so a CLI `dsh web` and the desktop app can coexist; the
 * extension probes the whole window.
 *
 * @module @onenightcarnival/dsh-bridge-browser/src/discovery-beacon
 */

import { createServer, type Server } from 'node:http'
import { BRIDGE_CONFIG_PATH } from './protocol.ts'

/** Default beacon port; also the first entry of the extension's probe window. */
export const DEFAULT_DISCOVERY_PORT = 43189

/** Number of consecutive ports (starting at the configured one) the beacon may fall back through. */
export const DISCOVERY_PORT_WINDOW = 4

/** Running beacon handle. */
export interface DiscoveryBeacon {
  /** Port the beacon actually bound (the configured port or a fallback inside the window). */
  readonly port: number
  /** Stop listening and settle once the socket is closed. */
  close(): Promise<void>
}

/** Beacon start options. */
export interface DiscoveryBeaconOptions {
  /** First port to try; the window extends `DISCOVERY_PORT_WINDOW - 1` ports above it. */
  port: number
  /** Ports to skip (typically the host webserver's own port, which already serves the config route). */
  skipPorts?: readonly number[]
  /** Resolve the bridge WebSocket URL at request time (the host port is stable, but keep it lazy). */
  resolveWsUrl: () => string
  /** Diagnostics sink. */
  log?: { info(message: string): void; warn(message: string): void }
}

/** Candidate ports for one configured base port, in probe order. */
export function discoveryPortWindow(base: number, window: number = DISCOVERY_PORT_WINDOW): number[] {
  const ports: number[] = []
  for (let offset = 0; offset < window; offset++) {
    const port = base + offset
    if (port > 65535) break
    ports.push(port)
  }
  return ports
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = (): void => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
}

/**
 * Start the beacon on the first free port of the window.
 * @param options - port window, skip list and URL resolver.
 * @returns the running beacon, or undefined when every candidate port is taken (logged, never thrown).
 */
export async function startDiscoveryBeacon(options: DiscoveryBeaconOptions): Promise<DiscoveryBeacon | undefined> {
  const skip = new Set(options.skipPorts ?? [])
  const candidates = discoveryPortWindow(options.port).filter(port => !skip.has(port))
  for (const port of candidates) {
    const server = createServer((req, res) => {
      const path = (req.url ?? '/').split('?')[0]
      if (req.method !== 'GET' || path !== BRIDGE_CONFIG_PATH) {
        res.writeHead(404, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
        res.end('not found')
        return
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ wsUrl: options.resolveWsUrl() }))
    })
    // Idle keep-alive sockets would otherwise delay close() during HMR/unload.
    server.keepAliveTimeout = 1_000
    try {
      await listen(server, port)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EADDRINUSE' || code === 'EACCES') continue
      throw error
    }
    options.log?.info(`browser bridge: discovery beacon listening on http://127.0.0.1:${port}${BRIDGE_CONFIG_PATH}`)
    return {
      port,
      close: () => new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => { if (error === undefined) resolve(); else reject(error) })
      }),
    }
  }
  options.log?.warn(
    `browser bridge: discovery beacon disabled — ports ${candidates.join(', ')} are all in use; `
    + 'the extension can still connect through its manual bridge address setting',
  )
  return undefined
}

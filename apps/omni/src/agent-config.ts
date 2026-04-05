import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const OMNICHANNEL_ROOT = resolve(here, '../../../omnichannel')

/**
 * Ensure per-agent dir exists with MCP config pointing at the gateway IPC socket.
 */
export function ensureAgentConfigDir(
  agentId: string,
  baseDir: string,
  ipcSocketPath: string,
  templateDir?: string | null,
): string {
  const dir = resolve(baseDir, agentId)
  if (existsSync(dir)) {
    return dir
  }
  mkdirSync(join(dir, '.claude'), { recursive: true })

  const ipc = resolve(ipcSocketPath)

  const mcpJson = {
    mcpServers: {
      omni: {
        command: 'bun',
        args: ['run', 'mcp'],
        cwd: OMNICHANNEL_ROOT,
        env: {
          OMNI_IPC_SOCKET: ipc,
        },
      },
    },
  }
  writeFileSync(join(dir, '.mcp.json'), JSON.stringify(mcpJson, null, 2) + '\n', 'utf8')

  const settings = {
    enabledMcpjsonServers: ['omni'],
  }
  writeFileSync(
    join(dir, '.claude', 'settings.local.json'),
    JSON.stringify(settings, null, 2) + '\n',
    'utf8',
  )

  if (templateDir && existsSync(templateDir)) {
    cpSync(templateDir, dir, { recursive: true, errorOnExist: false })
  }

  return dir
}

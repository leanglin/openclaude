import { existsSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import {
  getGlobalGraph,
  getOramaPersistencePath,
  resetGlobalGraph,
  type KnowledgeGraph,
} from '../../utils/knowledgeGraph.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { getProjectsDir } from '../../utils/envUtils.js'
import { sanitizePath } from '../../utils/sessionStoragePortable.js'
import { JSONProvider } from '../../utils/storage/JSONProvider.js'
import { SQLiteProvider } from '../../utils/storage/SQLiteProvider.js'
import type { KnowledgeGraphSnapshot } from './types.js'

function emptyGraph(): KnowledgeGraph {
  return {
    entities: {},
    relations: [],
    summaries: [],
    rules: [],
    lastUpdateTime: Date.now(),
  }
}

function isProcessCwd(cwd: string): boolean {
  return resolve(cwd) === resolve(process.cwd())
}

function getProjectDir(cwd: string): string {
  return join(getProjectsDir(), sanitizePath(cwd))
}

async function loadGraphForCwd(cwd: string): Promise<KnowledgeGraph> {
  if (isProcessCwd(cwd)) {
    return getGlobalGraph()
  }

  const projectDir = getProjectDir(cwd)
  const json = new JSONProvider(projectDir)
  const sqlite = new SQLiteProvider(projectDir)
  try {
    await sqlite.init()
    const graphFromJson = json.loadGraph()
    const graphFromSqlite = sqlite.isReady ? sqlite.loadGraph() : null

    if (graphFromJson && graphFromSqlite) {
      return graphFromSqlite.lastUpdateTime > graphFromJson.lastUpdateTime
        ? graphFromSqlite
        : graphFromJson
    }
    return graphFromJson ?? graphFromSqlite ?? emptyGraph()
  } finally {
    sqlite.close()
  }
}

export async function getKnowledgeGraphSnapshot(
  cwd: string,
): Promise<KnowledgeGraphSnapshot> {
  const graph = await loadGraphForCwd(cwd)
  return {
    enabled: getGlobalConfig().knowledgeGraphEnabled !== false,
    entities: Object.values(graph.entities),
    relations: graph.relations,
    summaries: graph.summaries,
    rules: graph.rules,
    lastUpdateTime: graph.lastUpdateTime,
  }
}

export function setKnowledgeGraphEnabled(enabled: boolean): void {
  saveGlobalConfig(current => ({ ...current, knowledgeGraphEnabled: enabled }))
}

export async function clearKnowledgeGraph(cwd: string): Promise<void> {
  if (isProcessCwd(cwd)) {
    resetGlobalGraph()
    return
  }

  const projectDir = getProjectDir(cwd)
  const json = new JSONProvider(projectDir)
  const sqlite = new SQLiteProvider(projectDir)
  try {
    await sqlite.init()
    sqlite.clear()
  } finally {
    sqlite.close()
  }

  const graph = emptyGraph()
  if (!(json.delete() || json.saveGraph(graph))) {
    throw new Error('Failed to reset knowledge graph JSON state.')
  }
  json.saveGraph(graph)

  for (const sqlitePath of [
    join(projectDir, 'knowledge.db'),
    join(projectDir, 'knowledge.db-wal'),
    join(projectDir, 'knowledge.db-shm'),
  ]) {
    if (existsSync(sqlitePath)) {
      rmSync(sqlitePath, { force: true })
    }
  }

  const oramaPath = getOramaPersistencePath(cwd)
  if (existsSync(oramaPath)) {
    rmSync(oramaPath, { force: true, recursive: true })
  }
}

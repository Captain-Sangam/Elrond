import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { fixtureConfig, fixtureProvider } from './fixture'
import { renderReport } from './report'
import { runBenchmarkSuite, validateConfig } from './suite'
import type { BenchmarkConfig, BenchmarkPrompt, BenchmarkResults, HumanLabel } from './types'
import type { ProviderName } from '../../src/shared/types'
import type { AgentProvider } from '../../src/main/orchestrator/providers/types'

async function json<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, 'utf8')) as T }

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    live: { type: 'boolean', default: false }, config: { type: 'string' }, prompts: { type: 'string' },
    out: { type: 'string' }, report: { type: 'string' }, labels: { type: 'string' }, help: { type: 'boolean' }
  } })
  if (values.help) {
    console.log('make bench [ARGS="--live --config bench/config.local.json --prompts bench/prompts/smoke.json --out bench/results/run"]\nmake bench ARGS="--report bench/results/run --labels /path/to/labels.json"\nWithout --live, runs synthetic offline fixtures only.')
    return
  }
  if (values.report) {
    const directory = resolve(values.report)
    const results = await json<BenchmarkResults>(join(directory, 'results.json'))
    const labels = values.labels ? await json<HumanLabel[]>(resolve(values.labels)) : []
    validateConfig(results.config)
    const report = renderReport(results, labels)
    await writeFile(join(directory, 'report.md'), report)
    console.log(report)
    return
  }
  if (values.labels) throw new Error('--labels requires --report')
  if (values.live && !values.config) throw new Error('Live runs require --config with fixed models, environment variable names, and explicit prices')
  const config = values.config ? await json<BenchmarkConfig>(resolve(values.config)) : fixtureConfig
  validateConfig(config)
  const prompts = await json<BenchmarkPrompt[]>(resolve(values.prompts ?? 'bench/prompts/smoke.json'))
  let providers: Record<ProviderName, AgentProvider> = { openai: fixtureProvider, anthropic: fixtureProvider, google: fixtureProvider, ollama: fixtureProvider }
  const credentials = new Map<ProviderName, string>()
  if (values.live) {
    const [{ OpenAIProvider }, { AnthropicProvider }, { GoogleProvider }, { OllamaProvider }] = await Promise.all([
      import('../../src/main/orchestrator/providers/openai'), import('../../src/main/orchestrator/providers/anthropic'),
      import('../../src/main/orchestrator/providers/google'), import('../../src/main/orchestrator/providers/ollama')
    ])
    providers = { openai: new OpenAIProvider(), anthropic: new AnthropicProvider(), google: new GoogleProvider(), ollama: new OllamaProvider() }
    for (const a of config.agents) {
      const credential = a.provider === 'ollama' ? a.baseURL : a.credentialEnv ? process.env[a.credentialEnv] : undefined
      if (!credential) throw new Error(`Configure ${a.provider === 'ollama' ? 'baseURL' : 'a populated credentialEnv'} for ${a.name}`)
      if (credentials.has(a.provider) && credentials.get(a.provider) !== credential) throw new Error('Agents sharing a provider must use the same credential/baseURL')
      credentials.set(a.provider, credential)
    }
  }
  const out = resolve(values.out ?? `bench/results/${new Date().toISOString().replace(/[:.]/g, '-')}`)
  // Refuse to reuse a run directory so the private mapping stays paired with its labels.
  await mkdir(resolve(out, '..'), { recursive: true })
  await mkdir(out)
  const runnerHash = createHash('sha256').update(await readFile(__filename)).digest('hex')
  await copyFile(__filename, join(out, 'benchmark-bundle.cjs'))
  const revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() + (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() ? '-dirty' : '')
  const { results, blindItems } = await runBenchmarkSuite({
    config, prompts, execution: values.live ? 'live' : 'fixture', revision, runnerHash, providers,
    resolveCredential: async (name) => credentials.get(name) ?? 'fixture', onProgress: console.log,
    onRun: async (runs) => { await writeFile(join(out, 'progress.json'), JSON.stringify({ config, execution: values.live ? 'live' : 'fixture', revision, runnerHash, runs }, null, 2)) }
  })
  await writeFile(join(out, 'results.json'), JSON.stringify(results, null, 2))
  await writeFile(join(out, 'blind-items.json'), JSON.stringify(blindItems.map(({ positions: _positions, stopReason: _stopReason, ...item }) => item), null, 2))
  await writeFile(join(out, 'stop-review-items.json'), JSON.stringify(blindItems, null, 2))
  await writeFile(join(out, 'labels-template.json'), JSON.stringify(blindItems.map((item) => ({ id: item.id, qualityScore: null, falseStop: null })), null, 2))
  const report = renderReport(results)
  await writeFile(join(out, 'report.md'), report)
  console.log(`\n${report}\nSaved to ${out}`)
}

main().catch((err) => { console.error(err instanceof Error ? err.message : String(err)); process.exitCode = 1 })

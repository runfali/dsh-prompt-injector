# Install / Start / Uninstall Evidence (Disposable Profile)

> 一次性 Profile 安装、启动、卸载全链路证据。初版 2026-09-02（dsh 0.1.2-alpha.4），
> 2026-09-10 在 **dsh 0.1.5-rc.1** 上重跑（隔离 DSH_HOME + 独立端口，未触碰任何已部署的 dsh 实例）。

## Environment

| Item | Value |
|---|---|
| dsh host (current) | @deepseek-ai/dsh **0.1.5-rc.1** |
| dsh host (first run) | @deepseek-ai/dsh 0.1.2-alpha.4 |
| Node.js | v24.19.0 |
| pnpm | 11.22.0 (forwarded by `dsh plugin`) |
| Isolated home | DSH_HOME=$WORK/.dsh-pi-evidence (never /root/.dsh) |
| Plugin under test | dsh-prompt-injector **0.1.5-rc.1** (local directory install) |

## Manifest compatibility declaration

Declared in `package.json` (machine-readable):

```jsonc
"engines": { "node": "^22.19.0 || >=24.0.0" },
"peerDependencies": {
  "@deepseek-ai/dsh-settings": ">=0.1.2-alpha.3 <0.2.0 || >=0.1.5-alpha.1 <0.1.6",
  "@deepseek-ai/schemastery": "^3.18.2",
  "react": "^18.0.0"
},
"dsh": {
  "engines": { "dsh": ">=0.1.2-alpha.3 <0.2.0 || >=0.1.5-alpha.1 <0.1.6" },
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": { "platform": "web" }
}
```

- **Node.js range**: `^22.19.0 || >=24.0.0` (same convention as published dsh community plugins; verified on v24.19.0).
- **DSH range**: `>=0.1.2-alpha.3 <0.2.0 || >=0.1.5-alpha.1 <0.1.6` under `dsh.engines.dsh` — adapted to the 0.1.2-alpha.3 settings contract (`settings.installSection`), verified on 0.1.2-alpha.4 **and 0.1.5-rc.1**. The disjunction is load-bearing: npm semver satisfies a prerelease only from a range group that itself contains a prerelease with the same `[major,minor,patch]` tuple, so the plain `<0.2.0` group does not cover `0.1.5-rc.1`. `test/entry.test.mjs` pins this with a 10-row decision table plus a counter-proof against the old single range.
- **Supply chain**: zero `dependencies`, zero `optionalDependencies`. The three peers (`@deepseek-ai/dsh-settings`, `@deepseek-ai/schemastery`, `react`) are all provided by the dsh host install itself; the plugin ships no bundled or vendored copies. No `postinstall`/`preinstall` scripts, no install-time network calls, no runtime network calls, no child processes, no filesystem writes (settings persistence is performed by the dsh settings service, not the plugin).

## 1. Install

```console
$ DSH_HOME=$WORK/.dsh-pi-evidence dsh plugin --profile dsh-pi-test add /path/to/dsh-prompt-injector

dsh: initialized profile dsh-pi-test at …/.dsh-pi-evidence/profiles/dsh-pi-test

dependencies:
+ dsh-prompt-injector link:/path/to/dsh-prompt-injector

Already up to date
Done in 1.7s using pnpm v11.22.0
```

Resulting profile `package.json` — the plugin's own `cordis.patch.yml` was merged into the bundle list automatically:

```json
"dependencies": { "dsh-prompt-injector": "link:/path/to/dsh-prompt-injector" },
"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "dsh-prompt-injector"], "patchReload": "live" } }
```

## 2. Start

Composed tree (`dsh --profile dsh-pi-test --dump-config`) ends with the plugin layer:

```yaml
# == dsh-prompt-injector
- id: prompt-injector
  name: dsh-prompt-injector
  config:
    enabled: true
    skipTrivial: true
```

Boot 1 — foreground, stdin EOF exits cleanly:

```console
$ echo | dsh --profile dsh-pi-test   # exit code 0
```

Boot 2 — long-running process check:

```console
$ dsh --profile dsh-pi-test &        # background boot
$ pgrep -af "dsh --profile dsh-pi-test"
199038 node /usr/bin/dsh --profile dsh-pi-test
```

The process stayed up (real host boot; the plugin entry was imported and applied — a failed import would abort the boot with a loader error). Loggers stay silent by default in dsh: process liveness + the composed tree are the observable surfaces, matching the host's own logging contract. The profile's composed `cordis.yml` materialized on boot contains the `prompt-injector` entry (verified by grep before uninstall).

## 3. Uninstall

```console
$ DSH_HOME=$WORK/.dsh-pi-evidence dsh plugin --profile dsh-pi-test remove dsh-prompt-injector

dependencies:
- dsh-prompt-injector link:/path/to/dsh-prompt-injector

Already up to date
Done in 1.7s using pnpm v11.22.0
```

Post-uninstall verification:

- profile `package.json` `dsh.profile.bundles` reverted to `["@deepseek-ai/dsh-base"]`
- composed `cordis.yml`: `grep -c prompt-injector` → `0`
- known pnpm quirk: the `node_modules/dsh-prompt-injector` symlink may linger after `remove`; the disposable profile directory is deleted wholesale afterwards (`rm -rf`), which also clears it

## 4. Failure bounds (runtime safety)

- Every injection path is wrapped: `agent/pre-step` executes the downstream chain first, then performs the injection in a separate try/catch — on any error the **original decision is returned unchanged**, so a plugin fault can never break a turn (errors go to `logger.debug`).
- Compaction generation counting is best-effort: malformed/missing event payloads are no-ops; counters are bounded Maps (256 entries) with session-dispose cleanup — no unbounded memory growth.
- Unknown `trigger` values normalize to `everyTurn`; an empty prompt list means nothing is injected.
- The plugin never executes the text it injects — prompts are plain strings appended as `form:'notice'` messages; judgment stays with the model.

## 5. Reproduce

```bash
export DSH_HOME=$(mktemp -d)
dsh plugin --profile evidence add /path/to/dsh-prompt-injector
dsh --profile evidence --dump-config          # composed tree shows the entry
echo | dsh --profile evidence; echo "exit=$?" # boot + clean exit 0
dsh plugin --profile evidence remove dsh-prompt-injector
rm -rf "$DSH_HOME"
```

> 中文摘要：隔离 DSH_HOME 的一次性 profile 实测——`dsh plugin add` 安装（link 依赖 + 随包 patch 自动并入 bundles）、`--dump-config` 可见 `prompt-injector` 层、真机启动 exit 0 + 后台进程存活、`dsh plugin remove` 卸载后 bundles/cordis.yml 全部回落。manifest 已声明 Node 与 DSH 兼容范围；零运行时依赖（三个 peer 均由 dsh 宿主提供）；无网络、无文件写、无子进程；注入全路径 try/catch，插件故障不破坏对话轮次。

/**
 * Standalone tsdown config for the skill-studio plugin.
 *
 * Uses the vendored client-bundle preset (build/tsdown.client.ts, copied from
 * the dsh-web-ui family's shared preset with the repository-root helpers
 * rebased onto this package): the node-half lib/ (host routes + scanning)
 * plus the browser bundle lib/client.js (closure-factory artifact for the
 * GUI's __ModuleLoader__, CSS Modules inlined with auto-injected
 * <style data-plugin>). The client entry is auto-detected at
 * src/client/index.ts by the preset.
 */
import { clientBundle } from './build/tsdown.client.ts'

export default clientBundle('@mhw12138/dsh-ui-better-sidebar-skill', ['src/index.ts'], {
  libExternal: [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-host-webserver',
  ],
})

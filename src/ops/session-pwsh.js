import process from 'node:process'

/** A reversible runtime-only config overlay; never edits profile files or services. */
export function mountBundledPwsh(ctx, shells) {
  let active = () => false
  if (!shells.pwsh.available || process.platform !== 'win32')
    return () => false
  ctx.inject(['loader'], (loaderCtx) => {
    const loader = loaderCtx.get('loader')
    // Desktop replaces (and disables) the upstream row, while inheriting its
    // public pwshPath config and sandbox execution chain. Match both identities exactly.
    const matches = entry => !entry?.disabled && (
      (entry?.options?.id === 'pwsh-sandbox' && entry.options.name === '@deepseek-ai/dsh-pwsh-sandbox')
      || (entry?.options?.id === 'desktop-windows-pwsh-sandbox' && entry.options.name === 'dsh-plugin-desktop/windows-pwsh-sandbox')
    )
    active = (owner = ctx) => owner.get('shell')?.pwshPath === shells.pwsh.file
      && [...loader.entries()].some(entry => matches(entry) && entry.fiber?.state === 2)
    const overlaid = new Set()
    const refresh = (restoring = false) => {
      const pending = []
      for (const entry of loader.entries()) {
        if (!matches(entry) || entry.fiber?.state !== 2)
          continue
        if (restoring ? !overlaid.has(entry) : entry.fiber.config.pwshPath.get() === shells.pwsh.file)
          continue
        try {
          // Public Fiber.update with noSave recomputes from the owner's latest
          // raw config. No stored config, volatile reference, or method is changed.
          entry.fiber.update(entry.options.config, true)
          pending.push(entry.fiber.await())
        }
        catch (error) {
          loaderCtx.logger.warn(`dsh-ops: PowerShell runtime overlay failed: ${error.message}`)
        }
      }
      return Promise.allSettled(pending)
    }
    const unhook = loaderCtx.on('internal/config', function (_raw, next) {
      const config = next()
      if (!matches(this.entry) || this.parent?.fiber?.entry === this.entry)
        return config
      if (config?.pwshPath === shells.pwsh.file)
        return config
      overlaid.add(this.entry)
      return { ...config, pwshPath: shells.pwsh.file }
    }, { global: true, prepend: true })
    let stopped = false
    loaderCtx.effect(() => () => {
      if (stopped)
        return
      stopped = true
      active = () => false
      unhook()
      return refresh(true)
    }, 'dsh-ops: restore owning PowerShell executor config')
    void refresh()
  })
  return owner => active(owner)
}

import { PACKAGE_NAME } from '../constants'
import { CLASSES, STYLE_TAG_ID } from './constants'

export function mountConfigurationStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.plugin = PACKAGE_NAME
  style.dataset.pluginCss = STYLE_TAG_ID
  style.textContent = `
.${CLASSES.root} { display: grid; gap: 16px; color: var(--dsw-alias-text-primary, inherit); font-size: 14px; }
.${CLASSES.root} .${CLASSES.help}, .${CLASSES.root} .${CLASSES.rowDescription} { margin: 0; color: var(--dsw-alias-text-secondary, #85858b); line-height: 1.6; }
.${CLASSES.root} .${CLASSES.row} { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 20px; border: 1px solid var(--dsw-alias-border-primary, #8884); border-radius: 14px; background: var(--dsw-alias-surface-primary, transparent); }
.${CLASSES.root} .${CLASSES.rowText} { display: grid; gap: 5px; min-width: 0; }
.${CLASSES.root} .${CLASSES.rowTitle} { font-weight: 500; }
.${CLASSES.root} .${CLASSES.notice} { margin: 12px 0; color: var(--dsw-alias-text-secondary, #85858b); line-height: 1.6; }
@media (max-width: 620px) { .${CLASSES.root} .${CLASSES.row} { padding: 16px; } }
`
  document.head.append(style)
  return () => style.remove()
}

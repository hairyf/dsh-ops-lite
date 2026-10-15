import { PACKAGE_NAME } from '../constants'
import { CLASSES, STYLE_TAG_ID } from './constants'

export function mountConfigurationStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.plugin = PACKAGE_NAME
  style.dataset.pluginCss = STYLE_TAG_ID
  style.textContent = `
.${CLASSES.root} { display: grid; gap: 20px; color: var(--dsw-alias-text-primary, inherit); font-size: 14px; }
.${CLASSES.root} .${CLASSES.cards} { display: grid; gap: 16px; }
.${CLASSES.root} .${CLASSES.card}, .${CLASSES.root} .${CLASSES.cli} { border: 1px solid var(--dsw-alias-border-primary, #8884); border-radius: 14px; padding: 20px; background: var(--dsw-alias-surface-primary, transparent); }
.${CLASSES.root} .${CLASSES.heading} { margin: 0 0 12px; font-size: 15px; font-weight: 600; }
.${CLASSES.root} .${CLASSES.help}, .${CLASSES.root} .${CLASSES.rowDescription} { margin: 0; color: var(--dsw-alias-text-secondary, #85858b); line-height: 1.6; }
.${CLASSES.root} .${CLASSES.card} ul { list-style: none; padding: 0; margin: 4px 0 0; }
.${CLASSES.root} .${CLASSES.row} { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 14px 0; }
.${CLASSES.root} li.${CLASSES.row} + li.${CLASSES.row} { border-top: 1px solid var(--dsw-alias-border-primary, #8883); }
.${CLASSES.root} .${CLASSES.rowText} { display: grid; gap: 5px; min-width: 0; }
.${CLASSES.root} .${CLASSES.rowTitle}, .${CLASSES.root} .${CLASSES.label} { font-weight: 500; }
.${CLASSES.root} .${CLASSES.notice} { margin: 14px 0; padding: 12px 14px; border-radius: 10px; background: var(--dsw-alias-surface-secondary, #8881); line-height: 1.7; }
.${CLASSES.root} .${CLASSES.fields} { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 16px; }
.${CLASSES.root} .${CLASSES.field} { display: grid; gap: 8px; margin-top: 14px; }
.${CLASSES.root} .${CLASSES.select}, .${CLASSES.root} .${CLASSES.textarea} { box-sizing: border-box; width: 100%; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-primary, #8885); border-radius: 10px; background: var(--dsw-alias-surface-primary, transparent); color: inherit; font: inherit; }
.${CLASSES.root} .${CLASSES.textarea} { resize: vertical; min-height: 84px; }
.${CLASSES.root} .${CLASSES.select}:focus-visible, .${CLASSES.root} .${CLASSES.textarea}:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #537bd9); outline-offset: 2px; }
.${CLASSES.root} .${CLASSES.select}:disabled, .${CLASSES.root} .${CLASSES.textarea}:disabled { opacity: .55; }
.${CLASSES.root} .${CLASSES.invalid} { color: var(--dsw-alias-text-danger, #d14b4b); line-height: 1.6; }
.${CLASSES.root} .${CLASSES.cliCommand} { display: grid; gap: 6px; margin-top: 14px; }
.${CLASSES.root} .${CLASSES.cliCommand} code { padding: 10px 12px; border-radius: 8px; background: var(--dsw-alias-surface-secondary, #8881); overflow-wrap: anywhere; font-size: 12px; user-select: text; }
@media (max-width: 620px) { .${CLASSES.root} .${CLASSES.fields} { grid-template-columns: 1fr; } .${CLASSES.root} .${CLASSES.card} { padding: 16px; } }
`
  document.head.append(style)
  return () => style.remove()
}

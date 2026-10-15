import type { ReactElement } from 'react'
import type { ConfigurationProps } from './types'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { DEFAULT_CONFIG } from '../constants'
import { CLASSES, CONFIGURATION_FIELD, CONFIGURATION_MESSAGES, TOGGLE_DESCRIPTION, TOGGLE_LABEL } from './constants'

export function ConfigurationPage({ view, configScope }: ConfigurationProps): ReactElement {
  const snapshot = useSyncExternalStore(listener => configScope.subscribe(listener), () => configScope.getSnapshot())
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const inFlight = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const available = snapshot.status === 'ready'
  const writable = available && snapshot.writable && snapshot.mode === 'host'

  async function update(value: boolean): Promise<void> {
    const current = configScope.getSnapshot()
    if (inFlight.current || current.status !== 'ready' || !current.writable || current.mode !== 'host')
      return
    inFlight.current = true
    setSaving(true)
    setFailed(false)
    try {
      const accepted = await configScope.mutate([{ op: 'set', path: [CONFIGURATION_FIELD], value }], current.revision)
      if (alive.current)
        setFailed(!accepted)
    }
    catch {
      if (alive.current)
        setFailed(true)
    }
    finally {
      inFlight.current = false
      if (alive.current)
        setSaving(false)
    }
  }

  if (view === 'summary')
    return <p className={CLASSES.summary}>{TOGGLE_DESCRIPTION}</p>

  return (
    <section className={CLASSES.root}>
      <div className={CLASSES.row}>
        <span className={CLASSES.rowText}>
          <span className={CLASSES.rowTitle}>{TOGGLE_LABEL}</span>
          <span className={CLASSES.rowDescription}>{TOGGLE_DESCRIPTION}</span>
        </span>
        <Switch
          checked={snapshot.value?.disableOfficialTools ?? DEFAULT_CONFIG.disableOfficialTools}
          disabled={!writable || saving}
          label={TOGGLE_LABEL}
          title={TOGGLE_DESCRIPTION}
          onChange={update}
        />
      </div>
      {!available
        ? <p className={CLASSES.status} role="status">{CONFIGURATION_MESSAGES.unavailable}</p>
        : !writable && <p className={CLASSES.status} role="status">{CONFIGURATION_MESSAGES.readOnly}</p>}
      {failed && <p className={CLASSES.status} role="alert">{CONFIGURATION_MESSAGES.saveFailed}</p>}
    </section>
  )
}

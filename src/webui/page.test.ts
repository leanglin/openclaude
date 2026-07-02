import { describe, expect, test } from 'bun:test'
import { renderWebUiPage } from './page.js'

describe('webui page', () => {
  test('uses OpenCat visible branding and the icon asset', () => {
    const html = renderWebUiPage()

    expect(html).toContain('OpenCat Web')
    expect(html).toContain('/assets/opencat.ico')
    expect(html).not.toContain('OpenClaude')
  })
})

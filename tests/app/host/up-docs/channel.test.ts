import { describe, expect, test } from 'bun:test'

import { parseParentOrigin, parseUpDocsHost } from '@/app/host/up-docs/channel'

describe('UP Docs host channel', () => {
  test('takes an exact http or https origin as the parent', () => {
    expect(parseParentOrigin('https://docs.example.com')).toBe('https://docs.example.com')
    expect(parseParentOrigin('http://localhost:5173')).toBe('http://localhost:5173')
  })

  test('refuses any origin that is not written exactly', () => {
    for (const value of [
      null,
      '',
      '*',
      'null',
      'https://docs.example.com/',
      'https://docs.example.com/app',
      'https://docs.example.com?x=1',
      'HTTPS://docs.example.com',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'ws://docs.example.com',
      'docs.example.com'
    ]) {
      expect(parseParentOrigin(value)).toBeNull()
    }
  })

  test('is host mode only with host=up-docs, and has a parent only in a frame', () => {
    expect(parseUpDocsHost('?parent=https://a.example', true)).toBeNull()
    expect(parseUpDocsHost('?host=other&parent=https://a.example', true)).toBeNull()
    expect(parseUpDocsHost('?host=up-docs&parent=https://a.example', true)).toEqual({
      parentOrigin: 'https://a.example'
    })
    expect(parseUpDocsHost('?host=up-docs&parent=https://a.example', false)).toEqual({
      parentOrigin: null
    })
    expect(parseUpDocsHost('?host=up-docs&parent=*', true)).toEqual({ parentOrigin: null })
  })
})

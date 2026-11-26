import * as v from 'valibot'

/** The automation bridge's WebSocket, which the host hands the editor with its one-use ticket. */
const socketURLSchema = v.pipe(
  v.string(),
  v.url(),
  v.check((value) => /^wss?:/.test(value), 'socketURL must be a ws: or wss: address')
)

/** Opens a design: its `.fig` bytes, or none for a new one, with its name. */
export const loadMessageSchema = v.object({
  type: v.literal('up-designer:load'),
  bytes: v.nullable(v.instance(ArrayBuffer)),
  name: v.optional(v.string()),
  socketURL: v.optional(socketURLSchema)
})

/** Connects the automation bridge to a new address, such as one with a fresh ticket. */
export const connectMessageSchema = v.object({
  type: v.literal('up-designer:connect'),
  socketURL: socketURLSchema
})

/** The host stored the save numbered `seq`. */
export const savedMessageSchema = v.object({
  type: v.literal('up-designer:saved'),
  seq: v.number()
})

/** Save now, whether or not anything changed, such as before the host page closes. */
export const saveNowMessageSchema = v.object({ type: v.literal('up-designer:save-now') })

/** Save only unsaved changes, then answer `flushed`, such as when the host page closes. */
export const flushMessageSchema = v.object({ type: v.literal('up-designer:flush') })

export const hostMessageSchema = v.variant('type', [
  loadMessageSchema,
  connectMessageSchema,
  savedMessageSchema,
  saveNowMessageSchema,
  flushMessageSchema
])

export type UpDocsLoadMessage = v.InferOutput<typeof loadMessageSchema>
export type UpDocsHostMessage = v.InferOutput<typeof hostMessageSchema>

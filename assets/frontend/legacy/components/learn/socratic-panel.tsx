"use client"

import { useRef, useState } from "react"
import { Loader2, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { sendChatMessage, type ChatMessage } from "@/lib/learn-service"

type SocraticPanelProps = {
  scope: string | null
  doc?: string
}

export function SocraticPanel({ scope, doc }: SocraticPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [contextCount, setContextCount] = useState<number | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: text }]
    setMessages(nextMessages)
    setInput("")
    setLoading(true)
    setError(null)
    try {
      const data = await sendChatMessage(nextMessages, scope, doc)
      setContextCount(data.contextTripleCount)
      setMessages([...nextMessages, { role: "assistant", content: data.reply }])
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chat failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 py-2 border-b text-xs text-muted-foreground">
        Grounded in knowledge-graph triples
        {contextCount != null ? ` (${contextCount} triples in context)` : ""}
        {scope ? ` · scope: ${scope}` : " · whole graph"}
      </div>

      <ScrollArea className="flex-1 px-4">
        <div className="py-4 space-y-3 min-h-[160px]">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Ask a question about the material. The tutor uses only triples from your graph.
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`rounded-lg px-3 py-2 text-sm max-w-[90%] whitespace-pre-wrap ${
                m.role === "user"
                  ? "ml-auto bg-nvidia-green/15 text-foreground"
                  : "bg-muted text-foreground"
              }`}
            >
              {m.content}
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Thinking…
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {error && <p className="px-4 text-sm text-destructive">{error}</p>}

      <div className="flex gap-2 p-4 border-t">
        <Input
          placeholder="Ask a probing question…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          disabled={loading}
        />
        <Button type="button" size="icon" onClick={send} disabled={loading || !input.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

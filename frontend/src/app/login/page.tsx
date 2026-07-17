"use client"

import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { signIn } from "next-auth/react"
import { Loader2, Lock } from "lucide-react"
import { Button } from "@/kit/ui/button"
import { Input } from "@/kit/ui/input"
import { Label } from "@/kit/ui/label"
import { BrandMark } from "@/kit/layout/brand-mark"

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const from = searchParams.get("from") || "/"

  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const result = await signIn("credentials", {
        username,
        password,
        redirect: false,
      })
      if (result?.error) {
        setError("Invalid username or password.")
        setSubmitting(false)
        return
      }
      router.push(from)
      router.refresh()
    } catch {
      setError("Sign-in failed. Please try again.")
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <BrandMark className="h-10 w-10 text-brand" />
        <h1 className="text-xl font-bold gradient-text">Learn Hub</h1>
        <p className="text-sm text-muted-foreground">Sign in to your workspace</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="username">Username</Label>
          <Input
            id="username"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full gap-2" disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        Accounts are provisioned by the administrator.
      </p>
    </div>
  )
}

export default function LoginPage() {
  return (
    <main className="flex min-h-[calc(100vh-65px)] items-center justify-center p-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  )
}

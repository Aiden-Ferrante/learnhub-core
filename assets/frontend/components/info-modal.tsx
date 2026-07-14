"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Info, Sparkles, Upload, Zap, BookOpen, GraduationCap } from "lucide-react"

export function InfoModal() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="group">
          <Info className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[550px] max-h-[85vh] overflow-y-auto">
        <DialogHeader className="pb-6 border-b border-border/10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-brand/15 flex items-center justify-center">
              <GraduationCap className="h-5 w-5 text-brand" />
            </div>
            <DialogTitle className="text-2xl font-bold text-foreground build-gradient-text">
              Learn Hub
            </DialogTitle>
          </div>
          <DialogDescription className="text-base text-muted-foreground leading-relaxed">
            Turn a textbook or PDF into a course you actually study. Learn Hub breaks each chapter into
            learnable concepts, then drives you through reading, quizzes, and spaced-repetition recall so the
            material sticks. Runs fully local on Ollama — no API keys.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-8 pt-6">
          {/* Key Features Section */}
          <div className="build-card">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 rounded-lg bg-brand/15 flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-brand" />
              </div>
              <h4 className="text-lg font-semibold text-foreground">What it does</h4>
            </div>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-2 h-2 rounded-full bg-brand mt-2 flex-shrink-0"></div>
                <p className="text-sm text-foreground leading-relaxed">
                  <span className="font-semibold">Concept extraction:</span> every chapter becomes a set of grounded, learnable concepts — a course, not a wall of text
                </p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-2 h-2 rounded-full bg-brand mt-2 flex-shrink-0"></div>
                <p className="text-sm text-foreground leading-relaxed">
                  <span className="font-semibold">Quizzes &amp; spaced repetition:</span> passage-grounded questions and recall reviews that resurface concepts right before you forget them
                </p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-2 h-2 rounded-full bg-brand mt-2 flex-shrink-0"></div>
                <p className="text-sm text-foreground leading-relaxed">
                  <span className="font-semibold">Reading surfaces &amp; audiobooks:</span> deep-read chapters with explanations, or listen with word-level read-along highlighting
                </p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-2 h-2 rounded-full bg-brand mt-2 flex-shrink-0"></div>
                <p className="text-sm text-foreground leading-relaxed">
                  <span className="font-semibold">Keyless &amp; local:</span> all inference runs on your own Ollama models — your library never leaves your machine
                </p>
              </div>
            </div>
          </div>

          {/* How to Use Section */}
          <div className="build-card">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 rounded-lg bg-brand/15 flex items-center justify-center">
                <Info className="h-4 w-4 text-brand" />
              </div>
              <h4 className="text-lg font-semibold text-foreground">How to Use</h4>
            </div>
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="w-6 h-6 rounded-full bg-brand/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Upload className="h-3 w-3 text-brand" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground mb-1">1. Add a book</p>
                  <p className="text-xs text-muted-foreground">Upload a PDF or markdown textbook to start a new course</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-6 h-6 rounded-full bg-brand/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Sparkles className="h-3 w-3 text-brand" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground mb-1">2. Process into concepts</p>
                  <p className="text-xs text-muted-foreground">Learn Hub extracts the chapter's concepts and builds its study material</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-6 h-6 rounded-full bg-brand/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <BookOpen className="h-3 w-3 text-brand" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground mb-1">3. Study</p>
                  <p className="text-xs text-muted-foreground">Read, take passage-grounded quizzes, and run recall reviews</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-6 h-6 rounded-full bg-brand/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Zap className="h-3 w-3 text-brand" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground mb-1">4. Track mastery</p>
                  <p className="text-xs text-muted-foreground">Watch concept mastery build over time and let spaced repetition schedule the rest</p>
                </div>
              </div>
            </div>
          </div>

          {/* Local & keyless footer */}
          <div className="bg-brand/5 border border-brand/20 rounded-xl p-6">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Runs entirely on local Ollama inference — no API keys, no cloud, your documents stay on your own machine.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

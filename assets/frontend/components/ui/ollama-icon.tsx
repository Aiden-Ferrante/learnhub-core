import React from 'react'
import Image from 'next/image'

interface OllamaIconProps {
  className?: string
}

export function OllamaIcon({ className = "h-4 w-4" }: OllamaIconProps) {
  return (
    <Image
      src="/ollama-logo.svg"
      alt="Ollama"
      width={16}
      height={16}
      className={`${className} dark:invert`}
      style={{
        objectFit: 'contain'
      }}
    />
  )
}

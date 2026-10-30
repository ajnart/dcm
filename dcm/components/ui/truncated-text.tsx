"use client"

import { cn } from "@/lib/utils"
import { useEffect, useRef, useState } from "react"

interface TruncatedTextProps {
  text: string
}

export function TruncatedText({ text }: TruncatedTextProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isTruncated, setIsTruncated] = useState(false)
  const textRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    const element = textRef.current
    if (element) {
      setIsTruncated(element.scrollHeight > element.clientHeight)
    }
  }, [text])
  
  return (
    <p
      ref={textRef}
      className={cn("select-none text-xs", !isExpanded && "line-clamp-3")}
    >
      {text}
      {isTruncated && !isExpanded && (
        <span
          className="description-expand cursor-pointer text-blue-500 hover:underline"
          onClick={(e) => {
            e.stopPropagation()
            setIsExpanded(!isExpanded)
          }}
          onKeyUp={(e) => {
            if (e.key === "Enter") {
              e.stopPropagation()
              setIsExpanded(!isExpanded)
            }
          }}
        >
          {" "}
          ...
        </span>
      )}
    </p>
  )
} 